import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getPlayer } from '../_shared/auth.ts';
import {
  applyEvent, createInitialState,
  attackMask, attackActors, maskEvents, maskLog, scrubState, scrubConfig,
  type GameEvent, type GameState,
} from '../_shared/engine.ts';
import { canonicalHistory, effectiveForks, type ForkPoint } from '../_shared/history.ts';

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
      .select('id, name, avatar_url').in('id', memberIds);
    const avatars: Record<string, string> = {};
    const names: Record<string, string> = {};
    for (const row of avatarRows ?? []) {
      if (row.avatar_url) avatars[row.id] = row.avatar_url;
      if (row.name) names[row.id] = row.name;
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
      // Heal the deploy window: a fork performed before fork-row recording
      // shipped set games.fork_seq but wrote no game_forks row — synthesize
      // the newest parent's cut from fork_seq so its discarded tail is cut.
      const history: GameEvent[] = canonicalHistory(historyRows ?? [],
        effectiveForks((forkRows ?? []) as ForkPoint[], game.cur_generation, game.fork_seq))
        .map(e => ({
          seq: e.seq, type: e.type, actorId: e.actor_id,
          createdAt: e.created_at, payload: e.payload ?? {},
        }));

      // --- secrecy scrub (per viewer) ---
      // The seed and other players' AP never go on the wire, and attack
      // events lose their actor except each victim's most recent damage.
      // See engine/scrub.ts. Masking is computed over the canonical timeline
      // (which includes the tail), then applied to what we SEND — the
      // database keeps the truth.
      const rawConfig = game.config as GameState['config'];
      const mask = attackMask(history);
      const actors = attackActors(history);
      const stateForViewer: GameState = {
        ...scrubState(state, me.id),
        log: maskLog(state.log, actors, me.id, mask, (id) => state.players[id]?.name ?? id),
      };
      // the scrubber's starting point, computed server-side with the real
      // seed (createInitialState is seed-deterministic, so this is exact).
      // Player order comes from state.order — JSONB does not preserve the
      // players record's key order, and spawn placement is order-sensitive.
      let initial = createInitialState(rawConfig, state.order.map((id) => {
        const p = state.players[id];
        return { id: p.id, name: p.name, isBot: p.isBot, botDifficulty: p.botDifficulty };
      }));
      initial = { ...initial, config: { ...initial.config, seed: 0 } };

      return json({
        game: {
          id: game.id, name: game.name, mode: game.mode, status: game.status,
          config: scrubConfig(game.config as Record<string, unknown>), createdBy: game.created_by,
          inviteCode: game.invite_code, generation: game.cur_generation,
          forkSeq: game.fork_seq,
          // server AP schedule — the client derives its countdown from these,
          // never from a client-side guess, so refreshes stay in sync
          lastTickAt: game.last_tick_at, dailyApTime: game.daily_ap_time,
          // server-computed starting state for the client scrubber
          // (seed-scrubbed copy of the game's true initial state)
          initial,
        },
        state: stateForViewer,
        events: maskEvents(tail, me.id, mask),  // authoritative tail (applied)
        history: maskEvents(history, me.id, mask), // full event record for the scrubber
        members,
        avatars,
        names,              // playerId -> display name (lobby shows real names)
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
        lastTickAt: game.last_tick_at, dailyApTime: game.daily_ap_time,
      },
      state: null, events: [], history: [], members, avatars, names, me: me.id,
    });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
