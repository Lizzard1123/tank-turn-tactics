import { describe, it, expect } from 'vitest';
import {
  HIDDEN_ACTOR,
  attackMask,
  maskEvents,
  maskLog,
  attackActors,
  scrubState,
  scrubConfig,
} from '../src/scrub';
import { applyEvent } from '../src/reducer';
import { createInitialState } from '../src/state';
import type { GameEvent, GameState, LogEntry, PlayerId } from '../src/types';

describe('HIDDEN_ACTOR', () => {
  it('is the string "hidden"', () => {
    expect(HIDDEN_ACTOR).toBe('hidden');
  });
});

describe('attackMask', () => {
  it('masks all but last attack per victim', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
      { seq: 2, type: 'attack', actorId: 'p3', createdAt: '', payload: { targetId: 'p2' } },
      { seq: 3, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p3' } },
      { seq: 4, type: 'attack', actorId: 'p3', createdAt: '', payload: { targetId: 'p2' } }, // last for p2
    ];
    const mask = attackMask(events);
    expect(mask.masked.has(1)).toBe(true); // first attack on p2
    expect(mask.masked.has(2)).toBe(true); // second attack on p2
    expect(mask.masked.has(3)).toBe(false); // only one attack on p3
    expect(mask.masked.has(4)).toBe(false); // last attack on p2
  });

  it('returns empty mask for non-attack events', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick', actorId: 'system', createdAt: '', payload: { apGained: 1 } },
    ];
    const mask = attackMask(events);
    expect(mask.masked.size).toBe(0);
  });

  it('handles single attack per victim', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
      { seq: 2, type: 'attack', actorId: 'p3', createdAt: '', payload: { targetId: 'p2' } },
    ];
    const mask = attackMask(events);
    expect(mask.masked.size).toBe(1); // only seq 1 masked
  });

  it('builds victimBySeq map', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
    ];
    const mask = attackMask(events);
    expect(mask.victimBySeq.get(1)).toBe('p2');
  });

  it('handles multiple victims', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
      { seq: 2, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p3' } },
      { seq: 3, type: 'attack', actorId: 'p2', createdAt: '', payload: { targetId: 'p2' } },
      { seq: 4, type: 'attack', actorId: 'p3', createdAt: '', payload: { targetId: 'p3' } },
    ];
    const mask = attackMask(events);
    // p2: seqs 1, 3 -> mask 1, keep 3
    // p3: seqs 2, 4 -> mask 2, keep 4
    expect(mask.masked.has(1)).toBe(true);
    expect(mask.masked.has(2)).toBe(true);
    expect(mask.masked.has(3)).toBe(false);
    expect(mask.masked.has(4)).toBe(false);
  });
});

describe('maskEvents', () => {
  it('replaces actorId with hidden for masked attacks (two attacks on same victim)', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
      { seq: 2, type: 'attack', actorId: 'p3', createdAt: '', payload: { targetId: 'p2' } },
    ];
    const mask = attackMask(events);
    expect(mask.masked.has(1)).toBe(true); // first attack on p2 is masked
    const masked = maskEvents(events, 'p2', mask);
    expect(masked[0].actorId).toBe(HIDDEN_ACTOR);
    expect((masked[0].payload as { anon: boolean }).anon).toBe(true);
  });

  it('does not mask own attacks', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
    ];
    const mask = attackMask(events);
    const masked = maskEvents(events, 'p1', mask);
    expect(masked[0].actorId).toBe('p1');
  });

  it('leaves non-attack events unchanged', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick', actorId: 'system', createdAt: '', payload: { apGained: 1 } },
    ];
    const mask = attackMask([]);
    const masked = maskEvents(events, 'p1', mask);
    expect(masked[0].type).toBe('daily_tick');
    expect(masked[0].actorId).toBe('system');
  });

  it('leaves last attack on victim unchanged', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
      { seq: 2, type: 'attack', actorId: 'p3', createdAt: '', payload: { targetId: 'p2' } },
    ];
    const mask = attackMask(events);
    const masked = maskEvents(events, 'p2', mask);
    expect(masked[1].actorId).toBe('p3'); // last attack not masked
  });

  it('handles empty events', () => {
    const mask = attackMask([]);
    const masked = maskEvents([], 'p1', mask);
    expect(masked).toEqual([]);
  });
});

describe('maskLog', () => {
  it('rewrites masked attack log lines', () => {
    const actorBySeq = new Map<number, PlayerId>();
    actorBySeq.set(1, 'p1');
    actorBySeq.set(2, 'p3');
    const events: GameEvent[] = [
      { seq: 1, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
      { seq: 2, type: 'attack', actorId: 'p3', createdAt: '', payload: { targetId: 'p2' } },
    ];
    const mask = attackMask(events);
    const log: LogEntry[] = [
      { seq: 1, type: 'attack', text: 'p1 attacked p2 for 1 damage', createdAt: '' },
      { seq: 2, type: 'attack', text: 'p3 attacked p2 for 1 damage', createdAt: '' },
    ];
    const targetName = (id: PlayerId) => id;
    const masked = maskLog(log, actorBySeq, 'p2', mask, targetName);
    expect(masked[0].text).toBe('Someone attacked p2 for 1 damage'); // masked
    expect(masked[1].text).toBe('p3 attacked p2 for 1 damage'); // own attack, not masked
  });

  it('leaves own attacks attributed', () => {
    const actorBySeq = new Map<number, PlayerId>();
    actorBySeq.set(1, 'p1');
    const log: LogEntry[] = [
      { seq: 1, type: 'attack', text: 'p1 attacked p2 for 1 damage', createdAt: '' },
    ];
    const mask = attackMask([{ seq: 1, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } } as GameEvent]);
    const targetName = (id: PlayerId) => id;
    const masked = maskLog(log, actorBySeq, 'p1', mask, targetName);
    expect(masked[0].text).toBe('p1 attacked p2 for 1 damage');
  });

  it('leaves non-attack log entries unchanged', () => {
    const actorBySeq = new Map<number, PlayerId>();
    const log: LogEntry[] = [
      { seq: 1, type: 'daily_tick', text: 'Day 2 begins', createdAt: '' },
    ];
    const mask = attackMask([]);
    const targetName = (id: PlayerId) => id;
    const masked = maskLog(log, actorBySeq, 'p1', mask, targetName);
    expect(masked[0].text).toBe('Day 2 begins');
  });

  it('handles empty log', () => {
    const actorBySeq = new Map<number, PlayerId>();
    const mask = attackMask([]);
    const targetName = (id: PlayerId) => id;
    const masked = maskLog([], actorBySeq, 'p1', mask, targetName);
    expect(masked).toEqual([]);
  });

  it('handles multiple masked entries', () => {
    const actorBySeq = new Map<number, PlayerId>();
    actorBySeq.set(1, 'p1');
    actorBySeq.set(2, 'p3');
    const events: GameEvent[] = [
      { seq: 1, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
      { seq: 2, type: 'attack', actorId: 'p3', createdAt: '', payload: { targetId: 'p2' } },
    ];
    const mask = attackMask(events);
    const log: LogEntry[] = [
      { seq: 1, type: 'attack', text: 'p1 attacked p2 for 1 damage', createdAt: '' },
      { seq: 2, type: 'attack', text: 'p3 attacked p2 for 1 damage', createdAt: '' },
    ];
    const targetName = (id: PlayerId) => id;
    const masked = maskLog(log, actorBySeq, 'p2', mask, targetName);
    expect(masked[0].text).toBe('Someone attacked p2 for 1 damage');
    expect(masked[1].text).toBe('p3 attacked p2 for 1 damage'); // own attack
  });
});

describe('attackActors', () => {
  it('builds map of attack seqs to actor ids', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
      { seq: 2, type: 'daily_tick', actorId: 'system', createdAt: '', payload: { apGained: 1 } },
      { seq: 3, type: 'attack', actorId: 'p3', createdAt: '', payload: { targetId: 'p2' } },
    ];
    const actors = attackActors(events);
    expect(actors.get(1)).toBe('p1');
    expect(actors.get(3)).toBe('p3');
    expect(actors.has(2)).toBe(false); // not an attack
  });

  it('handles empty events', () => {
    const actors = attackActors([]);
    expect(actors.size).toBe(0);
  });

  it('handles only non-attack events', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'daily_tick', actorId: 'system', createdAt: '', payload: { apGained: 1 } },
    ];
    const actors = attackActors(events);
    expect(actors.size).toBe(0);
  });

  it('overwrites with latest actor per seq', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
    ];
    const actors = attackActors(events);
    expect(actors.get(1)).toBe('p1');
  });
});

describe('scrubState', () => {
  it('zeroes the seed', () => {
    const state: GameState = {
      seq: 0, day: 1,
      config: { seed: 42, board: 8, startingHp: 3, startingAp: 4, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 },
      players: { p1: { pos: { x: 0, y: 0 }, hp: 3, ap: 4, range: 2, isBot: false, botDifficulty: null } },
      hearts: null, order: ['p1'], log: [], jury: [], pendingVotes: [],
    } as GameState;
    const scrubbed = scrubState(state, 'p1');
    expect(scrubbed.config.seed).toBe(0);
  });

  it('sets others ap and range to -1', () => {
    const state: GameState = {
      seq: 0, day: 1,
      config: { seed: 42, board: 8, startingHp: 3, startingAp: 4, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 },
      players: {
        p1: { pos: { x: 0, y: 0 }, hp: 3, ap: 4, range: 2, isBot: false, botDifficulty: null },
        p2: { pos: { x: 1, y: 1 }, hp: 3, ap: 5, range: 3, isBot: false, botDifficulty: null },
      },
      hearts: null, order: ['p1', 'p2'], log: [], jury: [], pendingVotes: [],
    } as GameState;
    const scrubbed = scrubState(state, 'p1');
    expect((scrubbed.players.p2 as any).ap).toBe(-1);
    expect((scrubbed.players.p2 as any).range).toBe(-1);
  });

  it('keeps self ap and range real', () => {
    const state: GameState = {
      seq: 0, day: 1,
      config: { seed: 42, board: 8, startingHp: 3, startingAp: 4, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 },
      players: { p1: { pos: { x: 0, y: 0 }, hp: 3, ap: 4, range: 2, isBot: false, botDifficulty: null } },
      hearts: null, order: ['p1'], log: [], jury: [], pendingVotes: [],
    } as GameState;
    const scrubbed = scrubState(state, 'p1');
    expect(scrubbed.players.p1!.ap).toBe(4);
    expect(scrubbed.players.p1!.range).toBe(2);
  });

  it('preserves player positions', () => {
    const state: GameState = {
      seq: 0, day: 1,
      config: { seed: 42, board: 8, startingHp: 3, startingAp: 4, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 },
      players: { p1: { pos: { x: 5, y: 5 }, hp: 3, ap: 4, range: 2, isBot: false, botDifficulty: null } },
      hearts: null, order: ['p1'], log: [], jury: [], pendingVotes: [],
    } as GameState;
    const scrubbed = scrubState(state, 'p1');
    expect(scrubbed.players.p1!.pos).toEqual({ x: 5, y: 5 });
  });

  it('preserves hearts', () => {
    const state: GameState = {
      seq: 0, day: 1,
      config: { seed: 42, board: 8, startingHp: 3, startingAp: 4, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 },
      players: { p1: { pos: { x: 0, y: 0 }, hp: 3, ap: 4, range: 2, isBot: false, botDifficulty: null } },
      hearts: [{ seq: 1, x: 3, y: 3 }], order: ['p1'], log: [], jury: [], pendingVotes: [],
    } as GameState;
    const scrubbed = scrubState(state, 'p1');
    expect(scrubbed.hearts).toEqual([{ seq: 1, x: 3, y: 3 }]);
  });

  it('preserves seq and day', () => {
    const state: GameState = {
      seq: 10, day: 5,
      config: { seed: 42, board: 8, startingHp: 3, startingAp: 4, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 },
      players: { p1: { pos: { x: 0, y: 0 }, hp: 3, ap: 4, range: 2, isBot: false, botDifficulty: null } },
      hearts: null, order: ['p1'], log: [], jury: [], pendingVotes: [],
    } as GameState;
    const scrubbed = scrubState(state, 'p1');
    expect(scrubbed.seq).toBe(10);
    expect(scrubbed.day).toBe(5);
  });

  it('handles multiple players', () => {
    const state: GameState = {
      seq: 0, day: 1,
      config: { seed: 42, board: 8, startingHp: 3, startingAp: 4, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 },
      players: {
        p1: { pos: { x: 0, y: 0 }, hp: 3, ap: 4, range: 2, isBot: false, botDifficulty: null },
        p2: { pos: { x: 1, y: 1 }, hp: 3, ap: 5, range: 3, isBot: false, botDifficulty: null },
        p3: { pos: { x: 2, y: 2 }, hp: 3, ap: 6, range: 4, isBot: false, botDifficulty: null },
      },
      hearts: null, order: ['p1', 'p2', 'p3'], log: [], jury: [], pendingVotes: [],
    } as GameState;
    const scrubbed = scrubState(state, 'p2');
    expect((scrubbed.players.p1 as any).ap).toBe(-1);
    expect(scrubbed.players.p2!.ap).toBe(5);
    expect((scrubbed.players.p3 as any).ap).toBe(-1);
  });
});

describe('scrubConfig', () => {
  it('zeroes the seed', () => {
    const config = { seed: 42, board: 8 } as { seed?: number };
    const scrubbed = scrubConfig(config);
    expect((scrubbed as { seed: number }).seed).toBe(0);
  });

  it('preserves other config fields', () => {
    const config = { seed: 42, board: 8, startingHp: 3 } as { seed?: number; board: number; startingHp: number };
    const scrubbed = scrubConfig(config);
    expect((scrubbed as { board: number }).board).toBe(8);
    expect((scrubbed as { startingHp: number }).startingHp).toBe(3);
  });

  it('handles seed already zero', () => {
    const config = { seed: 0, board: 8 } as { seed?: number };
    const scrubbed = scrubConfig(config);
    expect((scrubbed as { seed: number }).seed).toBe(0);
  });

  it('handles missing seed', () => {
    const config: { seed?: undefined; board: number } = { board: 8 };
    const scrubbed = scrubConfig(config);
    // scrubConfig always sets seed: 0, so 'seed' will be present
    expect((scrubbed as { seed?: number }).seed).toBe(0);
  });

  it('returns a new object', () => {
    const config = { seed: 42, board: 8 } as { seed?: number; board: number };
    const scrubbed = scrubConfig(config);
    expect(scrubbed).not.toBe(config);
  });
});

describe('jury secrecy in the scrub layer', () => {
  const emptyMask = { masked: new Set<number>(), victimBySeq: new Map<number, PlayerId>() };
  const noActors = new Map<number, PlayerId>();
  const idName = (id: PlayerId) => id;

  it('maskLog drops jury outcome entries for living viewers', () => {
    const log: LogEntry[] = [
      { seq: 1, text: 'Day 2: all alive players gain 1 AP' },
      { seq: 2, text: 'The jury haunted p1', kind: 'jury' },
    ];
    const masked = maskLog(log, noActors, 'p3', emptyMask, idName);
    expect(masked).toHaveLength(1);
    expect(masked[0].text).toBe('Day 2: all alive players gain 1 AP');
  });

  it('maskLog drops legacy per-vote lines and strips legacy day-line suffixes', () => {
    const log: LogEntry[] = [
      { seq: 1, text: 'Jury member p2 voted for p1' },
      { seq: 2, text: 'Day 2: all alive players gain 1 AP (+1 jury AP to p1), p1 is haunted (no AP)' },
      { seq: 3, text: 'p1 attacked p2 for 1 damage' },
    ];
    const masked = maskLog(log, noActors, 'p3', emptyMask, idName);
    expect(masked).toHaveLength(2);
    expect(masked[0].text).toBe('Day 2: all alive players gain 1 AP');
    expect(masked[1].text).toBe('p1 attacked p2 for 1 damage');
  });

  it('maskEvents redacts jury_result payloads for viewers without the reveal', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'jury_result', actorId: 'system', createdAt: '', payload: { haunted: ['p1'] } },
      { seq: 2, type: 'attack', actorId: 'p1', createdAt: '', payload: { targetId: 'p2' } },
    ];
    const masked = maskEvents(events, 'p3', emptyMask);
    expect(masked[0].payload).toEqual({ redacted: true });
    expect(masked[0].type).toBe('jury_result'); // seq/type intact for replay
    expect(masked[1]).toBe(events[1]); // attacks untouched by an empty mask
  });

  it('a redacted jury_result replays through the engine without a log entry', () => {
    const s = createInitialState({
      seed: 1, board: 4, startingHp: 3, startingAp: 0, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    }, [{ id: 'p1', name: 'A', isBot: false, botDifficulty: null }]);
    const redacted: GameEvent = {
      seq: s.seq + 1, type: 'jury_result', actorId: 'system', createdAt: '', payload: { redacted: true },
    };
    const next = applyEvent(s, redacted);
    expect(next.seq).toBe(s.seq + 1);
    expect(next.log).toEqual(s.log); // no entry appended
  });

  it('scrubState hides other players apEarned along with ap', () => {
    const s = createInitialState({
      seed: 1, board: 4, startingHp: 3, startingAp: 2, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
    }, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
    ]);
    const scrubbed = scrubState(s, 'p1');
    expect(scrubbed.players.p2.apEarned).toBe(-1);
    expect(scrubbed.players.p1.apEarned).toBe(2);
  });
});
