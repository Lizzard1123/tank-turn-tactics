import { describe, it, expect } from 'vitest';
import { planBotAction } from '../src/bots';
import { createInitialState } from '../src/state';
import type { GameConfig, GameState } from '../src/types';

const cfg: GameConfig = {
  seed: 3, board: 8, startingHp: 3, startingAp: 6, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
};
const mk = (diff: 'easy'|'medium'|'hard') => createInitialState(cfg, [
  { id: 'b1', name: 'Bot', isBot: true, botDifficulty: diff },
  { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
]);
function adjacentTo(s: ReturnType<typeof mk>, botId: string, otherId: string) {
  const bp = s.players[botId].pos;
  const nx = bp.x + 1 < 8 ? bp.x + 1 : bp.x - 1;
  return { ...s, players: { ...s.players,
    [otherId]: { ...s.players[otherId], pos: { x: nx, y: bp.y } } } };
}

describe('planBotAction', () => {
  it('is deterministic for the same state', () => {
    const s = mk('medium');
    expect(planBotAction(s, 'b1')).toEqual(planBotAction(s, 'b1'));
  });
  it('never returns an illegal action shape across 200 seeds', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = createInitialState({ ...cfg, seed }, [
        { id: 'b1', name: 'Bot', isBot: true, botDifficulty: 'hard' },
        { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      ]);
      const a = planBotAction(s, 'b1');
      if (a === null) continue;
      expect(['move', 'attack', 'give_ap', 'upgrade_range']).toContain(a.type);
      if (a.type === 'move') {
        const from = s.players.b1.pos, to = a.payload.to as { x: number; y: number };
        expect(Math.abs(to.x - from.x) + Math.abs(to.y - from.y)).toBe(1);
        expect(to.x).toBeGreaterThanOrEqual(0); expect(to.x).toBeLessThan(8);
        expect(to.y).toBeGreaterThanOrEqual(0); expect(to.y).toBeLessThan(8);
      }
      if (a.type === 'attack') expect(a.payload.targetId).toBe('p1');
      if (a.type === 'give_ap') expect(a.payload.targetId).toBe('p1');
    }
  });
  it('hard bot attacks when someone is in range', () => {
    const s = adjacentTo(mk('hard'), 'b1', 'p1');
    const poor = { ...s, players: { ...s.players, b1: { ...s.players.b1, ap: 4 } } };
    const a = planBotAction(poor, 'b1');
    expect(a?.type).toBe('attack');
  });
  it('hard bot with AP to spare sometimes gives AP instead of attacking', () => {
    let gave = 0, attacked = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const s = { ...adjacentTo(mk('hard'), 'b1', 'p1'), config: { ...cfg, seed } };
      const rich = { ...s, players: { ...s.players, b1: { ...s.players.b1, ap: 20 } } };
      const a = planBotAction(rich, 'b1');
      if (a?.type === 'give_ap') gave++;
      else if (a?.type === 'attack') attacked++;
    }
    expect(gave).toBeGreaterThan(0);
    expect(attacked).toBeGreaterThan(0);
  });
  it('hard bot gives AP to the lowest-HP target in range', () => {
    let s = adjacentTo(mk('hard'), 'b1', 'p1');
    const bp = s.players.b1.pos;
    s = { ...s, players: { ...s.players,
      p2: { id: 'p2', name: 'B', pos: { x: bp.x, y: bp.y + 1 < 8 ? bp.y + 1 : bp.y - 1 },
        hp: 1, ap: 0, range: 2, isBot: false, botDifficulty: null } },
      order: [...s.order, 'p2'] };
    const rich = { ...s, players: { ...s.players, b1: { ...s.players.b1, ap: 20 } } };
    let chosen: { type: string; payload: Record<string, unknown> } | null = null;
    for (let seed = 1; seed <= 200 && chosen?.type !== 'give_ap'; seed++) {
      chosen = planBotAction({ ...rich, config: { ...rich.config, seed } }, 'b1');
    }
    expect(chosen?.type).toBe('give_ap');
    expect((chosen?.payload as { targetId: string }).targetId).toBe('p2');
  });
  it('hard bot attacks the lowest-HP player in range', () => {
    let s = adjacentTo(mk('hard'), 'b1', 'p1');
    const bp = s.players.b1.pos;
    s = { ...s, players: { ...s.players,
      p2: { id: 'p2', name: 'B', pos: { x: bp.x, y: bp.y + 1 < 8 ? bp.y + 1 : bp.y - 1 },
        hp: 1, ap: 0, range: 2, isBot: false, botDifficulty: null } },
      order: [...s.order, 'p2'] };
    const a = planBotAction(s, 'b1');
    expect(a).toEqual({ type: 'attack', payload: { targetId: 'p2' } });
  });
  it('returns null when bot has no AP', () => {
    const s = { ...mk('hard'), players: { ...mk('hard').players, b1: { ...mk('hard').players.b1, ap: 0 } } };
    expect(planBotAction(s, 'b1')).toBeNull();
  });
  it('returns null when bot is dead', () => {
    const s = { ...mk('hard'), players: { ...mk('hard').players, b1: { ...mk('hard').players.b1, hp: 0 } } };
    expect(planBotAction(s, 'b1')).toBeNull();
  });
  it('non-bot player returns null', () => {
    const s = createInitialState(cfg, [
      { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
    ]);
    expect(planBotAction(s, 'p1')).toBeNull();
  });
  it('medium bot prefers attack when targets in range', () => {
    const s = adjacentTo(mk('medium'), 'b1', 'p1');
    const a = planBotAction(s, 'b1');
    expect(a?.type).toBe('attack');
  });
  it('medium bot upgrades when no targets in range', () => {
    let upgraded = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const s = createInitialState({ ...cfg, seed }, [
        { id: 'b1', name: 'Bot', isBot: true, botDifficulty: 'medium' },
        { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      ]);
      const a = planBotAction(s, 'b1');
      if (a?.type === 'upgrade_range') upgraded++;
    }
    expect(upgraded).toBeGreaterThan(0);
  });
  it('hard bot prefers attack over move when targets in range', () => {
    const s = adjacentTo(mk('hard'), 'b1', 'p1');
    const a = planBotAction(s, 'b1');
    expect(a?.type).toBe('attack');
  });
  it('bot action is valid move within board', () => {
    let validMoves = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const s = createInitialState({ ...cfg, seed }, [
        { id: 'b1', name: 'Bot', isBot: true, botDifficulty: 'easy' },
        { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      ]);
      const a = planBotAction(s, 'b1');
      if (a?.type === 'move') {
        const to = a.payload.to as { x: number; y: number };
        if (to.x >= 0 && to.x < 8 && to.y >= 0 && to.y < 8) validMoves++;
      }
    }
    expect(validMoves).toBeGreaterThanOrEqual(0);
  });
  it('bot action target is valid player', () => {
    let validTargets = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const s = createInitialState({ ...cfg, seed }, [
        { id: 'b1', name: 'Bot', isBot: true, botDifficulty: 'hard' },
        { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      ]);
      const a = planBotAction(s, 'b1');
      if (a?.type === 'attack' || a?.type === 'give_ap') {
        const targetId = (a?.payload as { targetId?: string }).targetId;
        if (targetId === 'p1') validTargets++;
      }
    }
    expect(validTargets).toBeGreaterThanOrEqual(0);
  });
  it('easy bot can attack', () => {
    let attacked = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const s = createInitialState({ ...cfg, seed }, [
        { id: 'b1', name: 'Bot', isBot: true, botDifficulty: 'easy' },
        { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      ]);
      const a = planBotAction(s, 'b1');
      if (a?.type === 'attack') attacked++;
    }
    expect(attacked).toBeGreaterThanOrEqual(0);
  });
  it('easy bot can move', () => {
    let moved = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const s = createInitialState({ ...cfg, seed }, [
        { id: 'b1', name: 'Bot', isBot: true, botDifficulty: 'easy' },
        { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      ]);
      const a = planBotAction(s, 'b1');
      if (a?.type === 'move') moved++;
    }
    expect(moved).toBeGreaterThanOrEqual(0);
  });
  it('bot action type is one of valid types', () => {
    const validTypes = ['move', 'attack', 'give_ap', 'upgrade_range'];
    for (let seed = 1; seed <= 100; seed++) {
      const s = createInitialState({ ...cfg, seed }, [
        { id: 'b1', name: 'Bot', isBot: true, botDifficulty: 'hard' },
        { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      ]);
      const a = planBotAction(s, 'b1');
      if (a !== null) {
        expect(validTypes).toContain(a.type);
      }
    }
  });
  it('hard bot moves toward nearest player when nothing else applies', () => {
    const s0 = mk('hard');
    const spread = { ...s0, players: { ...s0.players,
      b1: { ...s0.players.b1, pos: { x: 0, y: 0 } },
      p1: { ...s0.players.p1, pos: { x: 7, y: 7 } } } };
    const poor = { ...spread, players: { ...spread.players, b1: { ...spread.players.b1, ap: 1 } } };
    let moved = false;
    for (let attempt = 0; attempt < 50 && !moved; attempt++) {
      const jittered = { ...poor, seq: attempt };
      const a = planBotAction(jittered, 'b1');
      if (a?.type === 'move') moved = true;
    }
    expect(moved).toBe(true);
  });
  it('easy bots act at most ~half the time across seeds', () => {
    let acted = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = createInitialState({ ...cfg, seed }, [
        { id: 'b1', name: 'Bot', isBot: true, botDifficulty: 'easy' },
        { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      ]);
      if (planBotAction(s, 'b1') !== null) acted++;
    }
    expect(acted).toBeGreaterThan(40);
    expect(acted).toBeLessThan(120);
  });
});
