import { mulberry32 } from './rng.ts';
import { occupantAt } from './geom.ts';
import type { GameConfig, GameState, PlayerId, PlayerState } from './types.ts';

export interface PlayerSpec { id: PlayerId; name: string; isBot: boolean; botDifficulty: 'easy'|'medium'|'hard'|null }

export function createInitialState(config: GameConfig, specs: PlayerSpec[]): GameState {
  if (specs.length > config.board * config.board) throw new Error('too many players for board');
  const rand = mulberry32(config.seed);
  const players: Record<PlayerId, PlayerState> = {};
  const order: PlayerId[] = [];
  for (const spec of specs) {
    let pos = { x: 0, y: 0 }, tries = 0, placed = false;
    do {
      pos = { x: Math.floor(rand() * config.board), y: Math.floor(rand() * config.board) };
      if (occupantAt(players, pos) === null) placed = true;
      tries++;
    } while (!placed && tries < 1000);
    if (!placed) throw new Error('could not place player');
    players[spec.id] = {
      id: spec.id, name: spec.name, pos, hp: config.startingHp, ap: config.startingAp,
      range: config.baseRange, isBot: spec.isBot, botDifficulty: spec.botDifficulty,
      // the starting grant counts as given out (Action Points popup)
      apEarned: config.startingAp,
    };
    order.push(spec.id);
  }
  return { seq: 0, day: 1, tickClockMinutes: 0, config, players, order, jury: [], pendingVotes: [], winner: null, log: [], hearts: [], haunted: null };
}

// Normalize legacy snapshots: pre-multi-heart state carried at most one
// unclaimed heart in `heart`. Returns a state with `hearts` populated from
// it (and `heart` cleared) so reducers/pickup only ever see the array.
export function normalizeHeartState(s: GameState): GameState {
  if (s.hearts) return s;
  const legacy = s.heart;
  return { ...s, hearts: legacy ? [{ x: legacy.x, y: legacy.y, seq: legacy.seq }] : [], heart: null };
}

// Backfill the lifetime AP counter for snapshots that predate the field.
// gainAp only materializes apEarned on a player's next GRANT (reconstructing
// the "everything so far counts as granted" baseline from their pre-gain ap),
// so a legacy player shows no total at all until that grant — the Action
// Points popup would fall back to current ap as the total. This applies the
// exact same baseline up front: apEarned ??= ap. Idempotent; never lowers an
// existing counter.
export function ensureApEarned(s: GameState): GameState {
  let changed = false;
  const players: Record<PlayerId, PlayerState> = { ...s.players };
  for (const id of Object.keys(players)) {
    const p = players[id];
    if (p.apEarned == null) {
      players[id] = { ...p, apEarned: p.ap };
      changed = true;
    }
  }
  return changed ? { ...s, players } : s;
}
