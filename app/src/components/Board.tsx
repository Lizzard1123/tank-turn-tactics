import type { GameState, Vec } from '@ttt/engine';
import { manhattan, occupantAt } from '@ttt/engine';
import { flagUrl } from '../lib/flags';

export type BoardMode = 'none' | 'move' | 'attack' | 'give_ap';

interface BoardProps {
  state: GameState;
  selectedMode: BoardMode;
  me: string | null;
  avatars?: Record<string, string>;
  onCellTap: (pos: Vec) => void;
}

const CELL = 40; // px per cell; container scrolls for large boards

// Life bar: ONE horizontal bar per occupant, along the cell bottom. Width is
// proportional to remaining HP (relative to the game's startingHp).
const LIFE_BAR_H = CELL * 0.14;
const LIFE_BAR_SIDE_PAD = CELL * 0.12;
const LIFE_BAR_BOTTOM_PAD = CELL * 0.08;
const LIFE_BAR_USABLE = CELL - 2 * LIFE_BAR_SIDE_PAD;

function lifeBar(
  occ: { id: string; hp: number },
  x: number,
  y: number,
  startingHp: number,
) {
  if (occ.hp <= 0 || startingHp <= 0) return null;
  const w = LIFE_BAR_USABLE * Math.min(occ.hp, startingHp) / startingHp;
  return (
    <rect
      className="life-bar"
      data-testid={`life-bar-${occ.id}`}
      x={x * CELL + LIFE_BAR_SIDE_PAD}
      y={(y + 1) * CELL - LIFE_BAR_BOTTOM_PAD - LIFE_BAR_H}
      width={w}
      height={LIFE_BAR_H}
    />
  );
}

// SVG grid: cells, range overlay, legal-target highlights, tanks.
// The .board wrapper is a square (aspect-ratio 1) so cells stay square and
// there is no letterboxing / black box.
export default function Board({ state, selectedMode, me, avatars, onCellTap }: BoardProps) {
  const n = state.config.board;
  const own = me ? state.players[me] : null;
  const size = n * CELL;

  const inRange = (p: Vec) =>
    !!own && own.hp > 0 && manhattan(own.pos, p) <= own.range;

  const legal = (p: Vec) => {
    if (!own || own.hp <= 0) return false;
    if (selectedMode === 'move') {
      return manhattan(own.pos, p) === 1 && !occupantAt(state.players, p);
    }
    if (selectedMode === 'attack' || selectedMode === 'give_ap') {
      const occId = occupantAt(state.players, p);
      if (!occId || occId === own.id) return false;
      const occ = state.players[occId];
      // attack needs a living enemy in range; give needs anyone in range
      return inRange(p) && (selectedMode === 'give_ap' || occ.hp > 0);
    }
    return false;
  };

  const cellClass = (p: Vec) => {
    const cls = ['cell'];
    if (inRange(p) && !selectedMode.match(/move/)) cls.push('in-range');
    if (legal(p)) cls.push('legal');
    return cls.join(' ');
  };

  return (
    <div className="board" data-testid="board">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`board ${n}x${n}`}
      >
        <defs>
          {/* diagonal hatch for the range overlay (referenced from CSS) */}
          <pattern
            id="ttt-range-hatch"
            width="6" height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="var(--signal-soft)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--signal)" strokeWidth="1.5" />
          </pattern>
        </defs>
        {Array.from({ length: n * n }, (_, i) => {
          const x = i % n;
          const y = Math.floor(i / n);
          const pos = { x, y };
          return (
            <rect
              key={i}
              x={x * CELL} y={y * CELL} width={CELL} height={CELL}
              className={cellClass(pos)}
              data-testid={`cell-${x}-${y}`}
              onClick={() => onCellTap(pos)}
            />
          );
        })}
        {/* tank layer: one keyed <g> per ALIVE player, translated by position.
            Moves mutate the transform (CSS slides it); dead tanks aren't drawn
            (but still block moves via occupantAt in legal()). */}
        {Object.values(state.players).filter((p) => p.hp > 0).map((p) => (
          <g key={p.id} data-testid={`tank-${p.id}`}
             className={`tank ${p.id === me ? 'own' : 'enemy'}`}
             style={{ transform: `translate(${p.pos.x * CELL}px, ${p.pos.y * CELL}px)` }}
             onClick={() => onCellTap(p.pos)}>
            {/* tank fills the full square: avatar image or generated flag */}
            <image
              x={0} y={0} width={CELL} height={CELL}
              href={avatars?.[p.id] ?? flagUrl(p.id)}
              preserveAspectRatio="xMidYMid slice"
              className="tank-image"
              data-testid={`tank-image-${p.id}`}
            />
            {/* ownership ring (signal = own, olive = enemy) */}
            <rect
              x={0} y={0} width={CELL} height={CELL}
              fill="none"
              stroke={p.id === me ? 'var(--signal)' : 'var(--olive)'}
              strokeWidth="3"
              pointer-events="none"
            />
            {lifeBar(p, 0, 0, state.config.startingHp)}
          </g>
        ))}
      </svg>
    </div>
  );
}
