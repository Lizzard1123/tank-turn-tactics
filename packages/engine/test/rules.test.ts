import { describe, it, expect } from 'vitest';
import { applyEvent } from '../src/reducer';
import { EngineError } from '../src/errors';
import { createInitialState } from '../src/state';
import { heartSpawnPos } from '../src/pickup';
import type { GameConfig, GameEvent, GameState } from '../src/types';

const cfg: GameConfig = {
  seed: 42, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
};
const base = createInitialState(cfg, [
  { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
  { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
  { id: 'p3', name: 'C', isBot: false, botDifficulty: null },
]);

function ev(state: GameState, actorId: string, type: GameEvent['type'], payload: Record<string, unknown> = {}): GameEvent {
  return { seq: state.seq + 1, type, actorId, createdAt: new Date().toISOString(), payload };
}
// teleport helpers (tests only — bypasses move validation)
function placeAdjacent(s: GameState, a: string, b: string): GameState {
  const bp = s.players[b].pos;
  const nx = bp.x + 1 <= 7 ? bp.x + 1 : bp.x - 1;
  return { ...s, players: { ...s.players, [a]: { ...s.players[a], pos: { x: nx, y: bp.y } } } };
}

describe('apStealOnKill', () => {
  const stealCfg: GameConfig = { ...cfg, apStealOnKill: true };
  const sb = createInitialState(stealCfg, [
    { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
    { id: 'p3', name: 'C', isBot: false, botDifficulty: null },
  ]);
  it('transfers victim AP to the killer on the final blow', () => {
    let s = placeAdjacent(sb, 'p1', 'p2');
    s = { ...s, players: { ...s.players,
      p2: { ...s.players.p2, hp: 1, ap: 5 } } };
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.players.p2.hp).toBe(0);
    expect(s.players.p1.ap).toBe(8); // 4 - 1 cost + 5 stolen
    expect(s.players.p2.ap).toBe(0);
  });
  it('does nothing when the option is off (default)', () => {
    let s = placeAdjacent(base, 'p1', 'p2');
    s = { ...s, players: { ...s.players,
      p1: { ...s.players.p1, ap: 7 }, p2: { ...s.players.p2, hp: 1, ap: 5 } } };
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.players.p1.ap).toBe(6); // just the action cost, no loot
    expect(s.players.p2.ap).toBe(5); // victim keeps their AP
  });
  it('steals on non-final blows is not a thing (only kills)', () => {
    let s = placeAdjacent(base, 'p1', 'p2');
    s = { ...s, players: { ...s.players,
      p1: { ...s.players.p1, ap: 7 }, p2: { ...s.players.p2, hp: 3, ap: 5 } } };
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.players.p2.hp).toBe(2);
    expect(s.players.p1.ap).toBe(6);
  });
  it('kill marks the log entry kind for the battle feed', () => {
    let s = placeAdjacent(base, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, hp: 1 } } };
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.log[s.log.length - 1].kind).toBe('kill');
  });
  it('kill with apSteal via bot_action wrapper also steals and marks kind', () => {
    const bots = createInitialState({ ...stealCfg, startingAp: 6 }, [
      { id: 'b1', name: 'Bot', isBot: true, botDifficulty: 'easy' },
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    let s = placeAdjacent(bots, 'b1', 'p1');
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, hp: 1, ap: 3 } } };
    s = applyEvent(s, ev(s, 'b1', 'bot_action', { inner: { type: 'attack', payload: { targetId: 'p1' } } }));
    expect(s.players.p1.hp).toBe(0);
    expect(s.players.b1.ap).toBe(8); // 6 - 1 + 3 stolen
    expect(s.log[s.log.length - 1].kind).toBe('kill');
  });
});

describe('give_heart', () => {
  it('gives 1 hp to an alive in-range target, costing the giver 1 hp', () => {
    const s0 = { ...base, config: { ...cfg, heartGifts: true } };
    let s = placeAdjacent(s0, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, hp: 3 }, p2: { ...s.players.p2, hp: 2 } } };
    s = applyEvent(s, ev(s, 'p1', 'give_heart', { targetId: 'p2' }));
    expect(s.players.p1.hp).toBe(2);
    expect(s.players.p2.hp).toBe(3);
    expect(s.players.p1.ap).toBe(s0.players.p1.ap); // no AP cost
  });
  it('rejects when heartGifts is off', () => {
    let s = placeAdjacent(base, 'p1', 'p2');
    expect(() => applyEvent(s, ev(s, 'p1', 'give_heart', { targetId: 'p2' }))).toThrow(EngineError);
  });
  it('rejects gifting the giver\'s last heart', () => {
    const s0 = { ...base, config: { ...cfg, heartGifts: true } };
    let s = placeAdjacent(s0, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, hp: 1 } } };
    expect(() => applyEvent(s, ev(s, 'p1', 'give_heart', { targetId: 'p2' }))).toThrow(/2 hp/);
  });
  it('rejects a target already at max hp', () => {
    const s0 = { ...base, config: { ...cfg, heartGifts: true } };
    let s = placeAdjacent(s0, 'p1', 'p2');
    expect(() => applyEvent(s, ev(s, 'p1', 'give_heart', { targetId: 'p2' }))).toThrow(/max hp/);
  });
  it('rejects out-of-range gifts', () => {
    const s0 = { ...base, config: { ...cfg, heartGifts: true } };
    const s = { ...s0, players: { ...s0.players,
      p1: { ...s0.players.p1, pos: { x: 0, y: 0 } },
      p2: { ...s0.players.p2, pos: { x: 7, y: 7 }, hp: 2 } } };
    expect(() => applyEvent(s, ev(s, 'p1', 'give_heart', { targetId: 'p2' }))).toThrow(/range/);
  });
  it('revives a dead player at 1 hp / 0 AP and removes them from the jury', () => {
    const s0 = { ...base, config: { ...cfg, heartGifts: true, revives: true } };
    let s = placeAdjacent(s0, 'p1', 'p2');
    s = { ...s, jury: ['p2'], players: { ...s.players, p2: { ...s.players.p2, hp: 0, ap: 9 } } };
    s = applyEvent(s, ev(s, 'p1', 'give_heart', { targetId: 'p2' }));
    expect(s.players.p2.hp).toBe(1);
    expect(s.players.p2.ap).toBe(0);
    expect(s.jury).toEqual([]);
    expect(s.log[s.log.length - 1].kind).toBe('revive');
  });
  it('rejects reviving when revives is off', () => {
    const s0 = { ...base, config: { ...cfg, heartGifts: true, revives: false } };
    let s = placeAdjacent(s0, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, hp: 0 } } };
    expect(() => applyEvent(s, ev(s, 'p1', 'give_heart', { targetId: 'p2' }))).toThrow(/revives/);
  });
  it('a revived player can no longer vote', () => {
    const s0 = { ...base, config: { ...cfg, heartGifts: true, revives: true } };
    let s = placeAdjacent(s0, 'p1', 'p2');
    s = { ...s, jury: ['p2'], players: { ...s.players, p2: { ...s.players.p2, hp: 0 } } };
    s = applyEvent(s, ev(s, 'p1', 'give_heart', { targetId: 'p2' }));
    expect(() => applyEvent(s, ev(s, 'p2', 'jury_vote', { candidateId: 'p1' }))).toThrow(/alive players cannot vote/);
  });
});

describe('juryHaunt', () => {
  const hauntCfg: GameConfig = { ...cfg, juryHaunt: true, startingAp: 0 };
  const hb = createInitialState(hauntCfg, base ? [
    { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
    { id: 'p3', name: 'C', isBot: false, botDifficulty: null },
  ] : []);

  function voted(s: GameState, votes: Array<[string, string]>): GameState {
    let out = s;
    for (const [voter, candidate] of votes) out = applyEvent(out, ev(out, voter, 'jury_vote', { candidateId: candidate }));
    return out;
  }

  it('the strictly-most-voted player gets no AP drip', () => {
    let s = { ...hb, jury: ['p3'], players: { ...hb.players, p3: { ...hb.players.p3, hp: 0 } } };
    s = voted(s, [['p3', 'p1']]);
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p1.ap).toBe(0); // haunted
    expect(s.players.p2.ap).toBe(1);
    expect(s.haunted).toBe('p1');
  });
  it('a tie haunts nobody', () => {
    let s = { ...hb, jury: ['p2', 'p3'], players: { ...hb.players,
      p2: { ...hb.players.p2, hp: 0 }, p3: { ...hb.players.p3, hp: 0 } } };
    s = voted(s, [['p2', 'p1'], ['p3', 'p2']]); // 1-1 tie
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p1.ap).toBe(1);
    expect(s.haunted).toBeNull(); // 1-1 tie: nobody haunted, everyone drips
  });
  it('the >= 3-vote jury bonus still applies to a haunted player', () => {
    const dead = (id: string) => ({ ...hb.players[id], hp: 0 });
    let s = { ...hb, jury: ['p3', 'p4'],
      players: { ...hb.players, p3: dead('p3'), p4: dead('p4') },
      order: [...hb.order, 'p4'] };
    void dead;
    // three voters all vote p1: p3, p4 — need a third; add p5-style via hb (only 3 players here) so reuse two voters x none.
    // simpler: 2 voters is max here, so craft pendingVotes directly via 3-voter state
    const three = createInitialState(hauntCfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
      { id: 'p3', name: 'C', isBot: false, botDifficulty: null },
      { id: 'p4', name: 'D', isBot: false, botDifficulty: null },
      { id: 'p5', name: 'E', isBot: false, botDifficulty: null },
    ]);
    let t = { ...three, jury: ['p3', 'p4', 'p5'],
      players: { ...three.players,
        p3: { ...three.players.p3, hp: 0 }, p4: { ...three.players.p4, hp: 0 }, p5: { ...three.players.p5, hp: 0 } } };
    t = voted(t, [['p3', 'p1'], ['p4', 'p1'], ['p5', 'p1']]);
    t = applyEvent(t, ev(t, 'system', 'daily_tick', { apGained: 1 }));
    // haunted (no drip) but still +1 from the jury bonus
    expect(t.players.p1.ap).toBe(1);
    expect(t.players.p2.ap).toBe(1); // drip only
    expect(t.haunted).toBe('p1');
  });
  it('does nothing when the option is off', () => {
    const off = createInitialState({ ...cfg, juryHaunt: false, startingAp: 0 }, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
      { id: 'p3', name: 'C', isBot: false, botDifficulty: null },
    ]);
    let s = { ...off, players: { ...off.players, p3: { ...off.players.p3, hp: 0 } } };
    s = applyEvent(s, ev(s, 'p3', 'jury_vote', { candidateId: 'p1' }));
    s = applyEvent(s, ev(s, 'system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p1.ap).toBe(1);
  });
});

describe('heart spawn + claim', () => {
  it('heart_spawn places a heart on a free square', () => {
    let s = applyEvent(base, ev(base, 'system', 'heart_spawn', { x: 3, y: 4 }));
    expect(s.heart).toEqual({ x: 3, y: 4, seq: 1 });
    expect(s.log[s.log.length - 1].kind).toBe('heart_spawn');
  });
  it('rejects heart_spawn on an alive-occupied square', () => {
    const at = base.players.p2.pos;
    expect(() => applyEvent(base, ev(base, 'system', 'heart_spawn', at))).toThrow(/occupied/);
  });
  it('allows heart_spawn on a dead player\'s (grave) square', () => {
    const s0 = { ...base, players: { ...base.players, p3: { ...base.players.p3, hp: 0 } } };
    const at = s0.players.p3.pos;
    const s = applyEvent(s0, ev(s0, 'system', 'heart_spawn', at));
    expect(s.heart).toEqual({ x: at.x, y: at.y, seq: 1 });
  });
  it('rejects heart_spawn outside the board', () => {
    expect(() => applyEvent(base, ev(base, 'system', 'heart_spawn', { x: 8, y: 0 }))).toThrow(/board/);
  });
  it('a new spawn replaces an unclaimed heart', () => {
    let s = applyEvent(base, ev(base, 'system', 'heart_spawn', { x: 3, y: 4 }));
    s = applyEvent(s, ev(s, 'system', 'heart_spawn', { x: 5, y: 5 }));
    expect(s.heart).toEqual({ x: 5, y: 5, seq: 2 });
  });
  it('moving onto the heart claims it (+1 hp, capped)', () => {
    let s = applyEvent(base, ev(base, 'system', 'heart_spawn', { x: 2, y: 1 }));
    const p1 = s.players.p1;
    s = { ...s, players: { ...s.players, p1: { ...p1, pos: { x: 2, y: 2 }, hp: 2 } } }; // teleport next to heart
    s = applyEvent(s, ev(s, 'p1', 'move', { to: { x: 2, y: 1 } }));
    expect(s.players.p1.hp).toBe(3);
    expect(s.heart).toBeNull();
    expect(s.log[s.log.length - 1].text).toContain('found a heart');
  });
  it('claiming at full hp consumes the heart with no gain', () => {
    let s = applyEvent(base, ev(base, 'system', 'heart_spawn', { x: 2, y: 1 }));
    const p1 = s.players.p1;
    s = { ...s, players: { ...s.players, p1: { ...p1, pos: { x: 2, y: 2 } } } }; // hp 3 = full
    s = applyEvent(s, ev(s, 'p1', 'move', { to: { x: 2, y: 1 } }));
    expect(s.players.p1.hp).toBe(3);
    expect(s.heart).toBeNull();
  });
});

describe('graves are passable', () => {
  it('a dead player\'s square can be moved onto', () => {
    let s = { ...base, players: { ...base.players,
      p3: { ...base.players.p3, hp: 0 },
      p1: { ...base.players.p1, pos: { x: (base.players.p3.pos.x + 1) % 8, y: base.players.p3.pos.y } } } };
    // p3 dead at pos P; p1 adjacent; move onto p3's square
    const grave = base.players.p3.pos;
    s = applyEvent(s, ev(s, 'p1', 'move', { to: grave }));
    expect(s.players.p1.pos).toEqual(grave);
  });
  it('an alive player\'s square still blocks', () => {
    const at = base.players.p2.pos;
    const adj = { x: at.x + 1 <= 7 ? at.x + 1 : at.x - 1, y: at.y };
    let s = { ...base, players: { ...base.players, p1: { ...base.players.p1, pos: adj } } };
    expect(() => applyEvent(s, ev(s, 'p1', 'move', { to: at }))).toThrow(/occupied/);
  });
});

describe('heartSpawnPos', () => {
  it('is deterministic for the same state', () => {
    const a = heartSpawnPos(base);
    const b = heartSpawnPos(base);
    expect(a).toEqual(b);
  });
  it('returns a square with no alive player on it', () => {
    for (let i = 0; i < 30; i++) {
      const s = { ...base, seq: i };
      const pos = heartSpawnPos(s);
      expect(pos).not.toBeNull();
      const taken = Object.values(s.players).some(p => p.hp > 0 && p.pos.x === pos!.x && p.pos.y === pos!.y);
      expect(taken).toBe(false);
    }
  });
  it('smart mode picks the farthest square from all alive players', () => {
    const s: GameState = {
      ...base, heart: null,
      config: { ...cfg, heartPlacement: 'smart' },
      players: {
        p1: { ...base.players.p1, pos: { x: 0, y: 0 }, hp: 3 },
        p2: { ...base.players.p2, pos: { x: 1, y: 0 }, hp: 3 },
        p3: { ...base.players.p3, pos: { x: 0, y: 1 }, hp: 3 },
      },
    };
    const pos = heartSpawnPos(s)!;
    // the unique max-min-distance square for players clustered at origin-ish
    // is (7,7): manhattan distances 14, 13, 13 — min is 13, the global max
    expect(pos).toEqual({ x: 7, y: 7 });
  });
  it('smart mode also avoids the current heart', () => {
    const s: GameState = {
      ...base, heart: { x: 7, y: 7, seq: 1 },
      config: { ...cfg, heartPlacement: 'smart' },
      players: {
        p1: { ...base.players.p1, pos: { x: 0, y: 0 }, hp: 3 },
        p2: { ...base.players.p2, pos: { x: 1, y: 0 }, hp: 3 },
        p3: { ...base.players.p3, pos: { x: 0, y: 1 }, hp: 3 },
      },
    };
    const pos = heartSpawnPos(s)!;
    // with (7,7) taken by the existing heart, the next-best corner (7,0)/(0,7)
    // area wins; the important assertion is: not the occupied corner
    expect(pos).not.toEqual({ x: 7, y: 7 });
  });
  it('random mode avoids the current heart square', () => {
    for (let i = 0; i < 30; i++) {
      const s = { ...base, seq: i, heart: { x: 0, y: 0, seq: 1 } };
      const pos = heartSpawnPos(s)!;
      expect(!(pos.x === 0 && pos.y === 0)).toBe(true);
    }
  });
  it('returns null when every square is blocked', () => {
    const players: GameState['players'] = {};
    const s: GameState = { ...base, players };
    // board full of alive players is impossible via createInitialState limits,
    // so synthesize: 8x8 = 64 alive players
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const id = `x${x}y${y}`;
        players[id] = { id, name: id, pos: { x, y }, hp: 1, ap: 0, range: 1, isBot: false, botDifficulty: null };
      }
    }
    expect(heartSpawnPos(s)).toBeNull();
  });
});
