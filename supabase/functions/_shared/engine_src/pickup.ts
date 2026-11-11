import { manhattan } from './geom.ts';
import { hashSeed, mulberry32 } from './rng.ts';
import type { GameState, Vec } from './types.ts';

// Where the next board heart spawns. Deterministic per (seed, seq) — the
// chosen square travels inside the heart_spawn event payload, so replays
// never re-derive it; this runs only when the server mints the event.
export function heartSpawnPos(state: GameState): Vec | null {
  const n = state.config.board;
  const rand = mulberry32(hashSeed(`${state.config.seed}:heart:${state.seq}`));

  // candidates: every square that is not occupied by an ALIVE player and not
  // the current unclaimed heart's square. Grave squares are allowed (graves
  // are passable).
  const occupied = new Set<string>();
  for (const p of Object.values(state.players)) {
    if (p.hp > 0) occupied.add(`${p.pos.x},${p.pos.y}`);
  }
  if (state.heart) occupied.add(`${state.heart.x},${state.heart.y}`);

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
  // (and to the current heart, if any — spreads successive hearts apart);
  // pick uniformly among the maximum-score squares.
  const alive = Object.values(state.players).filter(p => p.hp > 0);
  let best: Vec[] = [];
  let bestScore = -1;
  for (const c of candidates) {
    let score = Infinity;
    for (const p of alive) score = Math.min(score, manhattan(c, p.pos));
    if (state.heart) score = Math.min(score, manhattan(c, state.heart));
    if (score === Infinity) score = n * 2; // no alive players: farthest wins trivially
    if (score > bestScore) { bestScore = score; best = [c]; }
    else if (score === bestScore) best.push(c);
  }
  return best[Math.floor(rand() * best.length)];
}
