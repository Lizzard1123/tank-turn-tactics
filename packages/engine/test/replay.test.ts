import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/state';
import { applyEvent } from '../src/reducer';
import { replay, applyEvents, replayToSeq } from '../src/replay';
import type { GameConfig, GameEvent } from '../src/types';

const cfg: GameConfig = {
  seed: 42, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
};

const specs = [
  { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
  { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
  { id: 'p3', name: 'C', isBot: false, botDifficulty: null },
];

// Build a state where p1 is adjacent to p2 by using a small board and known positions.
// Also gives p1 extra AP and reduces p2's HP so give_ap / give_heart tests can pass.
function makeAdjacentState(): { state: GameConfig & { board: 4 }; state: import('../src/types').GameState } {
  const smallCfg = { seed: 1, board: 4 as const, startingHp: 3, startingAp: 4, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 };
  const specs2 = [
    { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
  ];
  const state = createInitialState(smallCfg, specs2);
  let s = state;
  const p1Pos = state.players['p1'].pos;
  const p2Pos = state.players['p2'].pos;
  let cx = p1Pos.x, cy = p1Pos.y;
  while (cx !== p2Pos.x - 1 && cx !== p2Pos.x + 1) {
    if (cx < p2Pos.x) cx++; else cx--;
    s = applyEvent(s, { seq: s.seq + 1, type: 'move' as const, actorId: 'p1', createdAt: '', payload: { to: { x: cx, y: cy } } });
  }
  while (cy !== p2Pos.y) {
    if (cy < p2Pos.y) cy++; else cy--;
    s = applyEvent(s, { seq: s.seq + 1, type: 'move' as const, actorId: 'p1', createdAt: '', payload: { to: { x: cx, y: cy } } });
  }
  // Give p1 extra AP (so give_ap doesn't throw "not enough AP")
  s = applyEvent(s, { seq: s.seq + 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 4 } });
  // Reduce p2 HP to 2 (so give_heart can heal from 2 to 3 instead of throwing "at max hp")
  const p2 = s.players['p2'];
  s = { ...s, players: { ...s.players, p2: { ...p2, hp: 2 } } };
  return { state: s };
}

describe('replay', () => {
  it('replays events from scratch to produce final state', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 2, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 3, y: 3 } as unknown },
    ];
    const result = replay(cfg, specs, events);
    expect(result.seq).toBe(2);
    expect(result.day).toBe(2);
    expect(result.hearts).toHaveLength(1);
  });

  it('replays empty events to produce initial state', () => {
    const result = replay(cfg, specs, []);
    expect(result.seq).toBe(0);
    expect(Object.keys(result.players).length).toBe(3);
  });

  it('produces deterministic results on repeated calls', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 2, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 5, y: 5 } as unknown },
    ];
    const a = replay(cfg, specs, events);
    const b = replay(cfg, specs, events);
    expect(a.seq).toBe(b.seq);
    expect(a.day).toBe(b.day);
    expect(a.hearts).toEqual(b.hearts);
    for (const id of ['p1', 'p2', 'p3']) {
      expect(a.players[id].hp).toBe(b.players[id].hp);
      expect(a.players[id].pos).toEqual(b.players[id].pos);
    }
  });

  it('handles a full game sequence: daily ticks, heart spawns, upgrades', () => {
    const state = replay(cfg, specs, [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 2, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 5, y: 5 } as unknown },
      { seq: 3, type: 'upgrade_range' as const, actorId: 'p1', createdAt: '', payload: {} },
      { seq: 4, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 6, y: 6 } as unknown },
      { seq: 5, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
    ]);
    expect(state.seq).toBe(5);
    expect(state.day).toBe(3);
    expect(state.hearts).toHaveLength(2);
    expect(state.players.p1.range).toBe(3);
  });

  it('handles bot_action events in replay', () => {
    const botSpecs = [
      { id: 'bot-1', name: 'Bot', isBot: true, botDifficulty: 'hard' as const },
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ];
    const state = replay(cfg, botSpecs, [
      { seq: 1, type: 'bot_action' as const, actorId: 'bot-1', createdAt: '', payload: { inner: { type: 'upgrade_range' as const, payload: {} } } },
    ]);
    expect(state.players['bot-1'].range).toBe(3);
    expect(state.seq).toBe(1);
  });

  it('rejects bot_action from non-bot actor', () => {
    const botSpecs = [
      { id: 'bot-1', name: 'Bot', isBot: true, botDifficulty: 'hard' as const },
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ];
    expect(() => replay(cfg, botSpecs, [
      { seq: 1, type: 'bot_action' as const, actorId: 'p1', createdAt: '', payload: { inner: { type: 'upgrade_range' as const, payload: {} } } },
    ])).toThrow(/bot/);
  });

  it('handles daily_tick events in replay', () => {
    const state = replay(cfg, specs, [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 2 } },
    ]);
    for (const p of Object.values(state.players)) {
      if (p.hp > 0) expect(p.ap).toBe(6); // startingAp 4 + apGained 2
    }
  });

  it('handles heart_spawn events in replay', () => {
    const state = replay(cfg, specs, [
      { seq: 1, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 3, y: 3 } as unknown },
    ]);
    expect(state.hearts).toHaveLength(1);
    expect(state.hearts![0]).toEqual({ x: 3, y: 3, seq: 1 });
  });

  it('handles fork events in replay (no state change)', () => {
    const state = replay(cfg, specs, [
      { seq: 1, type: 'fork' as const, actorId: 'system', createdAt: '', payload: {} },
    ]);
    expect(state.seq).toBe(1);
    expect(state.log.at(-1)?.text).toMatch(/forked/);
  });

  it('handles join events in replay', () => {
    const state = replay(cfg, [...specs, { id: 'p4', name: 'D', isBot: false, botDifficulty: null }], [
      { seq: 1, type: 'join' as const, actorId: 'system', createdAt: '', payload: { playerId: 'p4' } },
    ]);
    expect(state.players['p4']).toBeDefined();
    expect(state.order).toContain('p4');
  });

  it('handles masked attacks in replay', () => {
    const state = replay(cfg, specs, [
      { seq: 1, type: 'attack' as const, actorId: 'hidden', createdAt: '', payload: { targetId: 'p2', anon: true } },
    ]);
    expect(state.players.p2.hp).toBe(2);
    expect(state.log.at(-1)?.text).toMatch(/Someone/);
  });

  it('handles upgrade_range events in replay', () => {
    const state = replay(cfg, specs, [
      { seq: 1, type: 'upgrade_range' as const, actorId: 'p1', createdAt: '', payload: {} },
    ]);
    expect(state.players.p1.range).toBe(3);
    expect(state.players.p1.ap).toBe(2);
  });

  it('handles give_ap events via applyEvents (position-dependent)', () => {
    const { state } = makeAdjacentState();
    const result = applyEvents(state, [
      { seq: state.seq + 1, type: 'give_ap' as const, actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
    ]);
    expect(result.players.p1.ap).toBeLessThan(state.players.p1.ap);
    expect(result.players.p2.ap).toBeGreaterThan(state.players.p2.ap);
  });

  it('handles give_heart events via applyEvents (position-dependent)', () => {
    const { state } = makeAdjacentState();
    const result = applyEvents(state, [
      { seq: state.seq + 1, type: 'give_heart' as const, actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
    ]);
    expect(result.players.p1.hp).toBeLessThan(state.players.p1.hp);
    expect(result.players.p2.hp).toBeGreaterThanOrEqual(state.players.p2.hp);
  });

  it('handles give_heart to dead target (revive) via applyEvents', () => {
    const smallCfg = { seed: 1, board: 4 as const, startingHp: 3, startingAp: 4, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 };
    const specs2 = [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: true, botDifficulty: 'hard' as const },
    ];
    const init = createInitialState(smallCfg, specs2);
    // Directly place p2 adjacent to p1 (avoids AP costs from moves)
    const p1Pos = init.players['p1'].pos;
    const adjX = Math.max(0, Math.min(smallCfg.board - 1, p1Pos.x + 1));
    let s = { ...init, players: { ...init.players, p2: { ...init.players['p2'], pos: { x: adjX, y: p1Pos.y } } } };
    // p2 attacks p1 twice to reduce HP
    s = applyEvent(s, { seq: s.seq + 1, type: 'bot_action' as const, actorId: 'p2', createdAt: '', payload: { inner: { type: 'attack' as const, payload: { targetId: 'p1' } } } });
    s = applyEvent(s, { seq: s.seq + 1, type: 'bot_action' as const, actorId: 'p2', createdAt: '', payload: { inner: { type: 'attack' as const, payload: { targetId: 'p1' } } } });
    // Give p2 extra AP so give_heart (costs 1 AP) works
    const p2 = s.players['p2'];
    s = { ...s, players: { ...s.players, p2: { ...p2, ap: p2.ap + 4 } } };
    const result = applyEvents(s, [
      { seq: s.seq + 1, type: 'give_heart' as const, actorId: 'p2', createdAt: '', payload: { targetId: 'p1' } },
    ]);
    expect(result.players.p1.hp).toBeGreaterThan(0);
    expect(result.jury).not.toContain('p1');
  });

  it('handles a mixed sequence of all event types', () => {
    const state = replay(cfg, specs, [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 2, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 5, y: 5 } as unknown },
      { seq: 3, type: 'upgrade_range' as const, actorId: 'p1', createdAt: '', payload: {} },
    ]);
    expect(state.seq).toBe(3);
    expect(state.day).toBe(2);
    expect(state.hearts).toHaveLength(1);
    expect(state.players.p1.range).toBe(3);
  });

  it('handles an empty replay with no events', () => {
    const state = replay(cfg, specs, []);
    expect(state.seq).toBe(0);
    expect(state.day).toBe(1);
    expect(state.hearts).toHaveLength(0);
    for (const p of Object.values(state.players)) {
      expect(p.hp).toBe(3);
      expect(p.ap).toBe(4);
    }
  });

  it('handles a single event replay', () => {
    const state = replay(cfg, specs, [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
    ]);
    expect(state.seq).toBe(1);
    expect(state.day).toBe(2);
    for (const p of Object.values(state.players)) {
      if (p.hp > 0) expect(p.ap).toBe(5);
    }
  });
});

describe('applyEvents', () => {
  it('applies events to an existing state (not from scratch)', () => {
    const initialState = createInitialState(cfg, specs);
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 2, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 5, y: 5 } as unknown },
    ];
    const result = applyEvents(initialState, events);
    expect(result.seq).toBe(2);
    expect(result.day).toBe(2);
    expect(result.hearts).toHaveLength(1);
  });

  it('applies zero events to return unchanged state', () => {
    const initialState = createInitialState(cfg, specs);
    const result = applyEvents(initialState, []);
    expect(result.seq).toBe(0);
    expect(result.players).toEqual(initialState.players);
  });

  it('applies events sequentially, chaining state', () => {
    const initialState = createInitialState(cfg, specs);
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 2, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
    ];
    const result = applyEvents(initialState, events);
    expect(result.seq).toBe(2);
    expect(result.day).toBe(3);
    for (const p of Object.values(result.players)) {
      if (p.hp > 0) expect(p.ap).toBe(6); // 4 + 1 + 1
    }
  });

  it('handles mixed event types', () => {
    const initialState = createInitialState(cfg, specs);
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 2, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 5, y: 5 } as unknown },
      { seq: 3, type: 'upgrade_range' as const, actorId: 'p1', createdAt: '', payload: {} },
    ];
    const result = applyEvents(initialState, events);
    expect(result.seq).toBe(3);
    expect(result.day).toBe(2);
    expect(result.hearts).toHaveLength(1);
    expect(result.players.p1.range).toBe(3);
  });

  it('throws on seq gaps when applying to existing state', () => {
    const initialState = createInitialState(cfg, specs);
    const events: GameEvent[] = [
      { seq: 100, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
    ];
    expect(() => applyEvents(initialState, events)).toThrow(/seq gap/);
  });

  it('handles empty events list gracefully', () => {
    const initialState = createInitialState(cfg, specs);
    const result = applyEvents(initialState, []);
    expect(result.seq).toBe(0);
  });

  it('applies events that build state over multiple turns', () => {
    const initialState = createInitialState(cfg, specs);
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 2, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 3, y: 3 } as unknown },
      { seq: 3, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 4, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 4, y: 4 } as unknown },
      { seq: 5, type: 'upgrade_range' as const, actorId: 'p1', createdAt: '', payload: {} },
    ];
    const result = applyEvents(initialState, events);
    expect(result.seq).toBe(5);
    expect(result.day).toBe(3);
    expect(result.hearts).toHaveLength(2);
    expect(result.players.p1.range).toBe(3);
  });

  it('throws on invalid heart_spawn coordinates', () => {
    const initialState = createInitialState(cfg, specs);
    const events: GameEvent[] = [
      { seq: 1, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 100, y: 100 } as unknown },
    ];
    expect(() => applyEvents(initialState, events)).toThrow(/heart_spawn/);
  });

  it('handles a long sequence of alternating events', () => {
    const initialState = createInitialState(cfg, specs);
    const playerPositions = specs.map(s => initialState.players[s.id].pos);
    const events: GameEvent[] = [];
    const spawnedHearts = new Set<string>();
    let seq = 1;
    for (let i = 0; seq <= 20; i++) {
      const hx = (i * 3 + 2) % cfg.board;
      const hy = (i * 5 + 3) % cfg.board;
      const key = `${hx},${hy}`;
      const occupied = playerPositions.some(p => p.x === hx && p.y === hy);
      const dup = spawnedHearts.has(key);
      if (!occupied && !dup) {
        spawnedHearts.add(key);
        events.push({ seq, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: hx, y: hy } as unknown });
        seq++;
        if (seq > 20) break;
      }
      events.push({ seq, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } });
      seq++;
    }
    const result = applyEvents(initialState, events);
    expect(result.hearts).not.toBeNull();
  });

  it('handles give_ap via applyEvents', () => {
    const { state } = makeAdjacentState();
    const result = applyEvents(state, [
      { seq: state.seq + 1, type: 'give_ap' as const, actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
    ]);
    expect(result.players.p1.ap).toBeLessThan(state.players.p1.ap);
    expect(result.players.p2.ap).toBeGreaterThan(state.players.p2.ap);
  });

  it('handles give_heart via applyEvents', () => {
    const { state } = makeAdjacentState();
    const result = applyEvents(state, [
      { seq: state.seq + 1, type: 'give_heart' as const, actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
    ]);
    expect(result.players.p1.hp).toBeLessThan(state.players.p1.hp);
    expect(result.players.p2.hp).toBeGreaterThanOrEqual(state.players.p2.hp);
  });

  it('handles jury_vote via applyEvents (dead voter)', () => {
    const smallCfg = { seed: 1, board: 4 as const, startingHp: 3, startingAp: 4, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 };
    const botSpecs = [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: true, botDifficulty: 'hard' as const },
    ];
    const init = createInitialState(smallCfg, botSpecs);
    // Directly place p2 adjacent to p1 (avoids move AP costs)
    const p1Pos = init.players['p1'].pos;
    const adjX = Math.max(0, Math.min(smallCfg.board - 1, p1Pos.x + 1));
    let s = { ...init, players: { ...init.players, p2: { ...init.players['p2'], pos: { x: adjX, y: p1Pos.y } } } };
    // p2 attacks p1 three times to kill them (p1 starts with 3 hp) — p2 is in range
    s = applyEvent(s, { seq: s.seq + 1, type: 'bot_action' as const, actorId: 'p2', createdAt: '', payload: { inner: { type: 'attack' as const, payload: { targetId: 'p1' } } } });
    s = applyEvent(s, { seq: s.seq + 1, type: 'bot_action' as const, actorId: 'p2', createdAt: '', payload: { inner: { type: 'attack' as const, payload: { targetId: 'p1' } } } });
    s = applyEvent(s, { seq: s.seq + 1, type: 'bot_action' as const, actorId: 'p2', createdAt: '', payload: { inner: { type: 'attack' as const, payload: { targetId: 'p1' } } } });
    expect(s.players.p1.hp).toBe(0);
    expect(s.jury).toContain('p1');
    // Now p1 (dead, in jury) votes — should succeed and go into pendingVotes
    const result = applyEvents(s, [
      { seq: s.seq + 1, type: 'jury_vote' as const, actorId: 'p1', createdAt: '', payload: { candidateId: 'p2' } },
    ]);
    expect(result.jury).toContain('p1');
    expect(result.pendingVotes).toHaveLength(1);
  });

  it('handles an empty events list', () => {
    const initialState = createInitialState(cfg, specs);
    const result = applyEvents(initialState, []);
    expect(result.seq).toBe(0);
    expect(result.players).toEqual(initialState.players);
  });
});

describe('replayToSeq', () => {
  it('replays only events up to the given seq', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 2, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 3, y: 3 } as unknown },
      { seq: 3, type: 'upgrade_range' as const, actorId: 'p1', createdAt: '', payload: {} },
    ];
    const result = replayToSeq(cfg, specs, events, 2);
    expect(result.seq).toBe(2);
    expect(result.day).toBe(2);
    expect(result.hearts).toHaveLength(1);
    expect(result.players.p1.range).toBe(2); // upgrade at seq 3 not applied
  });

  it('replays all events when toSeq exceeds max', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 2, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 5, y: 5 } as unknown },
    ];
    const result = replayToSeq(cfg, specs, events, 100);
    expect(result.seq).toBe(2);
    expect(result.day).toBe(2);
    expect(result.hearts).toHaveLength(1);
  });

  it('returns initial state when toSeq is 0', () => {
    const result = replayToSeq(cfg, specs, [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
    ], 0);
    expect(result.seq).toBe(0);
    expect(Object.keys(result.players).length).toBe(3);
  });

  it('handles empty events list', () => {
    const result = replayToSeq(cfg, specs, [], 5);
    expect(result.seq).toBe(0);
  });

  it('produces same result as replay for toSeq = max seq', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 2, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 5, y: 5 } as unknown },
    ];
    const full = replay(cfg, specs, events);
    const partial = replayToSeq(cfg, specs, events, 2);
    expect(full.seq).toBe(partial.seq);
    expect(full.day).toBe(partial.day);
    expect(full.hearts).toEqual(partial.hearts);
  });

  it('filters out events beyond toSeq before replaying', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 2, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 3, y: 3 } as unknown },
      { seq: 3, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 4, type: 'heart_spawn' as const, actorId: 'system', createdAt: '', payload: { x: 4, y: 4 } as unknown },
    ];
    const result = replayToSeq(cfg, specs, events, 2);
    expect(result.seq).toBe(2);
    expect(result.day).toBe(2);
    expect(result.hearts).toHaveLength(1);
  });

  it('replays to middle seq in a long sequence', () => {
    const events: GameEvent[] = [];
    for (let i = 1; i <= 10; i++) {
      events.push({ seq: i, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } });
    }
    const result = replayToSeq(cfg, specs, events, 5);
    expect(result.seq).toBe(5);
    expect(result.day).toBe(6);
    for (const p of Object.values(result.players)) {
      if (p.hp > 0) expect(p.ap).toBe(9); // 4 + 5*1
    }
  });

  it('correctly truncates at seq 1 in a multi-seq sequence', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 2, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 3, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } },
    ];
    const result = replayToSeq(cfg, specs, events, 1);
    expect(result.seq).toBe(1);
    expect(result.day).toBe(2);
    for (const p of Object.values(result.players)) {
      if (p.hp > 0) expect(p.ap).toBe(5); // 4 + 1
    }
  });

  it('handles a 20-event replayToSeq sequence', () => {
    const events: GameEvent[] = [];
    for (let i = 1; i <= 20; i++) {
      events.push({ seq: i, type: 'daily_tick' as const, actorId: 'system', createdAt: '', payload: { apGained: 1 } });
    }
    const result = replayToSeq(cfg, specs, events, 10);
    expect(result.seq).toBe(10);
    expect(result.day).toBe(11);
    for (const p of Object.values(result.players)) {
      if (p.hp > 0) expect(p.ap).toBe(14); // 4 + 10*1
    }
  });
});
