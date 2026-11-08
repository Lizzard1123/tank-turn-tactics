# Plan A — Game Engine (@ttt/engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-dependency, pure-TypeScript event-sourced game engine:
reducer, seeded RNG, replay/rewind, and seeded random bots, fully unit-tested.

**Architecture:** All state changes are events run through a pure reducer
`applyEvent(state, event) -> state`. `replay()` folds an event list into
state; rewind = replay to a seq. Bots emit the same events humans do, driven
by a seeded PRNG so replays are reproducible.

**Tech Stack:** TypeScript (strict), vitest. No runtime deps.

**Spec:** `docs/2026-11-07-tank-turn-tactics-design.md`
**Overview:** `docs/plans-overview.md`

## Global Constraints

- Zero runtime dependencies; strict TS; no I/O anywhere in the engine.
- All randomness via `rng.ts` `mulberry32`.
- Events are `{seq, type, actorId, payload, createdAt}`; `seq` starts at 1.
- Illegal events throw `EngineError` (the reducer never silently ignores).

---

### Task A1: Project scaffold + types

**Files:**
- Create: `package.json` (root workspaces)
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`
- Create: `packages/engine/src/types.ts`
- Create: `packages/engine/test/smoke.test.ts`

**Interfaces:**
- Produces: all core types below; later tasks import from `src/types.ts`.

- [ ] **Step 1: Root package.json**

```json
{
  "name": "tank-turn-tactics",
  "private": true,
  "workspaces": ["packages/*", "app"],
  "scripts": { "test": "vitest run" },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.1.0" }
}
```

- [ ] **Step 2: packages/engine/package.json**

```json
{
  "name": "@ttt/engine",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "test": "vitest run" }
}
```

- [ ] **Step 3: tsconfig (engine)**

```json
{
  "compilerOptions": {
    "strict": true, "target": "ES2022", "module": "ESNext",
    "moduleResolution": "Bundler", "declaration": true, "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: types.ts — the contract everything else uses**

```ts
export type PlayerId = string; // uuid or "bot-1"

export interface Vec { x: number; y: number }

export interface PlayerState {
  id: PlayerId;
  name: string;
  pos: Vec;
  hp: number;
  ap: number;
  range: number;
  isBot: boolean;
  botDifficulty: 'easy' | 'medium' | 'hard' | null;
}

export interface JuryVote { voterId: PlayerId; candidateId: PlayerId }

export interface GameState {
  seq: number;              // last applied event seq (0 = initial)
  day: number;              // 1-based
  tickClockMinutes: number; // minutes of "game time" elapsed (test mode)
  config: GameConfig;
  players: Record<PlayerId, PlayerState>;
  order: PlayerId[];        // stable display order
  jury: PlayerId[];         // dead players, in death order
  pendingVotes: JuryVote[]; // this day's jury votes (cleared on tick)
  winner: PlayerId | null;
  log: LogEntry[];
}

export interface LogEntry { seq: number; text: string }

export interface GameConfig {
  seed: number;
  board: number;            // board x board grid
  startingHp: number;       // default 3
  startingAp: number;       // default 0
  baseRange: number;        // default 2
  apPerDay: number;         // default 1
  upgradeCost: number;      // default 2 AP per +1 range
  apIntervalMinutes: number;// test-mode AP drip; 0 = daily (server-managed)
}

export type ActionType =
  | 'move' | 'attack' | 'give_ap' | 'upgrade_range'
  | 'daily_tick' | 'jury_vote' | 'fork' | 'bot_action';

export interface GameEvent {
  seq: number;
  type: ActionType;
  actorId: PlayerId | 'system';
  createdAt: string;        // ISO timestamp (informational; not in reducer logic)
  payload: Record<string, unknown>;
}
```

- [ ] **Step 5: smoke test that types compile**

```ts
// test/smoke.test.ts
import { describe, it, expect } from 'vitest';
import type { GameState, GameEvent } from '../src/types';

describe('engine scaffold', () => {
  it('imports types without error', () => {
    const e: GameEvent | null = null;
    expect(e).toBeNull();
  });
});
```

- [ ] **Step 6: Run** `npm test` at repo root → PASS (1 test).
- [ ] **Step 7: Commit** `git add -A && git commit -m "feat(engine): scaffold + core types"`

---

### Task A2: Seeded RNG

**Files:**
- Create: `packages/engine/src/rng.ts`
- Test: `packages/engine/test/rng.test.ts`

**Interfaces:**
- Produces: `export function mulberry32(seed: number): () => number` —
  returns `() => float in [0,1)`; and
  `export function hashSeed(s: string): number` (string → 32-bit seed, used
  for `(seed, seq)` bot seeding later).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32, hashSeed } from '../src/rng';

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42), b = mulberry32(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });
  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it('values are in [0,1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('hashSeed is deterministic and differs per input', () => {
    expect(hashSeed('a:1')).toBe(hashSeed('a:1'));
    expect(hashSeed('a:1')).not.toBe(hashSeed('a:2'));
  });
});
```

- [ ] **Step 2: Run → FAIL** (`Cannot find module '../src/rng'`).
- [ ] **Step 3: Implement** (standard mulberry32; FNV-1a for hashSeed)

```ts
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(engine): seeded rng`.

---

### Task A3: Initial state + event application helpers

**Files:**
- Create: `packages/engine/src/state.ts`, `packages/engine/src/geom.ts`
- Test: `packages/engine/test/state.test.ts`

**Interfaces:**
- Produces:
  - `createInitialState(config: GameConfig, playerSpecs: {id, name, isBot, botDifficulty}[]): GameState` — places players on distinct random cells via `mulberry32(config.seed)`, sets `day: 1`, `seq: 0`.
  - `manhattan(a: Vec, b: Vec): number`
  - `inRange(a: Vec, b: Vec, range: number): boolean` (Manhattan ≤ range)
  - `emptyOrOccupied(state, pos): PlayerId | null` — occupant id or null.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/state';
import { inRange, manhattan } from '../src/geom';
import type { GameConfig } from '../src/types';

const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({
  seed: 1, board: 8, startingHp: 3, startingAp: 0, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0, ...over,
});
const specs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`, name: `P${i + 1}`, isBot: false, botDifficulty: null,
  }));

describe('createInitialState', () => {
  it('gives every player starting stats', () => {
    const s = createInitialState(cfg(), specs(3));
    expect(Object.values(s.players).every(p =>
      p.hp === 3 && p.ap === 0 && p.range === 2)).toBe(true);
  });
  it('places players on distinct cells inside the board', () => {
    const s = createInitialState(cfg({ board: 6 }), specs(5));
    const cells = new Set(Object.values(s.players).map(p => `${p.pos.x},${p.pos.y}`));
    expect(cells.size).toBe(5);
    for (const p of Object.values(s.players)) {
      expect(p.pos.x).toBeLessThan(6); expect(p.pos.y).toBeLessThan(6);
    }
  });
  it('is deterministic on the same seed', () => {
    const a = createInitialState(cfg(), specs(4));
    const b = createInitialState(cfg(), specs(4));
    expect(a.order).toEqual(b.order);
    expect(a.players).toEqual(b.players);
  });
  it('throws if players exceed cells', () => {
    expect(() => createInitialState(cfg({ board: 2 }), specs(5))).toThrow();
  });
});

describe('geom', () => {
  it('manhattan distance', () => {
    expect(manhattan({x:0,y:0}, {x:2,y:1})).toBe(3);
  });
  it('inRange uses manhattan <= range', () => {
    expect(inRange({x:0,y:0}, {x:2,y:0}, 2)).toBe(true);
    expect(inRange({x:0,y:0}, {x:2,y:1}, 2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**

```ts
// geom.ts
import type { PlayerId, Vec } from './types';
export const manhattan = (a: Vec, b: Vec) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const inRange = (a: Vec, b: Vec, range: number) => manhattan(a, b) <= range;
export function occupantAt(players: Record<PlayerId, { pos: Vec }>, pos: Vec): PlayerId | null {
  for (const [id, p] of Object.entries(players)) if (p.pos.x === pos.x && p.pos.y === pos.y) return id;
  return null;
}
```

```ts
// state.ts
import { mulberry32 } from './rng';
import { occupantAt } from './geom';
import type { GameConfig, GameState, PlayerId, PlayerState } from './types';

export interface PlayerSpec { id: PlayerId; name: string; isBot: boolean; botDifficulty: 'easy'|'medium'|'hard'|null }

export function createInitialState(config: GameConfig, specs: PlayerSpec[]): GameState {
  const rand = mulberry32(config.seed);
  const players: Record<PlayerId, PlayerState> = {};
  const order: PlayerId[] = [];
  for (const spec of specs) {
    if (specs.length > config.board * config.board) throw new Error('too many players for board');
    let pos = { x: 0, y: 0 }, tries = 0;
    do {
      pos = { x: Math.floor(rand() * config.board), y: Math.floor(rand() * config.board) };
      tries++;
    } while (occupantAt(players, pos) !== null && tries < 1000);
    if (occupantAt(players, pos) !== null) throw new Error('could not place player');
    players[spec.id] = {
      id: spec.id, name: spec.name, pos, hp: config.startingHp, ap: config.startingAp,
      range: config.baseRange, isBot: spec.isBot, botDifficulty: spec.botDifficulty,
    };
    order.push(spec.id);
  }
  return { seq: 0, day: 1, tickClockMinutes: 0, config, players, order, jury: [], pendingVotes: [], winner: null, log: [] };
}
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(engine): initial state + geometry`.

---

### Task A4: Reducer — player actions

**Files:**
- Create: `packages/engine/src/errors.ts`, `packages/engine/src/reducer.ts`
- Test: `packages/engine/test/actions.test.ts`

**Interfaces:**
- Produces: `export class EngineError extends Error {}` and
  `export function applyEvent(state: GameState, event: GameEvent): GameState`.
  Returns a **new** state object (shallow-copied player records on change).
  Payloads: `move {to: Vec}`; `attack {targetId}`; `give_ap {targetId}`;
  `upgrade_range {}`; `bot_action {inner: {type, payload}}` (validates inner
  like a normal action, actorId = bot id); `fork {toSeq: number}` (see A6);
  `daily_tick {apGained}`; `jury_vote {candidateId}` (see A5).

- [ ] **Step 1: Failing tests** (table-driven — the key ones shown; write all)

```ts
import { describe, it, expect } from 'vitest';
import { applyEvent } from '../src/reducer';
import { EngineError } from '../src/errors';
import { createInitialState } from '../src/state';
import type { GameConfig, GameEvent, GameState } from '../src/types';

const cfg: GameConfig = {
  seed: 1, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
};
// deterministic initial state: p1 at seed-1's first cell etc.
let base = createInitialState(cfg, [
  { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
  { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
]);

let seq = 0;
function ev(state: GameState, actorId: string, type: GameEvent['type'], payload: Record<string, unknown> = {}): GameEvent {
  return { seq: ++seq, type, actorId, createdAt: new Date().toISOString(), payload };
}
// helper: teleport two players next to each other WITHOUT events (test-only)
function placeNear(s: GameState, a: string, b: string): GameState {
  const posB = s.players[b].pos;
  const na = { ...s, players: { ...s.players,
    [a]: { ...s.players[a], pos: { x: posB.x + 1 <= 7 ? posB.x + 1 : posB.x - 1, y: posB.y } } } };
  return na;
}

describe('move', () => {
  it('moves 1 orthogonal square and costs 1 AP', () => {
    let s = base;
    const from = s.players.p1.pos;
    const to = { x: (from.x + 1) % 8, y: from.y };
    s = applyEvent(s, ev(s, 'p1', 'move', { to }));
    expect(s.players.p1.pos).toEqual(to);
    expect(s.players.p1.ap).toBe(3);
  });
  it('rejects diagonal, out-of-board, occupied, multi-square, and no-AP moves', () => {
    const from = base.players.p1.pos;
    expect(() => applyEvent(base, ev(base, 'p1', 'move', { to: { x: from.x + 1, y: from.y + 1 } }))).toThrow(EngineError);
    expect(() => applyEvent(base, ev(base, 'p1', 'move', { to: { x: from.x + 3, y: from.y } }))).toThrow(EngineError);
    expect(() => applyEvent(base, ev(base, 'p1', 'move', { to: { x: -1, y: from.y } }))).toThrow(EngineError);
    expect(() => applyEvent(base, ev(base, 'p1', 'move', { to: base.players.p2.pos }))).toThrow(EngineError);
    const noAp = { ...base, players: { ...base.players, p1: { ...base.players.p1, ap: 0 } } };
    expect(() => applyEvent(noAp, ev(noAp, 'p1', 'move', { to: { x: from.x + 1, y: from.y } }))).toThrow(EngineError);
  });
});

describe('attack', () => {
  it('in-range attack costs 1 AP and removes 1 HP; kill moves to jury', () => {
    let s = placeNear(base, 'p1', 'p2');
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.players.p2.hp).toBe(2);
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, hp: 1 } } };
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(s.jury).toContain('p2');
    expect(s.winner).toBe('p1');
  });
  it('rejects out-of-range and self-attack', () => {
    // teleport p1 far from p2 deterministically (opposite corner)
    const far = { ...base, players: { ...base.players,
      p1: { ...base.players.p1, pos: { x: 0, y: 0 } },
      p2: { ...base.players.p2, pos: { x: 7, y: 7 } } } };
    expect(() => applyEvent(far, ev(far, 'p1', 'attack', { targetId: 'p2' }))).toThrow(EngineError);
    expect(() => applyEvent(placeNear(base, 'p1', 'p2'), ev(base, 'p1', 'attack', { targetId: 'p1' }))).toThrow(EngineError);
  });
});

describe('give_ap and upgrade_range', () => {
  it('gives 1 AP per 1 AP in range', () => {
    let s = placeNear(base, 'p1', 'p2');
    s = applyEvent(s, ev(s, 'p1', 'give_ap', { targetId: 'p2' }));
    expect(s.players.p1.ap).toBe(3);
    expect(s.players.p2.ap).toBe(5);
  });
  it('upgrades range for upgradeCost AP', () => {
    let s = applyEvent(base, ev(base, 'p1', 'upgrade_range', {}));
    expect(s.players.p1.range).toBe(3);
    expect(s.players.p1.ap).toBe(2);
  });
  it('rejects out-of-range give and insufficient AP upgrade', () => {
    expect(() => applyEvent(base, ev(base, 'p1', 'give_ap', { targetId: 'p2' }))).toThrow(EngineError);
    const poor = { ...base, players: { ...base.players, p1: { ...base.players.p1, ap: 1 } } };
    expect(() => applyEvent(poor, ev(poor, 'p1', 'upgrade_range', {}))).toThrow(EngineError);
  });
});

describe('bot_action', () => {
  it('applies the inner action as the bot', () => {
    const s = { ...base, players: { ...base.players, p2: { ...base.players.p2, isBot: true, botDifficulty: 'easy' as const } } };
    const from = s.players.p2.pos;
    const s2 = applyEvent(s, ev(s, 'p2', 'bot_action', { inner: { type: 'move', payload: { to: { x: (from.x + 1) % 8, y: from.y } } } }));
    expect(s2.players.p2.ap).toBe(3);
  });
});

describe('log', () => {
  it('appends a human-readable log entry per event', () => {
    const s = applyEvent(base, ev(base, 'p1', 'upgrade_range', {}));
    expect(s.log.at(-1)!.seq).toBe(seq);
    expect(s.log.at(-1)!.text).toMatch(/p1|A/);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement reducer.** Structure:

```ts
// errors.ts
export class EngineError extends Error {}
```

```ts
// reducer.ts — sketch of the validated action core
import { EngineError } from './errors';
import { inRange, occupantAt } from './geom';
import type { GameEvent, GameState, PlayerState, Vec } from './types';

const requiredAp = (type: string, config: GameState['config']) =>
  type === 'upgrade_range' ? config.upgradeCost : 1;

function assertAlive(s: GameState, id: string): PlayerState {
  const p = s.players[id];
  if (!p) throw new EngineError('unknown player');
  if (p.hp <= 0) throw new EngineError('player is dead');
  return p;
}

function applyAction(s: GameState, actorId: string, type: string, payload: Record<string, unknown>): GameState {
  const actor = assertAlive(s, actorId);
  const cost = requiredAp(type, s.config);
  if (actor.ap < cost) throw new EngineError('not enough AP');
  const spend = (n: number) => n - cost + 0; // per-action below
  switch (type) {
    case 'move': {
      const to = payload.to as Vec;
      const dx = Math.abs(to.x - actor.pos.x), dy = Math.abs(to.y - actor.pos.y);
      if (dx + dy !== 1) throw new EngineError('move must be 1 orthogonal square');
      if (to.x < 0 || to.y < 0 || to.x >= s.config.board || to.y >= s.config.board) throw new EngineError('outside board');
      if (occupantAt(s.players, to)) throw new EngineError('cell occupied');
      return { ...s, players: { ...s.players, [actorId]: { ...actor, pos: to, ap: actor.ap - 1 } } };
    }
    case 'attack': {
      const target = assertAlive(s, payload.targetId as string);
      if (payload.targetId === actorId) throw new EngineError('cannot attack self');
      if (!inRange(actor.pos, target.pos, actor.range)) throw new EngineError('target out of range');
      const hp = target.hp - 1;
      const players = { ...s.players, [actorId]: { ...actor, ap: actor.ap - 1 },
        [target.id]: { ...target, hp } };
      let jury = s.jury, winner = s.winner;
      if (hp <= 0) {
        jury = [...s.jury, target.id];
        const alive = Object.values(players).filter(p => p.hp > 0);
        if (alive.length === 1) winner = alive[0].id;
      }
      return { ...s, players, jury, winner };
    }
    case 'give_ap': {
      const target = assertAlive(s, payload.targetId as string);
      if (!inRange(actor.pos, target.pos, actor.range)) throw new EngineError('target out of range');
      return { ...s, players: { ...s.players,
        [actorId]: { ...actor, ap: actor.ap - 1 },
        [target.id]: { ...target, ap: target.ap + 1 } } };
    }
    case 'upgrade_range': {
      return { ...s, players: { ...s.players,
        [actorId]: { ...actor, ap: actor.ap - s.config.upgradeCost, range: actor.range + 1 } } };
    }
    default: throw new EngineError(`unknown action ${type}`);
  }
}

export function applyEvent(state: GameState, event: GameEvent): GameState {
  if (event.seq !== state.seq + 1) throw new EngineError(`seq gap: expected ${state.seq + 1}, got ${event.seq}`);
  // handle bot_action (unwrap inner), daily_tick, jury_vote, fork here (A5/A6)
  // actions via applyAction; then append log entry and return with seq: event.seq
  // ... (full implementation in this task)
}
```

Also in this task: `bot_action` validation (actor must be a bot; `inner`
validated with the same rules via `applyAction`); log lines
(`"A moved to (3,4)"`, `"A attacked B for 1 damage"`, `"A gave B 1 AP"`,
`"A upgraded range to 3"`).

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(engine): action reducer`.

---

### Task A5: Reducer — day tick + jury

**Files:**
- Modify: `packages/engine/src/reducer.ts`
- Test: `packages/engine/test/ticks.test.ts`

**Interfaces:**
- Consumes: `applyEvent` from A4.
- Produces: `daily_tick {apGained: number}` — +`apGained` AP to every alive
  player; advances `day` by 1; resolves `pendingVotes`: candidates with
  ≥3 votes each get +1 extra AP; clears `pendingVotes`.
  `jury_vote {candidateId}` — actor must be in `jury`; appends to
  `pendingVotes`; same voter may vote again next day, not twice per day.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { applyEvent } from '../src/reducer';
import { EngineError } from '../src/errors';
import { createInitialState } from '../src/state';
import type { GameEvent } from '../src/types';

const base = createInitialState({
  seed: 5, board: 8, startingHp: 3, startingAp: 0, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
}, [
  { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
  { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
  { id: 'p3', name: 'C', isBot: false, botDifficulty: null },
]);
let seq = 0;
const ev = (actorId: string, type: GameEvent['type'], payload: Record<string, unknown> = {}): GameEvent =>
  ({ seq: ++seq, type, actorId, createdAt: '2026-01-01T00:00:00Z', payload });

describe('daily_tick', () => {
  it('gives apPerDay to all alive players and advances the day', () => {
    let s = applyEvent(base, ev('system', 'daily_tick', { apGained: 1 }));
    expect(s.day).toBe(2);
    for (const p of Object.values(s.players)) expect(p.ap).toBe(1);
  });
  it('dead players get nothing', () => {
    let s = { ...base, players: { ...base.players, p3: { ...base.players.p3, hp: 0 } }, jury: ['p3'] };
    s = applyEvent(s, ev('system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p3.ap).toBe(0);
  });
});

describe('jury', () => {
  it('dead player can vote once per day', () => {
    let s = { ...base, jury: ['p3'] };
    s = applyEvent(s, ev('p3', 'jury_vote', { candidateId: 'p1' }));
    expect(s.pendingVotes).toContainEqual({ voterId: 'p3', candidateId: 'p1' });
  });
  it('rejects duplicate vote in the same day', () => {
    let s = { ...base, jury: ['p3'], pendingVotes: [{ voterId: 'p3', candidateId: 'p1' }] };
    expect(() => applyEvent(s, ev('p3', 'jury_vote', { candidateId: 'p2' }))).toThrow(EngineError);
  });
  it('alive player cannot vote', () => {
    expect(() => applyEvent(base, ev('p1', 'jury_vote', { candidateId: 'p2' }))).toThrow(EngineError);
  });
  it('three jury votes award 1 bonus AP on tick', () => {
    let s = { ...base, jury: ['j1', 'j2', 'j3'] };
    for (const j of ['j1', 'j2', 'j3']) s = applyEvent(s, ev(j, 'jury_vote', { candidateId: 'p1' }));
    s = applyEvent(s, ev('system', 'daily_tick', { apGained: 1 }));
    expect(s.players.p1.ap).toBe(2); // 1 drip + 1 jury bonus
    expect(s.players.p2.ap).toBe(1);
    expect(s.pendingVotes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** in `reducer.ts` (cases
  `daily_tick`, `jury_vote`; duplicate-vote check = a pending vote with the
  same voterId). **Step 4: Run → PASS.** **Step 5: Commit**
  `feat(engine): day ticks + jury votes`.

---

### Task A6: Replay + rewind (fork)

**Files:**
- Create: `packages/engine/src/replay.ts`
- Test: `packages/engine/test/rewind.test.ts`

**Interfaces:**
- Consumes: `applyEvent`, `createInitialState`.
- Produces:
  - `replay(config, specs, events): GameState` — createInitialState then fold.
  - `applyEvents(state, events): GameState` — fold onto existing state.
  - `replayToSeq(config, specs, events, toSeq): GameState` — slice then fold
    (the rewind primitive).
- `fork {toSeq}` event semantics: the fork event itself records the point;
  the **caller** supplies the truncated event list to `replay` afterwards.
  The reducer's `fork` case only logs it (defense-in-depth: it must not
  change board state).

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { replay, replayToSeq } from '../src/replay';
import { applyEvent } from '../src/reducer';
import { EngineError } from '../src/errors';
import type { GameEvent, GameConfig } from '../src/types';

const cfg: GameConfig = {
  seed: 9, board: 8, startingHp: 3, startingAp: 5, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
};
const specs = [
  { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
  { id: 'p2', name: 'B', isBot: false, botDifficulty: null },
];
let seq = 0;
const ev = (actorId: string, type: GameEvent['type'], payload: Record<string, unknown> = {}): GameEvent =>
  ({ seq: ++seq, type, actorId, createdAt: '2026-01-01T00:00:00Z', payload });

describe('replay', () => {
  it('replaying events equals folding them live', () => {
    const from = { ...cfg };
    void from;
    const live = replay(cfg, specs, []);
    const s1 = applyEvent(live, ev('p1', 'upgrade_range', {}));
    const s2 = applyEvent(s1, ev('p1', 'upgrade_range', {}));
    const replayed = replay(cfg, specs, [
      ev('p1', 'upgrade_range', {}), ev('p1', 'upgrade_range', {}),
    ]);
    expect(replayed.players.p1).toEqual(s2.players.p1);
  });
  it('rejects gaps', () => {
    expect(() => replay(cfg, specs, [
      { seq: 2, type: 'upgrade_range', actorId: 'p1', createdAt: '', payload: {} },
    ])).toThrow(EngineError);
  });
  it('replayToSeq rewinds: later actions are absent', () => {
    const e1 = ev('p1', 'upgrade_range', {});
    const e2 = ev('p1', 'upgrade_range', {});
    const full = replay(cfg, specs, [e1, e2]);
    expect(full.players.p1.range).toBe(4);
    const rewound = replayToSeq(cfg, specs, [e1, e2], 1);
    expect(rewound.players.p1.range).toBe(3);
    expect(rewound.seq).toBe(1);
  });
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** `replay.ts` (three small
  functions; fold with seq-gap check inherited from `applyEvent`).
  **Step 4: Run → PASS.** **Step 5: Commit** `feat(engine): replay + rewind`.

---

### Task A7: Bots (seeded random per difficulty)

**Files:**
- Create: `packages/engine/src/bots.ts`
- Test: `packages/engine/test/bots.test.ts`

**Interfaces:**
- Consumes: `GameState`, `inRange`, `mulberry32`, `hashSeed`.
- Produces: `planBotAction(state, botId): {type: ActionType, payload} | null`
  — pure decision function; null = bot does nothing. Difficulty tuning:
  - **easy:** 40% act; move or (if someone in range) 50/50 move/attack.
  - **medium:** 80% act; prefers attack when someone in range; upgrades if
    no target and AP ≥ cost; else moves.
  - **hard:** 95% act; attacks lowest-HP in-range player; gives AP to an
    ally-like rule (first player who gave it AP — tracked from log is
    out of scope, so: gives AP if it has >4 AP and someone in range);
    upgrades when no target; moves toward nearest player otherwise.
  - Seed derivation: `mulberry32(hashSeed(`${config.seed}:${state.seq}:${botId}`))`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { planBotAction } from '../src/bots';
import { createInitialState } from '../src/state';
import type { GameConfig } from '../src/types';

const cfg: GameConfig = {
  seed: 3, board: 8, startingHp: 3, startingAp: 6, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
};
const mk = (diff: 'easy'|'medium'|'hard') => createInitialState(cfg, [
  { id: 'b1', name: 'Bot', isBot: true, botDifficulty: diff },
  { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
]);

describe('planBotAction', () => {
  it('is deterministic for the same state', () => {
    const s = mk('medium');
    expect(planBotAction(s, 'b1')).toEqual(planBotAction(s, 'b1'));
  });
  it('never returns an illegal action for plenty of states', () => {
    // fuzz: 200 seeds; bot must return null or a legal-on-replay action shape
    for (let seed = 1; seed <= 200; seed++) {
      const s = createInitialState({ ...cfg, seed }, [
        { id: 'b1', name: 'Bot', isBot: true, botDifficulty: 'hard' },
        { id: 'p1', name: 'A', isBot: false, botDifficulty: null },
      ]);
      const a = planBotAction(s, 'b1');
      if (a === null) continue;
      expect(['move', 'attack', 'give_ap', 'upgrade_range']).toContain(a.type);
      if (a.type === 'move') {
        const from = s.players.b1.pos, to = a.payload.to as { x: number; y: number };
        expect(Math.abs(to.x - from.x) + Math.abs(to.y - from.y)).toBe(1);
      }
      if (a.type === 'attack') expect(a.payload.targetId).toBe('p1'); // only 1 target exists
    }
  });
  it('hard bot attacks when someone is in range', () => {
    // force adjacency via teleport in test: place p1 next to b1
    const s = mk('hard');
    const bp = s.players.b1.pos;
    const s2 = { ...s, players: { ...s.players,
      p1: { ...s.players.p1, pos: { x: bp.x + 1 < 8 ? bp.x + 1 : bp.x - 1, y: bp.y } } } };
    const a = planBotAction(s2, 'b1');
    expect(a?.type).toBe('attack');
  });
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** `bots.ts` per the tuning
  above (pure; no mutation of state).
- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(engine): seeded bots`.

---

### Task A8: Public API + coverage pass

**Files:**
- Create: `packages/engine/src/index.ts`
- Test: full run

**Interfaces:**
- Produces: `export * from './types'; export * from './rng';
  export * from './state'; export * from './reducer'; export * from './replay';
  export * from './bots'; export * from './errors';`

- [ ] **Step 1: Write `index.ts`** as above.
- [ ] **Step 2: `npm test`** — all engine tests PASS.
- [ ] **Step 3: Coverage check** `npx vitest run --coverage` — reducer and
  bots each ≥ 90% statements; add a test for any uncovered branch
  (typically: move onto own cell is a no-op-throw, `give_ap` to dead player,
  `fork` log-only).
- [ ] **Step 4: Commit** `feat(engine): public api + coverage`.

---

## Definition of Done (Plan A)

- `npm test` green from repo root.
- Zero runtime deps in `@ttt/engine/package.json` dependencies.
- `replayToSeq` demonstrated rewinding a game in `rewind.test.ts`.
- Bots reproduce identical actions for identical seeds (fuzz test proves the
  shape; determinism test proves the property).
