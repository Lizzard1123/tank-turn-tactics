import { describe, it, expect } from 'vitest';
import { replay, applyEvents, replayToSeq } from '../src/replay';
import { applyEvent } from '../src/reducer';
import { EngineError } from '../src/errors';
import type { GameEvent, GameConfig } from '../src/types';

const cfg: GameConfig = {
  seed: 9, board: 8, startingHp: 3, startingAp: 5, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
};
const specs = [
  { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
  { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
];

function ev(state: { seq: number }, actorId: string, type: GameEvent['type'], payload: Record<string, unknown> = {}): GameEvent {
  return { seq: state.seq + 1, type, actorId, createdAt: '2026-01-01T00:00:00Z', payload };
}

describe('replay', () => {
  it('replaying events equals folding them live', () => {
    const live = replay(cfg, specs, []);
    const s1 = applyEvent(live, ev(live, 'p1', 'upgrade_range', {}));
    const s2 = applyEvent(s1, ev(s1, 'p1', 'upgrade_range', {}));
    const replayed = replay(cfg, specs, [
      ev({ seq: 0 }, 'p1', 'upgrade_range', {}),
      ev({ seq: 1 }, 'p1', 'upgrade_range', {}),
    ]);
    expect(replayed.players.p1).toEqual(s2.players.p1);
    expect(replayed.seq).toBe(2);
  });
  it('applyEvents continues onto an existing state', () => {
    const live = replay(cfg, specs, [ev({ seq: 0 }, 'p1', 'upgrade_range', {})]);
    const s2 = applyEvents(live, [ev(live, 'p1', 'upgrade_range', {})]);
    expect(s2.seq).toBe(2);
    expect(s2.players.p1.range).toBe(4);
  });
  it('rejects gaps', () => {
    expect(() => replay(cfg, specs, [
      { seq: 2, type: 'upgrade_range', actorId: 'p1', createdAt: '', payload: {} },
    ])).toThrow(EngineError);
  });
  it('replayToSeq rewinds: later actions are absent', () => {
    const e1 = ev({ seq: 0 }, 'p1', 'upgrade_range', {});
    const e2 = ev({ seq: 1 }, 'p1', 'upgrade_range', {});
    const full = replay(cfg, specs, [e1, e2]);
    expect(full.players.p1.range).toBe(4);
    const rewound = replayToSeq(cfg, specs, [e1, e2], 1);
    expect(rewound.players.p1.range).toBe(3);
    expect(rewound.seq).toBe(1);
  });
  it('replayToSeq at 0 returns the initial state', () => {
    const e1 = ev({ seq: 0 }, 'p1', 'upgrade_range', {});
    const rewound = replayToSeq(cfg, specs, [e1], 0);
    expect(rewound.seq).toBe(0);
    expect(rewound.players.p1.range).toBe(2);
  });
  it('fork event is log-only', () => {
    const s = replay(cfg, specs, [
      ev({ seq: 0 }, 'system', 'fork', { toSeq: 0 }),
    ]);
    expect(s.seq).toBe(1);
    expect(s.log.at(-1)!.text).toMatch(/fork/i);
    expect(s.players.p1.range).toBe(2);
  });
});
