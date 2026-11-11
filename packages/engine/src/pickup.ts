import { manhattan } from './geom';
import { hashSeed, mulberry32 } from './rng';
import type { GameState, Vec } from './types';

// Where the next board heart spawns. Deterministic per (seed, seq) — the
// chosen square travels inside the heart_spawn event payload, so replays
// never re-derive it; this runs only when the server mints the event.
export function heartSpawnPos(state: GameState): Vec | null {
  const n = state.config.board;
  const rand = mulberry32(hashSeed(`${state.config.seed}:heart:${state.seq}`));

  // candidates: every square that is not occupied by an ALIVE player and not
  // already an unclaimed heart's square. Grave squares are allowed (graves
  // are passable).
  const occupied = new Set<string>();
  for (const p of Object.values(state.players)) {
    if (p.hp > 0) occupied.add(`${p.pos.x},${p.pos.y}`);
  }
  for (const h of state.hearts ?? []) occupied.add(`${h.x},${h.y}`);

  const candidates: Vec[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!occupied.has(`${x},${y}`)) candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return null;

  if ((state.config.heartPlacement ?? 'random') === 'random') {
    return candidates[Math.floor(rand() * candidates.length)];
  }

  // 'smart': score each square by its distance to the NEAREST alive player
  // (and to each existing heart — spreads successive hearts apart); pick
  // uniformly among the maximum-score squares.
  const alive = Object.values(state.players).filter(p => p.hp > 0);
  const hearts = state.hearts ?? [];
  let best: Vec[] = [];
  let bestScore = -1;
  for (const c of candidates) {
    let score = Infinity;
    for (const p of alive) score = Math.min(score, manhattan(c, p.pos));
    for (const h of hearts) score = Math.min(score, manhattan(c, h));
    if (score === Infinity) score = n * 2; // no alive players: farthest wins trivially
    if (score > bestScore) { bestScore = score; best = [c]; }
    else if (score === bestScore) best.push(c);
  }
  return best[Math.floor(rand() * best.length)];
}
