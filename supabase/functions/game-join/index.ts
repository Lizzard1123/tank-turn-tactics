import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getPlayer } from '../_shared/auth.ts';
import { applyEvent, EngineError, type GameEvent } from '../_shared/engine.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const a = admin();
    const me = await getPlayer(a, req);
    if (!me) return json({ error: 'unauthorized' }, 401);

    const { inviteCode } = await req.json();
    if (typeof inviteCode !== 'string' || inviteCode.length < 4)
      return json({ error: 'invalid invite code' }, 400);

    const { data: game } = await a.from('games')
      .select('id, status, mode, created_by, cur_generation, config')
      .eq('invite_code', inviteCode).single();
    if (!game) return json({ error: 'game not found' }, 404);
    if (game.mode === 'test') return json({ error: 'test games are private' }, 403);

    // guests (anonymous sign-ins) must not enter shared invite-code games
    if (me.isAnonymous) return json({ error: 'register to join shared games' }, 403);

    // already a member? return the game either way (Play is idempotent)
    const { data: membership } = await a.from('game_players')
      .select('player_id').eq('game_id', game.id).eq('player_id', me.id).maybeSingle();
    if (membership) return json({ gameId: game.id });

    if (game.status === 'lobby') {
      const { error } = await a.from('game_players').insert({
        game_id: game.id, player_id: me.id,
      });
      // 23505 = concurrent join raced us in; membership is what matters
      if (error && error.code !== '23505') return json({ error: 'join failed' }, 500);
      return json({ gameId: game.id });
    }

    // mid-game join: only when the config allows it
    if (game.status === 'active' && game.config?.allowLateJoin === true) {
      // member row first — the joining player's realtime subscription and
      // events-SELECT policy both key off membership
      const { error } = await a.from('game_players').insert({
        game_id: game.id, player_id: me.id,
      });
      // 23505 = concurrent join raced us in; membership is what matters
      if (error && error.code !== '23505') return json({ error: 'join failed' }, 500);

      // rebuild authoritative state (snapshot + tail), append the join event
      const { data: snap } = await a.from('game_state')
        .select('seq, state').eq('game_id', game.id).single();
      if (!snap) return json({ error: 'game state missing' }, 500);
      let state = snap.state as import('../_shared/engine.ts').GameState;
      const { data: tail } = await a.from('events')
        .select('seq, type, actor_id, payload, created_at')
        .eq('game_id', game.id)
        .eq('generation', game.cur_generation)
        .gt('seq', snap.seq)
        .order('seq');
      for (const e of tail ?? []) {
        state = applyEvent(state, {
          seq: e.seq, type: e.type, actorId: e.actor_id,
          createdAt: e.created_at, payload: e.payload ?? {},
        });
      }

      const event: GameEvent = {
        seq: state.seq + 1,
        type: 'join',
        actorId: me.id,
        createdAt: new Date().toISOString(),
        payload: { playerId: me.id, name: me.name },
      };
      let next;
      try {
        next = applyEvent(state, event);
      } catch (err) {
        if (err instanceof EngineError) return json({ error: err.message }, 400);
        throw err;
      }
      const { error: insertErr } = await a.from('events').insert({
        game_id: game.id,
        generation: game.cur_generation,
        seq: event.seq,
        type: event.type,
        actor_id: event.actorId,
        payload: event.payload,
        created_at: event.createdAt,
      });
      if (insertErr) return json({ error: 'event append failed' }, 500);
      await a.from('game_state').upsert({
        game_id: game.id, seq: next.seq, state: next, updated_at: new Date().toISOString(),
      });
      return json({ gameId: game.id });
    }

    return json({ error: 'game already started' }, 409);
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
