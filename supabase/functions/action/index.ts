import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getPlayer } from '../_shared/auth.ts';
import {
  applyEvent, EngineError,
  type GameConfig, type GameEvent, type GameState, type PlayerSpec,
} from '../_shared/engine.ts';
import { rebuildStateAt, type ForkPoint } from '../_shared/history.ts';

interface GameRow {
  id: string; mode: string; status: string; config: GameConfig;
  created_by: string; cur_generation: number; fork_seq: number | null;
}

const ACTION_TYPES = new Set(['move', 'attack', 'give_ap', 'upgrade_range', 'jury_vote', 'fork']);

// PlayerSpecs for a deterministic replay, from the live state's player list
// (ids are stable across fork generations; names only affect log text).
function specsFromState(state: GameState): PlayerSpec[] {
  return Object.values(state.players).map((p) => ({
    id: p.id, name: p.name, isBot: p.isBot, botDifficulty: p.botDifficulty,
  }));
}

/**
 * Load the authoritative GameState for a game.
 * Strategy: start from the materialized game_state snapshot, then apply any
 * tail events (current generation, seq > snapshot.seq).
 */
async function loadAuthoritativeState(
  gameId: string,
): Promise<{ game: GameRow; state: GameState } | null> {
  const a = admin();
  const { data: game } = await a.from('games').select('*').eq('id', gameId).single();
  if (!game) return null;

  const { data: snap } = await a.from('game_state').select('seq, state').eq('game_id', gameId).single();
  if (!snap) return { game: game as GameRow, state: null as unknown as GameState };

  const { data: tail } = await a.from('events')
    .select('seq, type, actor_id, payload, created_at')
    .eq('game_id', gameId)
    .eq('generation', game.cur_generation)
    .gt('seq', snap.seq)
    .order('seq');

  let state = snap.state as GameState;
  for (const e of tail ?? []) {
    state = applyEvent(state, {
      seq: e.seq, type: e.type, actorId: e.actor_id,
      createdAt: e.created_at, payload: e.payload ?? {},
    });
  }
  return { game: game as GameRow, state };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const a = admin();
    const me = await getPlayer(a, req);
    if (!me) return json({ error: 'unauthorized' }, 401);

    const { gameId, type, payload = {} } = await req.json();
    if (!gameId || !ACTION_TYPES.has(type)) return json({ error: 'invalid request' }, 400);

    const loaded = await loadAuthoritativeState(gameId);
    if (!loaded || !loaded.state) return json({ error: 'game not started' }, 404);
    const { game, state } = loaded;

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
      return json({ ok: true, forked: true, state: forkState });
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

    const { error: insertErr } = await a.from('events').insert({
      game_id: gameId,
      generation: game.cur_generation,
      seq: event.seq,
      type: event.type,
      actor_id: event.actorId,
      payload: event.payload,
      created_at: event.createdAt,
    });
    if (insertErr) return json({ error: 'event append failed' }, 500);

    await a.from('game_state').upsert({
      game_id: gameId, seq: next.seq, state: next, updated_at: new Date().toISOString(),
    });

    if (next.winner) {
      await a.from('games').update({ status: 'finished' }).eq('id', gameId);
    }

    return json({ ok: true, seq: next.seq, state: next });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
