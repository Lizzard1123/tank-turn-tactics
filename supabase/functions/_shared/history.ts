// Canonical event-timeline assembly across fork generations.
//
// A fork truncates the PARENT generation at to_seq (the new generation
// continues at to_seq + 1), so the replayable timeline is: for each
// generation in order, that generation's events UP TO the fork that ended
// it. Events beyond the cut belong to the abandoned branch — applying them
// during full-history replay moves tanks onto timelines the game discarded.

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
  return rows
    .filter((r) => {
      const cut = cutByGen.get(r.generation);
      return cut === undefined || r.seq <= cut;
    })
    .sort((a, b) => (a.generation - b.generation) || (a.seq - b.seq));
}
