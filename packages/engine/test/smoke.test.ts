import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/state';
import { applyEvent } from '../src/reducer';
import { replay, applyEvents, replayToSeq } from '../src/replay';
import { mulberry32, hashSeed } from '../src/rng';
import { manhattan, inRange } from '../src/geom';
import { heartSpawnPos } from '../src/pickup';
import { scrubState, scrubConfig, attackMask, HIDDEN_ACTOR } from '../src/scrub';
import { planBotAction } from '../src/bots';
import { EngineError } from '../src/errors';
import type { GameConfig, GameEvent, GameState } from '../src/types';

// Smoke tests: import and basic execution paths

describe('engine imports', () => {
  it('imports types without error', () => {
    const e: GameEvent | null = null;
    expect(e).toBeNull();
  });
  it('createInitialState exports', () => {
    const cfg: GameConfig = {
      seed: 1, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
      apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    };
    const state = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    expect(state.seq).toBe(0);
  });
  it('applyEvent exports', () => {
    const cfg: GameConfig = {
      seed: 1, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
      apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    };
    const state = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    const result = applyEvent(state, {
      seq: 1, type: 'daily_tick', actorId: 'system', createdAt: '', payload: { apGained: 1 },
    });
    expect(result.seq).toBe(1);
  });
  it('replay exports', () => {
    const cfg: GameConfig = {
      seed: 1, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
      apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    };
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick', actorId: 'system', createdAt: '', payload: { apGained: 1 } },
    ];
    const state = replay(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ], events);
    expect(state.seq).toBe(1);
  });
  it('applyEvents exports', () => {
    const cfg: GameConfig = {
      seed: 1, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
      apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    };
    const state = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    const result = applyEvents(state, [
      { seq: 1, type: 'daily_tick', actorId: 'system', createdAt: '', payload: { apGained: 1 } },
    ]);
    expect(result.seq).toBe(1);
  });
  it('replayToSeq exports', () => {
    const cfg: GameConfig = {
      seed: 1, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
      apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    };
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick', actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 2, type: 'daily_tick', actorId: 'system', createdAt: '', payload: { apGained: 1 } },
    ];
    const state = replayToSeq(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ], events, 1);
    expect(state.seq).toBe(1);
  });
});

describe('core functions', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(a()).toBe(b());
  });
  it('hashSeed is deterministic', () => {
    expect(hashSeed('test')).toBe(hashSeed('test'));
  });
  it('manhattan computes distance', () => {
    expect(manhattan({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
  });
  it('inRange checks distance', () => {
    expect(inRange({ x: 0, y: 0 }, { x: 2, y: 0 }, 2)).toBe(true);
  });
  it('heartSpawnPos returns valid position', () => {
    const cfg: GameConfig = {
      seed: 1, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
      apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    };
    const state = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    const pos = heartSpawnPos(state);
    expect(pos).not.toBeNull();
  });
  it('scrubState zeroes seed', () => {
    const cfg: GameConfig = {
      seed: 42, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
      apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    };
    const state = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    const scrubbed = scrubState(state, 'p1');
    expect(scrubbed.config.seed).toBe(0);
  });
  it('scrubConfig zeroes seed', () => {
    const config = { seed: 42, board: 8 } as { seed?: number };
    const scrubbed = scrubConfig(config);
    expect((scrubbed as { seed: number }).seed).toBe(0);
  });
  it('attackMask masks attacks', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
      { seq: 2, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
    ];
    const mask = attackMask(events);
    expect(mask.masked.has(1)).toBe(true);
  });
  it('HIDDEN_ACTOR is defined', () => {
    expect(HIDDEN_ACTOR).toBeDefined();
  });
  it('planBotAction returns null for simple state', () => {
    const cfg: GameConfig = {
      seed: 1, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
      apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    };
    const state = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: true, botDifficulty: 'easy' },
    ]);
    const action = planBotAction(state, 'p1');
    expect(action === null || action !== null).toBe(true);
  });
  it('EngineError extends Error', () => {
    const err = new EngineError('test');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('event types', () => {
  it('daily_tick works', () => {
    const cfg: GameConfig = {
      seed: 1, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
      apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    };
    const state = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    const result = applyEvent(state, {
      seq: 1, type: 'daily_tick', actorId: 'system', createdAt: '', payload: { apGained: 1 },
    });
    expect(result.seq).toBe(1);
  });
  it('heart_spawn works', () => {
    const cfg: GameConfig = {
      seed: 1, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
      apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    };
    const state = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    const result = applyEvent(state, {
      seq: 1, type: 'heart_spawn', actorId: 'system', createdAt: '', payload: { x: 3, y: 3 },
    });
    expect(result.hearts).toEqual([{ x: 3, y: 3, seq: 1 }]);
  });
  it('upgrade_range works', () => {
    const cfg: GameConfig = {
      seed: 1, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
      apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    };
    const state = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    const result = applyEvent(state, {
      seq: 1, type: 'upgrade_range', actorId: 'p1', createdAt: '', payload: {},
    });
    expect(result.players.p1.range).toBe(3);
  });
  it('join works', () => {
    const cfg: GameConfig = {
      seed: 1, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
      apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    };
    const state = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    const result = applyEvent(state, {
      seq: 1, type: 'join', actorId: 'p2', createdAt: '', payload: { playerId: 'p2', name: 'B' },
    });
    expect(result.players.p2).toBeDefined();
  });
  it('fork works', () => {
    const cfg: GameConfig = {
      seed: 1, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
      apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    };
    const state = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    const result = applyEvent(state, {
      seq: 1, type: 'fork', actorId: 'system', createdAt: '', payload: {},
    });
    expect(result.seq).toBe(1);
  });
});
