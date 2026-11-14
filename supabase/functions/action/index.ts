import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getAuthUserId } from '../_shared/auth.ts';
import { ALLOWED_KEYS, sanitizePayload } from './_shared/action-validation.ts';
import {
  applyEvent, EngineError, scrubState, attackMask, attackActors, maskEvents, maskLog,
  type GameConfig, type GameEvent, type GameState, type PlayerSpec,
} from '../_shared/engine.ts';
import { rebuildStateAt, canonicalHistory, effectiveForks, type ForkPoint, type HistoryRow } from '../_shared/history.ts';

interface GameRow {
  id: string; mode: string; status: string; config: GameConfig;
  created_by: string; cur_generation: number; fork_seq: number | null;
}

// shape returned by load_game_detail (migration 0016)
interface Detail {
  player: { id: string; name: string } | null;
  game: GameRow | null;
  members: Array<{ player_id: string }>;
  snap: { seq: number; state: GameState } | null;
  tail: RawEventRow[];
  history: RawEventRow[];
  forks: ForkPoint[];
  membership: boolean;
}

interface RawEventRow {
  seq: number; type: string; actor_id: string;
  payload: unknown; created_at: string; generation?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toEvent(r: RawEventRow): GameEvent {
  return {
    seq: r.seq, type: r.type as GameEvent['type'], actorId: r.actor_id,
    createdAt: r.created_at, payload: (r.payload ?? {}) as GameEvent['payload'],
  };
}

// history rows always carry their generation (events.generation is not null)
function toHistoryEvent(r: RawEventRow): GameEvent & HistoryRow {
  return { ...toEvent(r), generation: r.generation as number };
}

const ACTION_TYPES = new Set(['move', 'attack', 'give_ap', 'give_heart', 'upgrade_range', 'jury_vote', 'fork']);

// Payload whitelist per action type. Everything else — including any `anon`
// flag (the engine's masked-attack replay marker, which would let a client
// attack without paying AP) — is stripped before the payload reaches the
// engine or the events table.

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
    // Local JWT verification (no round trip), then body parse — same error
    // precedence as before: 401 for a missing/expired token, then 400 for a
    // malformed body.
    const userId = await getAuthUserId(req);
    const { gameId, type, payload: rawPayload = {} } = await req.json();
    if (!userId) return json({ error: 'unauthorized' }, 401);
    if (!gameId || !ACTION_TYPES.has(type)) return json({ error: 'invalid request' }, 400);
    const payload = sanitizePayload(type, rawPayload);

    // ONE round trip for every read the action needs (migration 0016):
    // player row, game, snapshot, tail, canonical-history inputs, forks,
    // members, membership.
    const { data: d, error: loadErr } = await a.rpc('load_game_detail', {
      p_game_id: gameId, p_player_id: userId,
    });
    if (loadErr) throw new Error(`load failed: ${loadErr.message}`);
    const detail = d as unknown as Detail;
    // A valid token whose players row is gone (auth.users drift) is still an
    // unauthorized caller — checked here, after the load that carries it.
    if (!detail.player) return json({ error: 'unauthorized' }, 401);
    const me = detail.player;
    const game = detail.game;
    if (!game) return json({ error: 'game not started' }, 404);
    const snap = detail.snap;
    if (!snap) return json({ error: 'game not started' }, 404);

    // replay the tail onto the snapshot (always empty in practice — the
    // commit RPC updates the snapshot atomically — but correct if it ever
    // ships raw snapshots again)
    let state = snap.state;
    for (const r of detail.tail ?? []) {
      state = applyEvent(state, toEvent(r));
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
      // toSeq + 1. The detail load already carried history and fork points.
      let forkState = state;
      if (state.seq !== toSeq) {
        try {
          const rows = (detail.history ?? []).map(toHistoryEvent);
          forkState = rebuildStateAt(rows, detail.forks ?? [],
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
      // must not ride the wire for an API poke either. Members' realtime rows
      // are deliberately not rewritten here — a fork is test-mode-only and
      // the poller reconciles members onto the new generation.
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

    // Per-member realtime rows (migration 0016): each member's own
    // pre-scrubbed view of `next` plus the masked new event, computed over
    // the canonical timeline INCLUDING the new event — so the fresh attack
    // is attributed (it is each victim's last hit) exactly as game-get would
    // render it, and the log the row carries is mask-rewritten with the same
    // rules. The event rides in `events` so the recipient's board fx and
    // scrubber history advance without a refetch.
    const canonical = canonicalHistory(
      (detail.history ?? []).map(toHistoryEvent),
      effectiveForks(detail.forks ?? [], game.cur_generation, game.fork_seq),
    );
    const full = [...canonical, event];
    const mask = attackMask(full);
    const actors = attackActors(full);
    const memberStates = (detail.members ?? [])
      .filter((m) => UUID_RE.test(m.player_id))
      .map((m) => ({
        player_id: m.player_id,
        state: {
          ...scrubState(next, m.player_id),
          log: maskLog(next.log, actors, m.player_id, mask, (id) => next.players[id]?.name ?? id),
        },
        events: maskEvents([event], m.player_id, mask)
          .map((e) => ({ ...e, generation: game.cur_generation })),
        game_patch: next.winner ? { status: 'finished' } : {},
      }));

    // Atomic single-round-trip commit (migration 0016): events insert +
    // snapshot upsert + per-member realtime rows + winner status, previously
    // separate writes (and non-transactional — a crash between them left the
    // event appended with a stale snapshot). Any failure rolls back the
    // whole commit.
    const { error: commitErr } = await a.rpc('commit_game_update', {
      p_game_id: gameId,
      p_generation: game.cur_generation,
      p_events: [{
        seq: event.seq, type: event.type, actor_id: event.actorId,
        payload: event.payload, created_at: event.createdAt,
      }],
      p_next_seq: next.seq,
      p_next_state: next,
      p_has_winner: !!next.winner,
      p_member_states: memberStates,
      p_game_patch: next.winner ? { status: 'finished' } : {},
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
