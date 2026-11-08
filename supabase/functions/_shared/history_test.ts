import { assertEquals } from 'jsr:@std/assert@1';
import { canonicalHistory, type HistoryRow, type ForkPoint } from './history.ts';

interface Row extends HistoryRow { label: string }

function row(seq: number, generation: number, label: string): Row {
  return { seq, generation, label };
}

function fork(parentGeneration: number, toSeq: number): ForkPoint {
  return { parent_generation: parentGeneration, to_seq: toSeq };
}

Deno.test('canonicalHistory: single generation, no forks — everything kept in seq order', () => {
  const rows = [row(1, 1, 'a'), row(2, 1, 'b'), row(3, 1, 'c')];
  assertEquals(canonicalHistory(rows, []), rows);
});

Deno.test('canonicalHistory: cuts the discarded post-fork tail of the parent generation', () => {
  // gen 1 ran to seq 5; a fork at toSeq 3 abandoned seqs 4-5 (stale branch);
  // gen 2 continues at seq 4. The stale 4-5 rows must NOT appear.
  const rows = [
    row(1, 1, 'keep'), row(2, 1, 'keep'), row(3, 1, 'keep at fork point'),
    row(4, 1, 'DISCARDED'), row(5, 1, 'DISCARDED'),
    row(4, 2, 'gen2 continuation'), row(5, 2, 'gen2 continuation'),
  ];
  const forks: ForkPoint[] = [fork(1, 3)];
  const out = canonicalHistory(rows, forks);
  assertEquals(out.map((r) => r.label), [
    'keep', 'keep', 'keep at fork point', 'gen2 continuation', 'gen2 continuation',
  ]);
});

Deno.test('canonicalHistory: chained forks cut each ancestor at its own fork point', () => {
  // gen1 → fork@2 → gen2 → fork@4 → gen3 continues at 5+
  const rows = [
    row(1, 1, 'g1'), row(2, 1, 'g1-cut'), row(3, 1, 'DISCARDED'),
    row(3, 2, 'g2'), row(4, 2, 'g2-cut'), row(5, 2, 'DISCARDED'),
    row(5, 3, 'g3'), row(6, 3, 'g3'),
  ];
  const forks: ForkPoint[] = [
    fork(1, 2),
    fork(2, 4),
  ];
  const out = canonicalHistory(rows, forks);
  assertEquals(out.map((r) => r.label), ['g1', 'g1-cut', 'g2', 'g2-cut', 'g3', 'g3']);
});

Deno.test('canonicalHistory: events after the fork point of the CURRENT generation are kept (fork row only describes the parent)', () => {
  const rows = [row(1, 1, 'a'), row(2, 2, 'b'), row(3, 2, 'c')];
  const forks: ForkPoint[] = [fork(1, 1)];
  assertEquals(canonicalHistory(rows, forks), rows);
});

Deno.test('canonicalHistory: generations without a fork row keep everything (pre-fork-era games)', () => {
  const rows = [row(1, 1, 'a'), row(9, 1, 'late g1'), row(10, 2, 'g2')];
  assertEquals(canonicalHistory(rows, []), rows);
});
