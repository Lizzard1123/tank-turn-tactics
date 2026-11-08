import type { GameState, Vec } from '@ttt/engine';
import { manhattan, occupantAt } from '@ttt/engine';

export type BoardMode = 'none' | 'move' | 'attack' | 'give_ap';

interface BoardProps {
  state: GameState;
  selectedMode: BoardMode;
  me: string | null;
  avatars?: Record<string, string>;
  onCellTap: (pos: Vec) => void;
}

const CELL = 40; // px per cell; container scrolls for large boards

// SVG grid: cells, range overlay, legal-target highlights, tanks.
// The .board wrapper scrolls horizontally for boards wider than the viewport.
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
        width={size}
        height={size}
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
          const cx = x * CELL + CELL / 2;
          const cy = y * CELL + CELL / 2;
          const occId = occupantAt(state.players, pos);
          const occ = occId ? state.players[occId] : null;
          return (
            <g key={i}>
              <rect
                x={x * CELL} y={y * CELL} width={CELL} height={CELL}
                className={cellClass(pos)}
                data-testid={`cell-${x}-${y}`}
                onClick={() => onCellTap(pos)}
              />
              {occ && (
                <g
                  data-testid={`tank-${occ.id}`}
                  className={occ.id === me ? 'own' : 'enemy'}
                  onClick={() => onCellTap(pos)}
                >
                  <circle cx={cx} cy={cy} r={CELL * 0.3} className="tank-body" />
                  {avatars?.[occ.id] ? (
                    <>
                      <clipPath id={`tank-clip-${occ.id}`}>
                        <circle cx={cx} cy={cy} r={CELL * 0.3} />
                      </clipPath>
                      <image
                        href={avatars[occ.id]}
                        x={cx - CELL * 0.3} y={cy - CELL * 0.3}
                        width={CELL * 0.6} height={CELL * 0.6}
                        clipPath={`url(#tank-clip-${occ.id})`}
                        preserveAspectRatio="xMidYMid slice"
                        data-testid={`tank-avatar-${occ.id}`}
                      />
                    </>
                  ) : (
                    <text x={cx} y={cy + 5} textAnchor="middle" className="tank-letter">
                      {occ.name.slice(0, 1).toUpperCase()}
                    </text>
                  )}
                  {/* HP pips */}
                  {Array.from({ length: occ.hp }, (_, h) => (
                    <circle key={h} cx={cx - CELL * 0.25 + h * 8} cy={cy - CELL * 0.3} r={2.5} className="hp-pip" />
                  ))}
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
