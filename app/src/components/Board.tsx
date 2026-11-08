import { useEffect, useState } from 'react';
import type { GameEvent, GameState, Vec } from '@ttt/engine';
import { manhattan, occupantAt } from '@ttt/engine';
import { flagUrl } from '../lib/flags';

export type BoardMode = 'none' | 'move' | 'attack' | 'give_ap';

interface BoardProps {
  state: GameState;
  selectedMode: BoardMode;
  me: string | null;
  avatars?: Record<string, string>;
  onCellTap: (pos: Vec) => void;
  lastEvent?: GameEvent | null;
}

const CELL = 40; // px per cell; container scrolls for large boards

// fx layer testids (data-testids are part of the public DOM contract)
const FX_TESTIDS = { attack: 'fx-attack', give_ap: 'fx-give_ap', upgrade_range: 'fx-pulse' } as const;

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
export default function Board({ state, selectedMode, me, avatars, onCellTap, lastEvent }: BoardProps) {
  const n = state.config.board;
  const own = me ? state.players[me] : null;
  const size = n * CELL;

  // fx lifetime: shown for the newest event, hidden once its animation ends,
  // re-shown when the event changes (keyed remount restarts the animation).
  const [fxLive, setFxLive] = useState(true);
  useEffect(() => setFxLive(true), [lastEvent?.seq]);

  // Derive the fx geometry from the event: the actor cell (and the target cell
  // for attack / give_ap). Looked up in state.players REGARDLESS of hp — an
  // attack on a now-dead tank still draws the bullet (the tank layer skips the
  // dead, the fx layer does not).
  let fx: { kind: 'attack' | 'give_ap' | 'upgrade_range'; from: Vec; to: Vec | null } | null = null;
  if (lastEvent && fxLive) {
    const actor = state.players[lastEvent.actorId];
    if (actor && (lastEvent.type === 'attack' || lastEvent.type === 'give_ap')) {
      const target = state.players[(lastEvent.payload as { targetId?: string }).targetId ?? ''];
      if (target) fx = { kind: lastEvent.type, from: actor.pos, to: target.pos };
    } else if (actor && lastEvent.type === 'upgrade_range') {
      fx = { kind: 'upgrade_range', from: actor.pos, to: null };
    }
  }

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
        {/* fx layer: one keyed <g> for the newest event's effect. Keyed by seq
            so a new event remounts the layer and restarts the animations.
            animationend hides the layer — except the bullet's, which would cut
            the victim flash short (bullet 250ms vs flash 400ms). */}
        {fx && lastEvent && (
          <g
            key={lastEvent.seq}
            data-testid={FX_TESTIDS[fx.kind]}
            onAnimationEnd={(e) => {
              if (!(e.target as Element).classList.contains('fx-bullet')) setFxLive(false);
            }}
          >
            {(fx.kind === 'attack' || fx.kind === 'give_ap') && (
              <>
                <circle
                  r={5}
                  fill={fx.kind === 'attack' ? '#e33' : '#3c3'}
                  className="fx-bullet"
                  style={{
                    ['--fx-dx' as string]: `${(fx.to!.x - fx.from.x) * CELL}px`,
                    ['--fx-dy' as string]: `${(fx.to!.y - fx.from.y) * CELL}px`,
                  }}
                />
                <circle
                  cx={fx.to!.x * CELL + CELL / 2}
                  cy={fx.to!.y * CELL + CELL / 2}
                  r={CELL / 2}
                  className="fx-victim"
                />
              </>
            )}
            {fx.kind === 'upgrade_range' && (
              <circle
                cx={fx.from.x * CELL + CELL / 2}
                cy={fx.from.y * CELL + CELL / 2}
                r={CELL * 1.5}
                className="fx-pulse"
              />
            )}
          </g>
        )}
      </svg>
    </div>
  );
}
