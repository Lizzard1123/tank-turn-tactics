import type { PlayerId, Vec } from './types.ts';
export const manhattan = (a: Vec, b: Vec) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const inRange = (a: Vec, b: Vec, range: number) => manhattan(a, b) <= range;
export function occupantAt(players: Record<PlayerId, { pos: Vec }>, pos: Vec): PlayerId | null {
  for (const [id, p] of Object.entries(players)) if (p.pos.x === pos.x && p.pos.y === pos.y) return id;
  return null;
}
