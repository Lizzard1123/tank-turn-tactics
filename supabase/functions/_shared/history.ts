// Canonical event-timeline assembly across fork generations.
//
// A fork truncates the PARENT generation at to_seq (the new generation
// continues at to_seq + 1), so the replayable timeline is: for each
// generation in order, that generation's events UP TO the fork that ended
// it. Events beyond the cut belong to the abandoned branch — applying them
// during full-history replay moves tanks onto timelines the game discarded.

import {
  applyEvent, createInitialState,
  type GameConfig, type GameEvent, type GameState, type PlayerSpec,
} from './engine.ts';

export interface HistoryRow {
  seq: number;
  generation: number;
}

export interface ForkPoint {
  parent_generation: number;
  to_seq: number;
}

export function canonicalHistory<T extends HistoryRow>(rows: T[], forks: ForkPoint[]): T[] {
  const cutByGen = new Map<number, number>();
  for (const f of forks) cutByGen.set(f.parent_generation, f.to_seq);
  // A later fork that rewinds BELOW an earlier fork's cut also truncates
  // every EARLIER generation (the timeline flows through them). Propagate
  // the minimum cut backwards so canonical history never emits duplicate
  // seqs across generations.
  const gens = [...cutByGen.keys()].sort((a, b) => a - b);
  let running = Infinity;
  for (let i = gens.length - 1; i >= 0; i--) {
    running = Math.min(running, cutByGen.get(gens[i])!);
    cutByGen.set(gens[i], running);
  }
  return rows
    .filter((r) => {
      const cut = cutByGen.get(r.generation);
      return cut === undefined || r.seq <= cut;
    })
    .sort((a, b) => (a.generation - b.generation) || (a.seq - b.seq));
}

/**
 * The TRUE state at `toSeq`: canonical history filtered to seq <= toSeq,
 * replayed from the seeded initial state. A fork to an earlier point MUST
 * rebuild this way — starting from the materialized snapshot would keep the
 * abandoned tail and make the new generation continue past toSeq, leaving a
 * seq gap the engine rejects. `initialPlayers` supplies the PlayerSpecs (ids
 * are stable across generations); createInitialState is deterministic from
 * config.seed, so the rebuild is exact.
 *
 * Caller contract: the returned state's seq is toSeq when the canonical
 * history is contiguous up to toSeq; a mismatch means missing history rows.
 */
export function rebuildStateAt(
  rows: (GameEvent & HistoryRow)[],
  forks: ForkPoint[],
  config: GameConfig,
  initialPlayers: PlayerSpec[],
  toSeq: number,
): GameState {
  let state = createInitialState(config, initialPlayers);
  for (const r of canonicalHistory(rows, forks)) {
    if (r.seq > toSeq) break; // seqs are globally increasing across generations
    state = applyEvent(state, {
      seq: r.seq, type: r.type, actorId: r.actorId,
      createdAt: r.createdAt, payload: r.payload ?? {},
    });
  }
  return state;
}

/**
 * Fork rows a game-get read should trust, healed for the deploy window:
 * a fork executed before fork-row recording shipped set games.fork_seq but
 * wrote no game_forks row. When the newest parent generation (cur - 1) has
 * no row, synthesize its cut from games.fork_seq. Older parents without
 * rows are unrecoverable (only the latest fork point is stored) and are
 * left as "keep everything" — canonicalHistory's documented fallback.
 */
export function effectiveForks(forkRows: ForkPoint[], curGeneration: number, forkSeq: number | null): ForkPoint[] {
  const out = [...forkRows];
  const parent = curGeneration - 1;
  if (parent >= 1 && forkSeq !== null && !out.some((f) => f.parent_generation === parent)) {
    out.push({ parent_generation: parent, to_seq: forkSeq });
  }
  return out;
}
