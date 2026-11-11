import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/state';
import { applyEvent } from '../src/reducer';
import { occupantAt } from '../src/geom';
import type { GameConfig, GameEvent, GameState } from '../src/types';

const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({
  seed: 1, board: 8, startingHp: 3, startingAp: 0, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0, ...over,
});
const specs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`, name: `P${i + 1}`, isBot: false, botDifficulty: null,
  }));

const joinEvent = (state: GameState, id: string, name: string): GameEvent => ({
  seq: state.seq + 1,
  type: 'join',
  actorId: id,
  createdAt: new Date().toISOString(),
  payload: { playerId: id, name },
});

describe('join event (mid-game late join)', () => {
  it('spawns the player on the first free cell with starting stats', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const s1 = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    const p = s1.players['p9'];
    expect(p).toBeDefined();
    expect(p.hp).toBe(3);
    expect(p.ap).toBe(0);
    expect(p.range).toBe(2);
    expect(p.isBot).toBe(false);
    expect(occupantAt(s1.players, p.pos)).toBe('p9');
    // spawn cell must be inside the board and previously free
    expect(p.pos.x).toBeLessThan(8);
    expect(p.pos.y).toBeLessThan(8);
    expect(occupantAt(s0.players, p.pos)).toBeNull();
  });

  it('appends to order and logs a join entry', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const s1 = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(s1.order).toContain('p9');
    expect(s1.order.length).toBe(3);
    const last = s1.log[s1.log.length - 1];
    expect(last.text).toContain('Newbie');
    expect(last.text).toContain('joined');
    expect(s1.seq).toBe(s0.seq + 1);
  });

  it('spawns deterministically (same replay -> same cell)', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const a = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    const b = applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(a.players['p9'].pos).toEqual(b.players['p9'].pos);
  });

  it('throws when the board is full', () => {
    const s0 = createInitialState(cfg({ board: 1 }), specs(1));
    expect(() => applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'))).toThrow(/full/i);
  });

  it('is idempotent: re-joining an existing player is a no-op', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const seqBefore = s0.seq;
    const s1 = applyEvent(s0, joinEvent(s0, 'p1', 'Impostor'));
    // player unchanged, seq only advanced by 1 (the log entry)
    expect(s1.players['p1']?.name).toBe('P1');
    expect(s1.seq).toBe(seqBefore + 1);
  });

  it('does not mutate the previous state', () => {
    const s0 = createInitialState(cfg(), specs(2));
    const before = JSON.stringify(s0);
    applyEvent(s0, joinEvent(s0, 'p9', 'Newbie'));
    expect(JSON.stringify(s0)).toBe(before);
  });
});
