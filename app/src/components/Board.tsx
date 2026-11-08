import type { GameState, Vec } from '@ttt/engine';
import { manhattan, occupantAt } from '@ttt/engine';
import { flagSvg } from '../lib/flags';

export type BoardMode = 'none' | 'move' | 'attack' | 'give_ap';

interface BoardProps {
  state: GameState;
  selectedMode: BoardMode;
  me: string | null;
  avatars?: Record<string, string>;
  onCellTap: (pos: Vec) => void;
}

const CELL = 40; // px per cell; container scrolls for large boards

// Life-bar geometry (one vertical bar per HP, drawn at the bottom of the cell).
const LIFE_BAR_W = CELL * 0.12;
const LIFE_BAR_GAP = CELL * 0.05;
const LIFE_BAR_H = CELL * 0.22;
const LIFE_BAR_BOTTOM_PAD = CELL * 0.08;
const MAX_LIFE_BARS = 3;

function lifeBars(occ: { id: string; hp: number }, x: number, y: number) {
  const n = Math.min(occ.hp, MAX_LIFE_BARS);
  if (n <= 0) return null;
  const totalW = n * LIFE_BAR_W + (n - 1) * LIFE_BAR_GAP;
  const startX = x * CELL + (CELL - totalW) / 2;
  const barY = (y + 1) * CELL - LIFE_BAR_BOTTOM_PAD - LIFE_BAR_H;
  return Array.from({ length: n }, (_, h) => (
    <rect
      key={h}
      className="life-bar"
      data-testid={`life-bar-${occ.id}-${h}`}
      x={startX + h * (LIFE_BAR_W + LIFE_BAR_GAP)}
      y={barY}
      width={LIFE_BAR_W}
      height={LIFE_BAR_H}
    />
  ));
}

// SVG grid: cells, range overlay, legal-target highlights, tanks.
// The .board wrapper is a square (aspect-ratio 1) so cells stay square and
// there is no letterboxing / black box.
export default function Board({ state, selectedMode, me, avatars, onCellTap }: BoardProps) {
  const n = state.config.board;
  const own = me ? state.players[me] : null;
  const size = n * CELL;

  const flagUri = (playerId: string) =>
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(flagSvg(playerId))}`;

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
                  {/* tank fills the full square: avatar image or generated flag */}
                  <image
                    x={x * CELL} y={y * CELL} width={CELL} height={CELL}
                    href={avatars?.[occ.id] ?? flagUri(occ.id)}
                    preserveAspectRatio="xMidYMid slice"
                    className="tank-image"
                    data-testid={`tank-image-${occ.id}`}
                  />
                  {/* ownership ring (signal = own, olive = enemy) */}
                  <rect
                    x={x * CELL} y={y * CELL} width={CELL} height={CELL}
                    fill="none"
                    stroke={occ.id === me ? 'var(--signal)' : 'var(--olive)'}
                    strokeWidth="3"
                    pointer-events="none"
                  />
                  {lifeBars(occ, x, y)}
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
