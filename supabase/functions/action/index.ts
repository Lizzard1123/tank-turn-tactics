import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getPlayer } from '../_shared/auth.ts';
import {
  applyEvent, EngineError, scrubState,
  type GameConfig, type GameEvent, type GameState, type PlayerSpec,
} from '../_shared/engine.ts';
import { rebuildStateAt, type ForkPoint } from '../_shared/history.ts';

interface GameRow {
  id: string; mode: string; status: string; config: GameConfig;
  created_by: string; cur_generation: number; fork_seq: number | null;
}

const ACTION_TYPES = new Set(['move', 'attack', 'give_ap', 'give_heart', 'upgrade_range', 'jury_vote', 'fork']);

// Payload whitelist per action type. Everything else — including any `anon`
// flag (the engine's masked-attack replay marker, which would let a client
// attack without paying AP) — is stripped before the payload reaches the
// engine or the events table.
const ALLOWED_KEYS: Record<string, string[]> = {
  move: ['to'],
  attack: ['targetId'],
  give_ap: ['targetId'],
  give_heart: ['targetId'],
  upgrade_range: [],
  jury_vote: ['candidateId'],
  fork: ['toSeq'],
};

function sanitizePayload(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS[type] ?? []) {
    if (key in payload) out[key] = payload[key];
  }
  return out;
}

// PlayerSpecs for a deterministic replay, from the live state's player list
// (ids are stable across fork generations; names only affect log text).
function specsFromState(state: GameState): PlayerSpec[] {
  return Object.values(state.players).map((p) => ({
    id: p.id, name: p.name, isBot: p.isBot, botDifficulty: p.botDifficulty,
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const a = admin();
    // Start auth and body-parse concurrently, but keep the old error
    // precedence: an unauthorized caller gets 401 even if the body is
    // malformed (auth resolves first; the parse result is awaited after).
    const meP = getPlayer(a, req);
    const bodyP = req.json();
    const me = await meP;
    if (!me) return json({ error: 'unauthorized' }, 401);

    const { gameId, type, payload: rawPayload = {} } = await bodyP;
    if (!gameId || !ACTION_TYPES.has(type)) return json({ error: 'invalid request' }, 400);
    const payload = sanitizePayload(type, rawPayload);

    // Parallel reads (previously three sequential round trips): the game row
    // and the snapshot are independent; the tail query needs both.
    const [gameRes, snapRes] = await Promise.all([
      a.from('games').select('*').eq('id', gameId).single(),
      a.from('game_state').select('seq, state').eq('game_id', gameId).single(),
    ]);
    const game = gameRes.data as GameRow | null;
    if (!game) return json({ error: 'game not started' }, 404);
    const snap = snapRes.data as { seq: number; state: GameState } | null;
    if (!snap) return json({ error: 'game not started' }, 404);

    const { data: tail } = await a.from('events')
      .select('seq, type, actor_id, payload, created_at')
      .eq('game_id', gameId)
      .eq('generation', game.cur_generation)
      .gt('seq', snap.seq)
      .order('seq');

    let state = snap.state;
    for (const e of tail ?? []) {
      state = applyEvent(state, {
        seq: e.seq, type: e.type, actorId: e.actor_id,
        createdAt: e.created_at, payload: e.payload ?? {},
      });
    }

    if (type === 'fork') {
      if (game.mode !== 'test' || game.created_by !== me.id)
        return json({ error: 'fork allowed only for own test games' }, 403);
      const toSeq = payload.toSeq as number;
      if (typeof toSeq !== 'number' || toSeq < 0 || toSeq > state.seq)
        return json({ error: 'invalid toSeq' }, 400);
      // Rebuild the TRUE state at toSeq by replaying canonical history from
      // the seeded initial state. The materialized snapshot carries the tail
      // the rewind abandons; starting from it would leave gen-2 continuing
      // at snapshot.seq + 1 — a seq gap the engine rejects — instead of
      // toSeq + 1.
      let forkState = state;
      if (state.seq !== toSeq) {
        try {
          const [histRes, forkRes] = await Promise.all([
            a.from('events')
              .select('seq, type, actor_id, payload, created_at, generation')
              .eq('game_id', gameId)
              .lte('generation', game.cur_generation),
            a.from('game_forks')
              .select('parent_generation, to_seq').eq('game_id', gameId),
          ]);
          const rows = (histRes.data ?? []).map((r) => ({
            seq: r.seq, type: r.type, actorId: r.actor_id,
            createdAt: r.created_at, payload: r.payload ?? {}, generation: r.generation,
          }));
          forkState = rebuildStateAt(rows, (forkRes.data ?? []) as ForkPoint[],
            game.config, specsFromState(state), toSeq);
          if (forkState.seq !== toSeq) {
            return json({ error: 'fork state rebuild failed' }, 500);
          }
        } catch {
          return json({ error: 'fork state rebuild failed' }, 500);
        }
      }
      const gen = game.cur_generation + 1;
      // record the parent generation's truncation point: canonical-history
      // assembly needs every fork point, and games.fork_seq only keeps the latest
      await a.from('game_forks').upsert({
        game_id: gameId, parent_generation: game.cur_generation, to_seq: toSeq,
      });
      const { error: updErr } = await a.from('games')
        .update({ cur_generation: gen, fork_seq: toSeq }).eq('id', gameId);
      if (updErr) {
        // compensate: never leave a cut row truncating the still-live generation
        await a.from('game_forks').delete().match({
          game_id: gameId, parent_generation: game.cur_generation, to_seq: toSeq,
        });
        return json({ error: 'fork state update failed' }, 500);
      }
      // the rebuilt state becomes the new snapshot; gen-2 events continue
      // at toSeq + 1
      await a.from('game_state').upsert({
        game_id: gameId, seq: forkState.seq, state: forkState,
        updated_at: new Date().toISOString(),
      });
      // scrubbed like every other client-facing payload: no client reads this
      // response (the UI refetches), but the real seed and others' ap/range
      // must not ride the wire for an API poke either.
      return json({ ok: true, forked: true, state: scrubState(forkState, me.id) });
    }

    if (game.status !== 'active') return json({ error: 'game not active' }, 409);
    if (!state.players[me.id]) return json({ error: 'not a member of this game' }, 403);
    if (state.winner) return json({ error: 'game is over' }, 409);

    const event: GameEvent = {
      seq: state.seq + 1,
      type: type as GameEvent['type'],
      actorId: me.id,
      createdAt: new Date().toISOString(),
      payload,
    };
    let next: GameState;
    try {
      next = applyEvent(state, event);
    } catch (e) {
      if (e instanceof EngineError) return json({ error: e.message }, 400);
      throw e;
    }

    // Atomic single-round-trip commit (migration 0015): events insert +
    // snapshot upsert + activity trigger + winner status, previously three
    // sequential writes (and non-transactional — a crash between them left
    // the event appended with a stale snapshot). Same ordering, same effect;
    // any failure now rolls back the whole commit.
    const { error: commitErr } = await a.rpc('append_action_event', {
      p_game_id: gameId,
      p_generation: game.cur_generation,
      p_seq: event.seq,
      p_type: event.type,
      p_actor_id: event.actorId,
      p_payload: event.payload,
      p_created_at: event.createdAt,
      p_next_seq: next.seq,
      p_next_state: next,
      p_has_winner: !!next.winner,
    });
    if (commitErr) return json({ error: 'event append failed' }, 500);

    // No state in the response: the full state (seed, everyone's AP, the real
    // log) must not ride on any client-facing payload, and the app only ever
    // reads `seq` before its authoritative refetch.
    return json({ ok: true, seq: next.seq });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
