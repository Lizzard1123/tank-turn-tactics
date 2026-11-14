import { describe, it, expect } from 'vitest';
import { applyEvent, createInitialState, heartSpawnPos, type GameConfig, type GameEvent, type GameState } from '../src';
import { EngineError } from '../src/errors';
import { planBotAction } from '../src/bots';
import { mulberry32, hashSeed } from '../src/rng';

const cfg: GameConfig = {
  seed: 7, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
};

function ev(state: GameState, actorId: string, type: GameEvent['type'], payload: Record<string, unknown> = {}): GameEvent {
  return { seq: state.seq + 1, type, actorId, createdAt: '2026-01-01T00:00:00Z', payload };
}

function placeAdjacent(s: GameState, a: string, b: string): GameState {
  const bp = s.players[b].pos;
  const nx = bp.x + 1 <= 7 ? bp.x + 1 : bp.x - 1;
  return { ...s, players: { ...s.players, [a]: { ...s.players[a], pos: { x: nx, y: bp.y } } } };
}

function base(specs = [
  { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
  { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
  { id: 'p3', name: 'C', isBot: false, botDifficulty: null },
]) {
  return createInitialState(cfg, specs);
}

// =======================================================================
// heartSpawnPos (pickup.ts)
// =======================================================================

describe('heartSpawnPos', () => {
  it('never spawns on an alive player', () => {
    const s = base();
    for (let i = 0; i < 50; i++) {
      const pos = heartSpawnPos({ ...s, config: { ...s.config, seed: i } });
      if (pos) {
        for (const p of Object.values(s.players)) {
          expect(pos.x !== p.pos.x || pos.y !== p.pos.y).toBe(true);
        }
      }
    }
  });

  it('never spawns on an existing heart', () => {
    const s = { ...base(), hearts: [{ x: 3, y: 3, seq: 1 }] };
    const pos = heartSpawnPos(s);
    expect(pos).not.toEqual({ x: 3, y: 3 });
  });

  it('allows spawning on a grave (dead player square)', () => {
    const s = { ...base(), players: { ...base().players, p2: { ...base().players.p2, hp: 0 } } };
    const pos = heartSpawnPos(s);
    expect(pos).not.toBeNull();
  });

  it('returns null when the board is full', () => {
    const single = { ...base(), config: { ...cfg, board: 1 } };
    const full = { ...single, players: { p1: { ...single.players.p1, pos: { x: 0, y: 0 } } } };
    expect(heartSpawnPos(full)).toBeNull();
  });

  it('random placement picks a valid candidate', () => {
    const s = { ...base(), hearts: [{ x: 0, y: 0, seq: 1 }] };
    const pos = heartSpawnPos({ ...s, config: { ...s.config, heartPlacement: 'random' } });
    if (pos) {
      const occ = Object.values(s.players).some(p => p.pos.x === pos.x && p.pos.y === pos.y && p.hp > 0);
      const onHeart = s.hearts!.some(h => h.x === pos.x && h.y === pos.y);
      expect(occ).toBe(false);
      expect(onHeart).toBe(false);
    }
  });

  it('smart placement maximizes distance from alive players and hearts', () => {
    const s = { ...base(), hearts: [{ x: 0, y: 0, seq: 1 }] };
    const pos = heartSpawnPos({ ...s, config: { ...s.config, heartPlacement: 'smart' } });
    expect(pos).not.toBeNull();
    if (pos) expect(pos.x + pos.y).toBeGreaterThan(0);
  });
});

// =======================================================================
// apStealOnKill
// =======================================================================

describe('apStealOnKill', () => {
  it('killer loots victim AP on the killing blow', () => {
    const stealCfg: GameConfig = { ...cfg, apStealOnKill: true };
    let s = createInitialState(stealCfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
    ]);
    s = placeAdjacent(s, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, ap: 5 }, p2: { ...s.players.p2, hp: 1, ap: 7 } } };
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.players.p2.hp).toBe(0);
    expect(s.players.p2.ap).toBe(0);
    expect(s.players.p1.ap).toBe(5 - 1 + 7);
    expect(s.jury).toContain('p2');
    expect(s.winner).toBe('p1');
  });

  it('without apStealOnKill, victim AP is preserved on kill', () => {
    let s = base();
    s = placeAdjacent(s, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, ap: 5 }, p2: { ...s.players.p2, hp: 1, ap: 7 } } };
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.players.p2.ap).toBe(7);
    expect(s.players.p1.ap).toBe(4);
  });
});

// =======================================================================
// give_heart edge cases
// =======================================================================

describe('give_heart edge cases', () => {
  const heartCfg: GameConfig = { ...cfg, heartGifts: true, revives: true };

  it('cannot gift yourself', () => {
    const s = createInitialState(heartCfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
    ]);
    expect(() => applyEvent(s, ev(s, 'p1', 'give_heart', { targetId: 'p1' }))).toThrow(EngineError);
  });

  it('target at max hp throws', () => {
    const s = createInitialState(heartCfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
    ]);
    expect(() => applyEvent(s, ev(s, 'p1', 'give_heart', { targetId: 'p2' }))).toThrow(EngineError);
  });

  it('giver with hp < 2 throws', () => {
    let s = createInitialState(heartCfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
    ]);
    s = placeAdjacent(s, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, hp: 1 }, p2: { ...s.players.p2, hp: 2 } } };
    expect(() => applyEvent(s, ev(s, 'p1', 'give_heart', { targetId: 'p2' }))).toThrow(EngineError);
  });

  it('heals an under-max ally', () => {
    let s = createInitialState(heartCfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
    ]);
    s = placeAdjacent(s, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, hp: 3 }, p2: { ...s.players.p2, hp: 2 } } };
    s = applyEvent(s, ev(s, 'p1', 'give_heart', { targetId: 'p2' }));
    expect(s.players.p1.hp).toBe(2);
    expect(s.players.p2.hp).toBe(3);
  });

  it('revive: dead target returns at 1 hp / 0 AP, leaves jury, claims heart under feet', () => {
    let s = createInitialState(heartCfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
    ]);
    s = placeAdjacent(s, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, hp: 3 }, p2: { ...s.players.p2, hp: 0 } },
      jury: ['p2'], hearts: [{ x: s.players.p2.pos.x, y: s.players.p2.pos.y, seq: 1 }] };
    s = applyEvent(s, ev(s, 'p1', 'give_heart', { targetId: 'p2' }));
    expect(s.players.p2.hp).toBe(2); // revive to 1 + heart under feet heals +1
    expect(s.players.p2.ap).toBe(0);
    expect(s.jury).not.toContain('p2');
    expect(s.hearts).toHaveLength(0);
  });
});

// =======================================================================
// juryHaunt
// =======================================================================

describe('juryHaunt', () => {
  const hauntCfg: GameConfig = { ...cfg, juryHaunt: true };

  it('most-voted player gets no AP drip on the next tick', () => {
    const init = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
      { id: 'p3', name: 'C', isBot: false, botDifficulty: null },
    ]);
    let s = { ...init, config: hauntCfg, jury: ['p2', 'p3'],
      players: { ...init.players, p2: { ...init.players.p2, hp: 0 }, p3: { ...init.players.p3, hp: 0 } },
      pendingVotes: [
        { voterId: 'p2', candidateId: 'p1' },
        { voterId: 'p3', candidateId: 'p1' },
      ] };
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p1.ap).toBe(4); // starting AP, no drip (haunted), 2 votes < 3 no bonus
    expect(s.haunted).toBe('p1');
    expect(s.pendingVotes).toEqual([]);
  });

  it('a tie haunts nobody', () => {
    const init = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
      { id: 'p3', name: 'C', isBot: false, botDifficulty: null },
    ]);
    let s = { ...init, config: hauntCfg, jury: ['p2', 'p3'],
      players: { ...init.players, p2: { ...init.players.p2, hp: 0 }, p3: { ...init.players.p3, hp: 0 } },
      pendingVotes: [
        { voterId: 'p2', candidateId: 'p1' },
        { voterId: 'p3', candidateId: 'p2' },
      ] };
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.haunted).toBeNull();
    expect(s.players.p1.ap).toBe(5); // starting 4 + drip 1, tie haunts nobody
  });

  it('jury bonus still applies to the haunted player', () => {
    const specs4 = [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
      { id: 'p3', name: 'C', isBot: false, botDifficulty: null },
      { id: 'p4', name: 'D', isBot: false, botDifficulty: null },
    ];
    const init = createInitialState(cfg, specs4);
    let s = { ...init, config: hauntCfg, jury: ['p2', 'p3', 'p4'],
      players: { ...init.players, p2: { ...init.players.p2, hp: 0 }, p3: { ...init.players.p3, hp: 0 }, p4: { ...init.players.p4, hp: 0 } },
      pendingVotes: [
        { voterId: 'p2', candidateId: 'p1' },
        { voterId: 'p3', candidateId: 'p1' },
        { voterId: 'p4', candidateId: 'p1' },
      ] };
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p1.ap).toBe(5); // starting 4, no drip (haunted), +1 jury bonus
    expect(s.haunted).toBe('p1');
  });
});

// =======================================================================
// bots edge cases
// =======================================================================

describe('bots edge cases', () => {
  const botCfg: GameConfig = { ...cfg, startingAp: 6, seed: 42 };

  it('easy bot with ap <= 0 returns null', () => {
    const s = createInitialState(botCfg, [
      { id: 'b1', name: 'Bot', isBot: true, botDifficulty: 'easy' },
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    const poor = { ...s, players: { ...s.players, b1: { ...s.players.b1, ap: 0 } } };
    expect(planBotAction(poor, 'b1')).toBeNull();
  });

  it('bot returns null when no targets and no moves (blocked on all sides)', () => {
    const s = createInitialState(botCfg, [
      { id: 'b1', name: 'Bot', isBot: true, botDifficulty: 'hard' },
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
      { id: 'p3', name: 'C', isBot: false, botDifficulty: null },
    ]);
    const bp = s.players.b1.pos;
    const surrounded = {
      ...s,
      players: {
        ...s.players,
        b1: { ...s.players.b1, ap: 6, pos: bp },
        p1: { ...s.players.p1, pos: { x: bp.x + 1, y: bp.y } },
        p2: { ...s.players.p2, pos: { x: bp.x - 1, y: bp.y } },
        p3: { ...s.players.p3, pos: { x: bp.x, y: bp.y + 1 } },
      },
      order: [...s.order],
    };
    const a = planBotAction(surrounded, 'b1');
    expect(a === null || ['move', 'attack', 'give_ap', 'upgrade_range'].includes(a.type)).toBe(true);
  });
});

// =======================================================================
// join event (reducer)
// =======================================================================

describe('join event', () => {
  it('spawns a new player on the first free cell (row-major)', () => {
    const s = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
    ]);
    const before = Object.keys(s.players).length;
    const joined = applyEvent(s, ev(s, 'p3', 'join', { playerId: 'p3', name: 'C' }));
    expect(joined.players.p3).toBeDefined();
    expect(Object.keys(joined.players).length).toBe(before + 1);
    expect(joined.order).toContain('p3');
    expect(joined.seq).toBe(1);
  });

  it('join is idempotent if player already exists (no-op for scrubbing)', () => {
    const s = base();
    const joined = applyEvent(s, ev(s, 'p1', 'join', { playerId: 'p1', name: 'A' }));
    expect(joined.players.p1).toBe(s.players.p1);
    expect(joined.log.at(-1)!.text).toContain('joined');
  });

  it('rejects join when board is full', () => {
    const s = { ...base(), config: { ...cfg, board: 1 } };
    const full = { ...s, players: { p1: { ...s.players.p1, pos: { x: 0, y: 0 } } } };
    expect(() => applyEvent(full, ev(full, 'p2', 'join', { playerId: 'p2', name: 'B' }))).toThrow(EngineError);
  });
});

// =======================================================================
// fork event (reducer) — log-only, no state change
// =======================================================================

describe('fork event', () => {
  it('is log-only: no state change, just appends a log entry', () => {
    const s = base();
    const forked = applyEvent(s, ev(s, 'system', 'fork', { toSeq: 0 }));
    expect(forked.seq).toBe(1);
    expect(forked.players.p1.range).toBe(2); // unchanged
    expect(forked.log.at(-1)!.text).toMatch(/fork/i);
  });
});

// =======================================================================
// jury_vote edge cases
// =======================================================================

describe('jury_vote', () => {
  const juryCfg: GameConfig = { ...cfg, juryHaunt: false };

  it('rejects vote from alive player', () => {
    const s = createInitialState(juryCfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
    ]);
    expect(() => applyEvent(s, ev(s, 'p1', 'jury_vote', { candidateId: 'p2' }))).toThrow(EngineError);
  });

  it('rejects duplicate vote same day', () => {
    let s = { ...base(), jury: ['p2'], players: { ...base().players, p2: { ...base().players.p2, hp: 0 } } };
    s = applyEvent(s, ev(s, 'p2', 'jury_vote', { candidateId: 'p1' }));
    expect(() => applyEvent(s, ev(s, 'p2', 'jury_vote', { candidateId: 'p1' }))).toThrow(EngineError);
  });

  it('rejects vote for unknown candidate', () => {
    let s = { ...base(), jury: ['p2'], players: { ...base().players, p2: { ...base().players.p2, hp: 0 } } };
    expect(() => applyEvent(s, ev(s, 'p2', 'jury_vote', { candidateId: 'ghost' }))).toThrow(EngineError);
  });

  it('records vote and clears on tick', () => {
    let s = { ...base(), jury: ['p2'], players: { ...base().players, p2: { ...base().players.p2, hp: 0 } } };
    s = applyEvent(s, ev(s, 'p2', 'jury_vote', { candidateId: 'p1' }));
    expect(s.pendingVotes).toContainEqual({ voterId: 'p2', candidateId: 'p1' });
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.pendingVotes).toEqual([]);
  });
});
