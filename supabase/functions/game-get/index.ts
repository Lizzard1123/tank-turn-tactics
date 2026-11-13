import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getAuthUserId } from '../_shared/auth.ts';
import {
  applyEvent, createInitialState,
  attackMask, attackActors, maskEvents, maskLog, scrubState, scrubConfig,
  type GameEvent, type GameState,
} from '../_shared/engine.ts';
import { canonicalHistory, effectiveForks, type ForkPoint, type HistoryRow } from '../_shared/history.ts';

// shape returned by load_game_detail (migration 0016)
interface RawEventRow {
  seq: number; type: string; actor_id: string;
  payload: unknown; created_at: string; generation?: number;
}

interface Detail {
  player: { id: string; name: string } | null;
  game: {
    id: string; name: string; mode: string; status: string;
    config: Record<string, unknown>; created_by: string;
    cur_generation: number; fork_seq: number | null;
    invite_code: string; last_tick_at: string | null; daily_ap_time: string;
  } | null;
  members: Array<{ player_id: string; is_bot: boolean; bot_difficulty: string | null; joined_at: string }>;
  snap: { seq: number; state: GameState } | null;
  tail: RawEventRow[];
  history: RawEventRow[];
  forks: ForkPoint[];
  membership: boolean;
  avatars: Record<string, string>;
  names: Record<string, string>;
}

function toEvent(r: RawEventRow): GameEvent {
  return {
    seq: r.seq, type: r.type as GameEvent['type'], actorId: r.actor_id,
    createdAt: r.created_at, payload: (r.payload ?? {}) as GameEvent['payload'],
  };
}

// history rows always carry their generation (events.generation is not null)
function toEventWithGeneration(r: RawEventRow): GameEvent & HistoryRow {
  return { ...toEvent(r), generation: r.generation as number };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ error: 'GET required' }, 405);
  try {
    const a = admin();
    // Local JWT verification (no round trip); the players row rides the
    // detail load below (401 checked there — same response as before).
    const userId = await getAuthUserId(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const gameId = new URL(req.url).searchParams.get('gameId');
    if (!gameId) return json({ error: 'gameId required' }, 400);

    // ONE round trip for the whole detail (migration 0016) — previously
    // eight reads across three sequential waves.
    const { data: d, error: loadErr } = await a.rpc('load_game_detail', {
      p_game_id: gameId, p_player_id: userId,
    });
    if (loadErr) throw new Error(`load failed: ${loadErr.message}`);
    const detail = d as unknown as Detail;
    // A valid token whose players row is gone (auth.users drift) is still an
    // unauthorized caller — same 401 the players lookup used to produce.
    if (!detail.player) return json({ error: 'unauthorized' }, 401);
    const me = detail.player;
    const game = detail.game;
    if (!game) return json({ error: 'game not found' }, 404);

    const members = detail.members;
    const snap = detail.snap;

    // avatars/names ride alongside engine state (engine stays avatar-free):
    // maps of playerId -> public avatar url / display name, from the players
    // table (real players only — bot ids are not uuids).
    const avatars = detail.avatars ?? {};
    const names = detail.names ?? {};

    if (!detail.membership && game.created_by !== me.id)
      return json({ error: 'not a member of this game' }, 403);

    if (snap) {
      const tail = (detail.tail ?? []).map(toEvent);
      let state = snap.state;
      for (const e of tail) {
        try { state = applyEvent(state, e); } catch { break; }
      }
      // full history for scrubbing: the CANONICAL timeline across fork
      // generations — each ancestor generation is cut at the fork that ended
      // it (game_forks), so replaying from the initial state never walks a
      // discarded branch.
      // Heal the deploy window: a fork performed before fork-row recording
      // shipped set games.fork_seq but wrote no game_forks row — synthesize
      // the newest parent's cut from fork_seq so its discarded tail is cut.
      const history: GameEvent[] = canonicalHistory(
        (detail.history ?? []).map(toEventWithGeneration),
        effectiveForks(detail.forks ?? [], game.cur_generation, game.fork_seq),
      );

      // --- secrecy scrub (per viewer) ---
      // The seed and other players' AP never go on the wire, and attack
      // events lose their actor except each victim's most recent damage.
      // See engine/scrub.ts. Masking is computed over the canonical timeline
      // (which includes the tail), then applied to what we SEND — the
      // database keeps the truth.
      const rawConfig = game.config as unknown as GameState['config'];
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
