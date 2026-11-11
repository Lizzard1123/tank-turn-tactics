import type { PlayerId, Vec } from './types';
export const manhattan = (a: Vec, b: Vec) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const inRange = (a: Vec, b: Vec, range: number) => manhattan(a, b) <= range;
// Only ALIVE players block movement — dead players are gravestones on their
// square, passable (and targetable) by everyone. Callers that need to find
// any player regardless of hp (e.g. cell-tap targeting) scan s.players
// directly instead.
export function occupantAt(
  players: Record<PlayerId, { pos: Vec; hp?: number }>,
  pos: Vec,
): PlayerId | null {
  for (const [id, p] of Object.entries(players)) {
    if (p.pos.x === pos.x && p.pos.y === pos.y && (p.hp ?? 1) > 0) return id;
  }
  return null;
}
