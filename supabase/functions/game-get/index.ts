import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getPlayer } from '../_shared/auth.ts';
import { applyEvent, type GameEvent } from '../_shared/engine.ts';
import { canonicalHistory, type ForkPoint } from '../_shared/history.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ error: 'GET required' }, 405);
  try {
    const a = admin();
    const me = await getPlayer(a, req);
    if (!me) return json({ error: 'unauthorized' }, 401);

    const gameId = new URL(req.url).searchParams.get('gameId');
    if (!gameId) return json({ error: 'gameId required' }, 400);

    const { data: game } = await a.from('games').select('*').eq('id', gameId).single();
    if (!game) return json({ error: 'game not found' }, 404);

    const { data: membership } = await a.from('game_players')
      .select('player_id').eq('game_id', gameId).eq('player_id', me.id).single();
    if (!membership && game.created_by !== me.id)
      return json({ error: 'not a member of this game' }, 403);

    const { data: members } = await a.from('game_players')
      .select('player_id, is_bot, bot_difficulty, joined_at').eq('game_id', gameId)
      .order('joined_at');

    // avatars ride alongside engine state (engine stays avatar-free):
    // map of playerId -> public avatar url, from the players table.
    // Only real players (uuid ids) — bot ids like 'bot-1' would fail the
    // uuid cast on .in().
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const memberIds = (members ?? []).map(m => m.player_id).filter(id => UUID_RE.test(id));
    const { data: avatarRows } = await a.from('players')
      .select('id, avatar_url').in('id', memberIds);
    const avatars: Record<string, string> = {};
    for (const row of avatarRows ?? []) {
      if (row.avatar_url) avatars[row.id] = row.avatar_url;
    }

    const { data: snap } = await a.from('game_state').select('seq, state').eq('game_id', gameId).single();

    // current-generation events after the snapshot, truncated at fork_seq
    let tail: GameEvent[] = [];
    if (snap) {
      const { data: tailRows } = await a.from('events')
        .select('seq, type, actor_id, payload, created_at')
        .eq('game_id', gameId)
        .eq('generation', game.cur_generation)
        .gt('seq', snap.seq)
        .order('seq');
      tail = (tailRows ?? []).map(e => ({
        seq: e.seq, type: e.type, actorId: e.actor_id,
        createdAt: e.created_at, payload: e.payload ?? {},
      }));
      let state = snap.state;
      for (const e of tail) {
        try { state = applyEvent(state, e); } catch { break; }
      }
      // full history for scrubbing: the CANONICAL timeline across fork
      // generations — each ancestor generation is cut at the fork that ended
      // it (game_forks), so replaying from the initial state never walks a
      // discarded branch.
      const { data: historyRows } = await a.from('events')
        .select('seq, type, actor_id, payload, created_at, generation')
        .eq('game_id', gameId)
        .lte('generation', game.cur_generation);
      const { data: forkRows } = await a.from('game_forks')
        .select('parent_generation, to_seq').eq('game_id', gameId);
      const history: GameEvent[] = canonicalHistory(historyRows ?? [], (forkRows ?? []) as ForkPoint[])
        .map(e => ({
          seq: e.seq, type: e.type, actorId: e.actor_id,
          createdAt: e.created_at, payload: e.payload ?? {},
        }));
      return json({
        game: {
          id: game.id, name: game.name, mode: game.mode, status: game.status,
          config: game.config, createdBy: game.created_by,
          inviteCode: game.invite_code, generation: game.cur_generation,
          forkSeq: game.fork_seq,
        },
        state,
        events: tail,       // authoritative tail (applied)
        history,            // full event record for the scrubber
        members,
        avatars,
        me: me.id,
      });
    }

    // lobby: no state yet
    return json({
      game: {
        id: game.id, name: game.name, mode: game.mode, status: game.status,
        config: game.config, createdBy: game.created_by,
        inviteCode: game.invite_code, generation: game.cur_generation,
        forkSeq: game.fork_seq,
      },
      state: null, events: [], history: [], members, avatars, me: me.id,
    });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
