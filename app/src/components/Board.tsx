import { useEffect, useState } from 'react';
import type { GameEvent, GameState, Vec } from '@ttt/engine';
import { HIDDEN_ACTOR } from '@ttt/engine';
import { manhattan, occupantAt } from '@ttt/engine';
import { flagUrl } from '../lib/flags';

export type BoardMode = 'none' | 'move' | 'attack' | 'give_ap' | 'give_heart';

interface BoardProps {
  state: GameState;
  selectedMode: BoardMode;
  me: string | null;
  avatars?: Record<string, string>;
  onCellTap: (pos: Vec) => void;
  lastEvent?: GameEvent | null;
}

const CELL = 40; // px per cell; container scrolls for large boards

// --- name plate pixel fit -------------------------------------------------
// Rough per-glyph advance widths (fractions of font-size) for the stamped
// bold plates. Names longer than their plate get squeezed via textLength so
// they can never spill off the stone / square.
const NARROW_GLYPHS = 'iljtfI|!.,\'’()[]- 1';
const WIDE_GLYPHS = 'mwMW@';
export function nameWidthPx(text: string, fontSize: number, letterSpacing = 0): number {
  let w = 0;
  for (const ch of text) {
    w += NARROW_GLYPHS.includes(ch) ? 0.35 : WIDE_GLYPHS.includes(ch) ? 0.98 : 0.68;
  }
  return w * fontSize + letterSpacing * Math.max(0, [...text].length - 1);
}
// tank plates render across a full square; leave 4px of margin per side
const TANK_NAME_MAX = CELL - 8;

// --- crowded-grave layout -------------------------------------------------
// 2+ dead on one square: SEPARATE small tombstones — one per dead player, up
// to four (2 → side by side, 3 → triangle, 4 → 2×2 grid) on a shared dirt
// mound. Each small stone keeps its portrait and its (squeezed) name. Five or
// more dead: still four stones but no names — a square that crowded cannot
// fit readable text — plus a "×N" count tag for the ones beyond the fourth.
const CROWD_MAX = 4;
const CROWD_SLOTS: Record<number, [number, number][]> = {
  2: [[0.27, 0.56], [0.73, 0.56]],
  3: [[0.5, 0.34], [0.27, 0.7], [0.73, 0.7]],
  4: [[0.27, 0.33], [0.73, 0.33], [0.27, 0.71], [0.73, 0.71]],
};
const CROWD_SCALES: Record<number, number> = { 2: 0.48, 3: 0.44, 4: 0.4 };

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
      // attack and give_ap both require a living, in-range target (dead players
      // are graves: passable, but not a valid AP recipient — the server rejects
      // give_ap to a dead player with "player is dead")
      return inRange(p) && occ.hp > 0;
    }
    if (selectedMode === 'give_heart') {
      // occupantAt only sees the living — scan all players so graves are
      // targetable too (a gift to a grave revives when the option is on)
      const target = Object.values(state.players).find(
        (q) => q.pos.x === p.x && q.pos.y === p.y && q.id !== own.id,
      );
      if (!target || !inRange(p)) return false;
      if (target.hp > 0) return target.hp < state.config.startingHp; // heal: room to gain
      return !!state.config.revives; // revive: only when the option is on
    }
    return false;
  };

  const cellClass = (p: Vec) => {
    const cls = ['cell'];
    if (inRange(p) && !selectedMode.match(/move/)) cls.push('in-range');
    if (legal(p)) cls.push('legal');
    return cls.join(' ');
  };

  // graves grouped by square — the mound layer and each stone's fan slot
  // both read from this (crowd order is stable: Object.values order)
  const dead = Object.values(state.players).filter((p) => p.hp <= 0);
  const crowdByPos = new Map<string, typeof dead>();
  for (const p of dead) {
    const key = `${p.pos.x},${p.pos.y}`;
    const list = crowdByPos.get(key);
    if (list) list.push(p);
    else crowdByPos.set(key, [p]);
  }

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
        {/* gravestone layer: one non-blocking marker per DEAD player — a
            tombstone glyph with a framed portrait plus their name, both up on
            the stone's face (never spilling off it: long names are squeezed
            to the stone width). When 2+ players died on the same square the
            stones render as SEPARATE small tombstones (up to four, one per
            dead player) on a shared dirt mound, each keeping its portrait and
            name; five or more dead drops the names and adds a "×N" tag.
            Tanks drive over graves. The layer is click-transparent: taps pass
            through to the cell rects underneath (moving onto a grave, or
            targeting it for a revive). */}
        {[...crowdByPos.values()].filter((l) => l.length > 1).map((l) => (
          <g
            key={`mound-${l[0].pos.x}-${l[0].pos.y}`}
            data-testid={`grave-mound-${l[0].pos.x}-${l[0].pos.y}`}
            style={{ transform: `translate(${l[0].pos.x * CELL}px, ${l[0].pos.y * CELL}px)`, pointerEvents: 'none' }}
          >
            <ellipse cx={CELL / 2} cy={CELL * 0.74} rx={CELL * 0.44} ry={CELL * 0.17} className="grave-mound" />
            {l.length > CROWD_MAX && (
              <text x={CELL / 2} y={CELL * 0.96} textAnchor="middle" className="grave-count">
                ×{l.length}
              </text>
            )}
          </g>
        ))}
        {dead.map((p) => {
          const crowd = crowdByPos.get(`${p.pos.x},${p.pos.y}`) ?? [p];
          const idx = crowd.findIndex((q) => q.id === p.id);
          const many = crowd.length > 1;
          // beyond the fourth grave on one square: the mound's ×N tag stands
          // in — no individual stone for the overflow (it could not fit)
          if (many && idx >= CROWD_MAX) return null;
          const scale = many ? CROWD_SCALES[Math.min(crowd.length, CROWD_MAX)] : 1;
          const slot = many ? CROWD_SLOTS[Math.min(crowd.length, CROWD_MAX)][idx] : [0.5, 0.55];
          // name plate fit: squeeze any name wider than the stone's face (the
          // textLength cap lives in the scaled group's local coordinates, so
          // it shrinks with the stone)
          const nameFit =
            nameWidthPx(p.name, 7) > CELL * 0.6
              ? { textLength: CELL * 0.6, lengthAdjust: 'spacingAndGlyphs' as const }
              : {};
          return (
            <g
              key={p.id}
              data-testid={`grave-${p.id}`}
              className={`grave${many ? ' grave-crowded' : ''}`}
              style={{ transform: `translate(${p.pos.x * CELL}px, ${p.pos.y * CELL}px)`, pointerEvents: 'none' }}
            >
              {/* SVG transform ATTRIBUTE takes user units, not CSS px —
                  "px" makes Chrome reject the whole transform, and every
                  mini stone then renders full-size stacked on the same spot
                  (the "one giant tombstone" bug). translate uses plain
                  numbers separated by a space. */}
              <g transform={`translate(${slot[0] * CELL - (CELL * scale) / 2} ${slot[1] * CELL - (CELL * scale) / 2}) scale(${scale})`}>
                <path
                  d={`M${CELL * 0.16} ${CELL * 0.88}
                      V ${CELL * 0.38}
                      A ${CELL * 0.34},${CELL * 0.26} 0 0 1 ${CELL * 0.84} ${CELL * 0.38}
                      V ${CELL * 0.88} Z`}
                  className="grave-stone"
                />
                {/* portrait stamped well INSIDE the stone edge (paper frame
                    margin all round — the image never touches the stone's
                    edge) */}
                <image
                  x={CELL * 0.24} y={CELL * 0.24}
                  width={CELL * 0.52} height={CELL * 0.28}
                  href={avatars?.[p.id] ?? flagUrl(p.id)}
                  preserveAspectRatio="xMidYMid slice"
                  className="grave-pic"
                  data-testid={`grave-pic-${p.id}`}
                />
                {/* name sits on the stone face under the portrait — paper
                    text with an ink halo. Every stone up to the fourth keeps
                    its name; a >4 crowd drops them (unreadable at that size)
                    and the mound's ×N tag stands in. */}
                {crowd.length <= CROWD_MAX && (
                  <text
                    x={CELL / 2}
                    y={CELL * 0.76}
                    textAnchor="middle"
                    className="grave-name"
                    {...nameFit}
                  >
                    {p.name}
                  </text>
                )}
              </g>
            </g>
          );
        })}
        {/* heart tiles: every unclaimed board heart (spawned by the tick loop
            up to the config's heart cap, claimed by moving onto one). Sits
            under the tank layer; legacy snapshots carry a single `heart`. */}
        {(state.hearts ?? (state.heart ? [state.heart] : [])).map((h) => (
          <g
            key={`${h.x},${h.y}`}
            data-testid="heart-tile"
            className="heart-tile"
            style={{ transform: `translate(${h.x * CELL}px, ${h.y * CELL}px)`, pointerEvents: 'none' }}
          >
            {/* ration-token backing: stamped paper tile with an ink border */}
            <rect
              x={CELL * 0.08} y={CELL * 0.08}
              width={CELL * 0.84} height={CELL * 0.84}
              rx={CELL * 0.14}
              className="heart-backing"
            />
            <path
              d={`M${CELL / 2} ${CELL * 0.78}
                  C ${CELL * 0.2} ${CELL * 0.56}, ${CELL * 0.12} ${CELL * 0.36}, ${CELL * 0.28} ${CELL * 0.24}
                  C ${CELL * 0.37} ${CELL * 0.17}, ${CELL / 2} ${CELL * 0.24}, ${CELL / 2} ${CELL * 0.34}
                  C ${CELL / 2} ${CELL * 0.24}, ${CELL * 0.63} ${CELL * 0.17}, ${CELL * 0.72} ${CELL * 0.24}
                  C ${CELL * 0.88} ${CELL * 0.36}, ${CELL * 0.8} ${CELL * 0.56}, ${CELL / 2} ${CELL * 0.78} Z`}
              className="heart-shape"
            />
          </g>
        ))}
        {/* tank layer: one keyed <g> per ALIVE player, translated by position.
            Moves mutate the transform (CSS slides it); dead tanks are drawn
            as gravestones instead (below) and no longer block moves. */}
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
            {/* name plate: stamped across the top of the square (host can
                turn names off via config.showPlayerNames). CSS uppercases it,
                so the width estimate runs on the uppercase form; a name wider
                than the plate is squeezed to the plate width (textLength),
                never spilling off the square. */}
            {state.config.showPlayerNames !== false && (() => {
              const est = nameWidthPx(p.name.toUpperCase(), 9, 9 * 0.04);
              return (
                <text
                  x={CELL / 2} y={9} textAnchor="middle" className="tank-name"
                  {...(est > TANK_NAME_MAX
                    ? { textLength: TANK_NAME_MAX, lengthAdjust: 'spacingAndGlyphs' as const }
                    : {})}
                >
                  {p.name}
                </text>
              );
            })()}
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
        {fx && lastEvent && lastEvent.actorId !== HIDDEN_ACTOR && (
          <g
            key={lastEvent.seq}
            data-testid={FX_TESTIDS[fx.kind]}
            style={{ pointerEvents: 'none' }}
            onAnimationEnd={(e) => {
              if (!(e.target as Element).classList.contains('fx-bullet')) setFxLive(false);
            }}
          >
            {(fx.kind === 'attack' || fx.kind === 'give_ap') && (
              <>
                {/* bullet layer is translated to the actor cell CENTER; the
                    keyframe adds only the (to − from) delta via --fx-dx/dy */}
                <g
                  style={{
                    transform: `translate(${fx.from.x * CELL + CELL / 2}px, ${fx.from.y * CELL + CELL / 2}px)`,
                  }}
                >
                  <circle
                    r={5}
                    fill={fx.kind === 'attack' ? '#e33' : '#3c3'}
                    className="fx-bullet"
                    style={{
                      ['--fx-dx' as string]: `${(fx.to!.x - fx.from.x) * CELL}px`,
                      ['--fx-dy' as string]: `${(fx.to!.y - fx.from.y) * CELL}px`,
                    }}
                  />
                </g>
                {/* victim ring stays OUTSIDE the translated layer — absolute
                    coordinates (the layer translate would displace it) */}
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
