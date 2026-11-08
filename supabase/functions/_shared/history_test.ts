import { assertEquals } from 'jsr:@std/assert@1';
import {
  canonicalHistory, effectiveForks, rebuildStateAt,
  type HistoryRow, type ForkPoint,
} from './history.ts';
import {
  applyEvent, createInitialState,
  type GameConfig, type GameEvent, type GameState, type PlayerSpec,
} from './engine.ts';

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

// ---------------------------------------------------------------------------
// rebuildStateAt — the fork server rebuild: the TRUE state at toSeq, replayed
// from the seeded initial state over canonical history (never from the latest
// snapshot, which keeps the tail the rewind is supposed to abandon).
// ---------------------------------------------------------------------------

const CONFIG: GameConfig = {
  seed: 42, board: 4, startingHp: 3, startingAp: 5, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
};

const SPECS: PlayerSpec[] = [
  { id: 'p1', name: 'one', isBot: false, botDifficulty: null },
  { id: 'p2', name: 'two', isBot: false, botDifficulty: null },
];

function ev(seq: number, to: { x: number; y: number }): GameEvent {
  return { seq, type: 'move', actorId: 'p1', createdAt: '2026-01-01T00:00:00Z', payload: { to } };
}

// all empty orthogonal neighbors of p1's spot on the given board
function legalMoves(state: GameState): { x: number; y: number }[] {
  const from = state.players.p1.pos;
  const occupied = new Set(Object.values(state.players).map((p) => `${p.pos.x},${p.pos.y}`));
  return [
    { x: from.x + 1, y: from.y }, { x: from.x - 1, y: from.y },
    { x: from.x, y: from.y + 1 }, { x: from.x, y: from.y - 1 },
  ].filter((p) => p.x >= 0 && p.y >= 0 && p.x < CONFIG.board && p.y < CONFIG.board
    && !occupied.has(`${p.x},${p.y}`));
}

function firstLegalMove(state: GameState): { x: number; y: number } {
  const open = legalMoves(state);
  if (open.length === 0) throw new Error('no legal move from initial placement');
  return open[0];
}

Deno.test('rebuildStateAt: replays from the initial state, ending exactly at toSeq', () => {
  const s0 = createInitialState(CONFIG, SPECS);
  const e1 = ev(1, firstLegalMove(s0));
  const s1 = applyEvent(s0, e1);
  const e2 = ev(2, firstLegalMove(s1));
  const s2 = applyEvent(s1, e2);

  const rows = [e1, e2].map((e) => ({ ...e, generation: 1 }));
  assertEquals(rebuildStateAt(rows, [], CONFIG, SPECS, 0).seq, 0);
  assertEquals(rebuildStateAt(rows, [], CONFIG, SPECS, 1), s1);
  assertEquals(rebuildStateAt(rows, [], CONFIG, SPECS, 2), s2);
});

Deno.test('rebuildStateAt: a discarded branch tail never leaks into the rebuild', () => {
  const s0 = createInitialState(CONFIG, SPECS);
  const e1 = ev(1, firstLegalMove(s0));
  const s1 = applyEvent(s0, e1);
  // gen 1 ran past seq 1; a fork at 1 abandons gen-1 seq 2; gen 2 re-runs
  // seq 2 as a DIFFERENT legal move — the rebuild must take the gen-2 one.
  const moves = legalMoves(s1);
  if (moves.length < 2) throw new Error('test setup degenerated: fewer than 2 legal moves');
  const e2bad = ev(2, moves[moves.length - 1]); // abandoned branch
  const e2good = ev(2, moves[0]);               // gen-2 continuation
  if (JSON.stringify(e2bad.payload) === JSON.stringify(e2good.payload)) {
    throw new Error('test setup degenerated: branches pick the same cell');
  }
  const rows = [
    { ...e1, generation: 1 }, { ...e2bad, generation: 1 },
    { ...e2good, generation: 2 },
  ];
  const forks: ForkPoint[] = [{ parent_generation: 1, to_seq: 1 }];
  const rebuilt = rebuildStateAt(rows, forks, CONFIG, SPECS, 2);
  // gen 2's continuation move applied, NOT the abandoned branch's move
  assertEquals(rebuilt, applyEvent(s1, e2good));
});

// ---------------------------------------------------------------------------
// effectiveForks — game-get's heal for the deploy window: a fork performed
// before the fork-row-recording action was deployed set games.fork_seq but
// wrote no game_forks row; synthesize the missing cut for the newest parent.
// ---------------------------------------------------------------------------

Deno.test('effectiveForks: fork rows pass through unchanged', () => {
  const forks: ForkPoint[] = [
    { parent_generation: 1, to_seq: 3 }, { parent_generation: 2, to_seq: 7 },
  ];
  assertEquals(effectiveForks(forks, 3, 7), forks);
});

Deno.test('effectiveForks: missing row for the newest parent is healed from games.fork_seq', () => {
  assertEquals(effectiveForks([], 2, 3), [{ parent_generation: 1, to_seq: 3 }]);
  // row exists for gen1 but not gen2 → heal gen2 only
  assertEquals(
    effectiveForks([{ parent_generation: 1, to_seq: 3 }], 3, 7),
    [{ parent_generation: 1, to_seq: 3 }, { parent_generation: 2, to_seq: 7 }],
  );
});

Deno.test('effectiveForks: no heal without a fork_seq or below the first parent generation', () => {
  assertEquals(effectiveForks([], 1, null), []);
  assertEquals(effectiveForks([], 1, 5), []);
  assertEquals(effectiveForks([], 0, null), []);
});

Deno.test('canonicalHistory: a rewind below an earlier fork cut truncates every earlier generation (no duplicate seqs)', () => {
  // gen1 ran 1..5; fork@5 → gen2 ran 6..8; then a rewind to seq 3 (a GEN-1
  // event) → gen3 continues at 4. Cumulative cuts: gen1 must end at 3, so
  // canonical history is 1,2,3 then gen3's 4,5 — seqs 4,5 must not appear twice.
  const rows = [
    row(1, 1, 'g1'), row(2, 1, 'g1'), row(3, 1, 'g1-cut'),
    row(4, 1, 'DISCARDED'), row(5, 1, 'DISCARDED'),
    row(6, 2, 'g2'), row(7, 2, 'g2'), row(8, 2, 'DISCARDED'),
    row(4, 3, 'g3'), row(5, 3, 'g3'),
  ];
  const out = canonicalHistory(rows, [fork(1, 5), fork(2, 3)]);
  const seqs = out.map((r) => r.seq);
  assertEquals(new Set(seqs).size, seqs.length);
  assertEquals(seqs, [1, 2, 3, 4, 5]);
});
