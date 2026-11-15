#!/usr/bin/env node
/**
 * dev-setup.mjs — local test-lab prep for tank-turn-tactics.
 *
 * What it does (all LOCAL stack, nothing touches prod):
 *   1. Ensures 2 interactive dev accounts exist:  DevA (main) and DevB.
 *      Extra "body" accounts (DevC, DevD) are created only when a game needs
 *      more corpses than players with browsers.
 *   2. Creates one game per FEATURE, each named after the feature it tests
 *      ("Attack & Damage", "Revive 4 Graves Same Spot", ...). DevA creates
 *      and hosts every game; DevB joins the ones that need a second human.
 *   3. Pre-drives deterministic setups through the real `action` endpoint:
 *      walks tanks into range, kills bots/humans to build graves (stacked
 *      2/3/4 on one square), casts jury votes — so each game opens READY to
 *      demonstrate its feature.
 *   4. Opens TWO headed Chromium windows (persistent profiles) signed in as
 *      DevA and DevB, each landing on /games. DevA's dashboard shows every
 *      feature game. Leave the windows open and click around; Ctrl+C exits.
 *
 * Usage:  node scripts/dev-setup.mjs
 *         node scripts/dev-setup.mjs --only="Jury Screen,Jury Bonus"  (rebuild
 *         matching arenas — deletes their live copies so the plan cfg applies)
 * Re-run safe: existing games (matched by exact name) are reused, not
 * duplicated; setups that need a specific corpse layout only run on fresh
 * games.
 *
 * Credentials: passwords are RANDOMLY GENERATED on first run and stored in
 * scripts/dev-accounts.json (gitignored). No passwords live in this source.
 */

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// standard local CLI anon key (pairs with the CLI's demo JWT secret)
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const FN = `${SUPABASE_URL}/functions/v1`;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ACCOUNTS_FILE = path.join(SCRIPT_DIR, 'dev-accounts.json'); // gitignored

// interactive accounts (get browser windows)
const INTERACTIVE = ['DevA', 'DevB'];
// sacrificial bodies (API-only, no browser) — created lazily on first need
const BODIES = ['DevC', 'DevD', 'DevE', 'DevF', 'DevG'];

const supabase = createClient(SUPABASE_URL, ANON_KEY);

// Vite dev server: try the common ports, remember which one answers.
const APP_PORTS = [5173, 5174];
let APP_BASE = null;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const log = (...a) => console.log(...a);
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- direct local-stack powers (tick + freeze) ----------------------------
// The "local cron" is useless for the lab: migration 0011's job posts to the
// PROD tick URL with the LOCAL app_settings value (empty) — every fire 401s
// and no game ever ticks. So the driver mints the daily_tick ITSELF with the
// real engine (the vendored engine_src is plain TS with explicit .ts
// imports, which node 22 runs natively) and commits it through the same
// service-role rpc the edge functions use. The moment the tint lands we
// FREEZE the game's AP drip by patching games.ap_interval_minutes (service
// role bypasses RLS) — golden (lastBonus) and purple (haunted) stay live for
// hours instead of dying at the next tick.
import { applyEvent, juryResultEvent } from '../supabase/functions/_shared/engine_src/reducer.ts';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';

let cachedServiceKey = null;
function serviceKey() {
  if (cachedServiceKey) return cachedServiceKey;
  const out = execFileSync('supabase', ['status', '-o', 'json'], {
    cwd: path.join(SCRIPT_DIR, '..'), encoding: 'utf8',
  });
  cachedServiceKey = JSON.parse(out).SERVICE_ROLE_KEY;
  return cachedServiceKey;
}

// load the TRUE (unscrubbed) detail exactly like the tick function reads it
async function loadFull(gameId) {
  const sk = serviceKey();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/load_game_detail`, {
    method: 'POST',
    headers: { apikey: sk, Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_game_id: gameId, p_player_id: SYSTEM_ID }),
  });
  if (!res.ok) throw new Error(`load_game_detail: HTTP ${res.status}`);
  return res.json();
}

async function commitDailyTick(gameId) {
  const sk = serviceKey();
  const d = await loadFull(gameId);
  if (!d.snap) throw new Error('no snapshot to tick');
  const state = d.snap.state;
  const event = {
    seq: state.seq + 1, type: 'daily_tick', actorId: 'system',
    createdAt: new Date().toISOString(),
    payload: { apGained: state.config.apPerDay ?? 1, elapsedMinutes: 1440 },
  };
  let next = applyEvent(state, event);
  const events = [event];
  // jury outcome event, exactly as the tick edge function mints it
  const jury = juryResultEvent(state, next, next.seq + 1, new Date().toISOString());
  if (jury) {
    next = applyEvent(next, jury);
    events.push(jury);
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/commit_game_update`, {
    method: 'POST',
    headers: { apikey: sk, Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_game_id: gameId,
      p_generation: d.game.cur_generation,
      p_events: events.map((e) => ({ seq: e.seq, type: e.type, actor_id: e.actorId, payload: e.payload, created_at: e.createdAt })),
      p_next_seq: next.seq,
      p_next_state: next,
      p_has_winner: !!next.winner,
      p_member_states: [],
      p_game_patch: { lastTickAt: new Date().toISOString() },
    }),
  });
  if (!res.ok) throw new Error(`commit_game_update: HTTP ${res.status} ${await res.text()}`);
}

async function freezeAp(gameId, minutes) {
  const sk = serviceKey();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}`, {
    method: 'PATCH',
    headers: {
      apikey: sk, Authorization: `Bearer ${sk}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ ap_interval_minutes: minutes }),
  });
  if (!res.ok) throw new Error(`freezeAp: HTTP ${res.status}`);
}

const AP_FREEZE_MINUTES = 600; // 10h — the tint outlives any look at the UI

// Stage the votes, drive daily_ticks DIRECTLY until the tint lands, then
// freeze the drip. Re-casts votes if a stray tick consumed them empty.
async function settleTint(d, label, pred, stageVotes, timeoutMin = 2) {
  const s0 = await d.state();
  if (pred(s0)) {
    await freezeAp(d.gameId, AP_FREEZE_MINUTES); // re-run: re-freeze, harmless
    return;
  }
  const deadline = Date.now() + timeoutMin * 60_000;
  for (;;) {
    const s = await d.state();
    if (pred(s)) break;
    if ((s.pendingVotes ?? []).length === 0) await stageVotes();
    await commitDailyTick(d.gameId); // consumes the votes + advances the day
    if (Date.now() > deadline) throw new Error(`${label}: tint did not land within ${timeoutMin} min`);
    await sleep(500);
  }
  await freezeAp(d.gameId, AP_FREEZE_MINUTES);
  log(`    · ${label} tint live — AP drip frozen for ${AP_FREEZE_MINUTES} min`);
}

function nameToEmail(name) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'player';
  return `${slug}@players.tank-turn.game`;
}

function loadAccountsFile() {
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveAccountsFile(data) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2) + '\n');
}

function storedPassword(file, name) {
  if (!file[name]) file[name] = crypto.randomBytes(12).toString('base64url');
  return file[name];
}

async function ensureAccount(name, file) {
  const password = storedPassword(file, name);
  const email = nameToEmail(name);
  // try sign-in first (idempotent across runs)
  let { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error && data.session) {
    log(`  ✓ ${name} (existing)`);
    return { name, token: data.session.access_token, userId: data.user.id };
  }
  const signup = await supabase.auth.signUp({
    email, password, options: { data: { name } },
  });
  if (signup.error) throw new Error(`account ${name}: ${signup.error.message}`);
  const re = await supabase.auth.signInWithPassword({ email, password });
  if (re.error || !re.data.session) throw new Error(`account ${name}: sign-in after signup failed`);
  log(`  ✓ ${name} (created)`);
  return { name, token: re.data.session.access_token, userId: re.data.user.id };
}

async function fnCall(token, path, body, method = 'POST') {
  const res = await fetch(`${FN}/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${token ?? ANON_KEY}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${(data && data.error) || `HTTP ${res.status}`}`);
  return data;
}

const gameList = (t) => fnCall(t, 'game-list', undefined, 'GET');
const gameCreate = (t, input) => fnCall(t, 'game-create', input);
const gameJoin = (t, inviteCode) => fnCall(t, 'game-join', { inviteCode });
const gameStart = (t, gameId) => fnCall(t, 'game-start', { gameId });
const gameGet = (t, gameId) => fnCall(t, `game-get?gameId=${encodeURIComponent(gameId)}`, undefined, 'GET');
const doAction = (t, gameId, type, payload = {}) => fnCall(t, 'action', { gameId, type, payload });

// ---------------------------------------------------------------------------
// Game-plan definitions. name === the feature being tested.
//   humans: which accounts join ("A"=DevA host, "B"=DevB, "C"/"D"=bodies)
//   NOTE: no game uses bots. The local cron ticks active games about every
//   2 minutes and each tick runs a bot pass — bots with AP would rampage and
//   finish every arena within minutes. Humans never self-act, so a botless
//   lab stays frozen until you click.
//   cfg:    game-config overrides
//   setup:  optional async (driver) => void, pre-drives state after start
//   start:  false = leave the game in lobby (late-join test)
// ---------------------------------------------------------------------------

const baseCfg = (extra = {}) => ({
  board: 8, startingHp: 3, startingAp: 20, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
  ...extra,
});

const PLANS = [
  {
    name: 'Attack & Damage',
    humans: ['A', 'B'],
    about: 'DevB is walked into your range. Select Attack, tap DevB, confirm — bullet fx, HP bar drops.',
    setup: (d) => d.walkAdjacentTo('A', 'B'),
  },
  {
    name: 'Upgrade Range',
    humans: ['A', 'B'],
    about: 'Upgrade Range costs 1 AP here. Confirm shows "upgrade range from 2 to 3", then your range ring grows.',
    cfg: { upgradeCost: 1 },
  },
  {
    name: 'Give AP To Ally',
    humans: ['A', 'B'],
    about: 'DevB is walked next to DevA. Select Give AP, tap DevB, confirm — DevB gains 1 AP, you lose 1.',
    setup: (d) => d.walkAdjacentTo('B', 'A'),
  },
  {
    name: 'Give Heart & Heal',
    humans: ['A', 'B'],
    about: 'DevA chipped DevB for 1 HP. Select Give Heart, tap DevB, confirm — DevB heals (costs you 1 HP).',
    cfg: { heartGifts: true },
    setup: (d) => d.chipOnce('A', 'B'),
  },
  {
    name: 'Revive One Grave',
    humans: ['A', 'B', 'E'],
    about: 'DevB is dead — one grave. Select Give Heart, tap the grave, confirm "give heart to DevB to revive".',
    cfg: { heartGifts: true, revives: true, board: 5 },
    setup: (d) => d.killPair('A', 'B'),
  },
  {
    name: 'Revive 2 Graves Same Spot',
    humans: ['A', 'B', 'C', 'E'],
    about: 'Two stacked graves (DevB + DevC). Tap the square with Give Heart selected — the revive chooser offers both.',
    cfg: { heartGifts: true, revives: true, startingHp: 4, board: 5 },
    setup: (d) => d.stackGraves(2),
  },
  {
    name: 'Revive 3 Graves Same Spot',
    humans: ['A', 'B', 'C', 'D', 'E'],
    about: 'Three stacked graves. Tap the square — chooser lists all three, pick any to revive.',
    cfg: { heartGifts: true, revives: true, startingHp: 4, board: 5 },
    setup: (d) => d.stackGraves(3),
  },
  {
    name: 'Revive 4 Graves Same Spot',
    humans: ['A', 'B', 'C', 'D', 'F', 'E'],
    about: 'Four stacked graves — four separate small tombstones, each with its own portrait and name.',
    cfg: { heartGifts: true, revives: true, startingHp: 4, board: 5 },
    setup: (d) => d.stackGraves(4),
  },
  {
    name: 'Revive 5 Graves Same Spot',
    humans: ['A', 'B', 'C', 'D', 'F', 'G', 'E'],
    about: 'Five stacked graves — past the fourth the stones drop their names and a ×5 tag stands in (the over-cap crowd case). DevE stays alive so the game cannot end.',
    cfg: { heartGifts: true, revives: true, startingHp: 4, board: 5 },
    setup: (d) => d.stackGraves(5),
  },
  {
    name: 'Jury Screen & Voting',
    humans: ['A', 'B', 'E'],
    about: 'Revives OFF: DevB is dead for good — their window shows the JURY screen. DevA is HAUNTED: PURPLE AP counter (and DevA loses a future tick\'s drip). DevB ALSO has a fresh pending vote for DevA — the jury screen says who they voted for and lets them CHANGE it by picking another player. The drip is frozen, so the vote stays pending for hours.',
    cfg: { juryHaunt: true, board: 5, apSchedule: 'interval', apIntervalMinutes: 1 },
    setup: async (d) => {
      await d.killPair('A', 'B');
      await settleTint(d, 'haunt', (s) => s.haunted === d.ids.A, async () => {
        const s = await d.state();
        if (!(s.pendingVotes ?? []).some((v) => v.voterId === d.ids.B)) {
          await doAction(d.tokens.B, d.gameId, 'jury_vote', { candidateId: d.ids.A });
        }
      });
      // change-vote demo: stage a FRESH pending vote (this day's ballot) for
      // DevB's jury screen. The drip is frozen, so no tick consumes it —
      // DevB can swap it in the UI at leisure.
      const s = await d.state();
      if (!(s.pendingVotes ?? []).some((v) => v.voterId === d.ids.B)) {
        await doAction(d.tokens.B, d.gameId, 'jury_vote', { candidateId: d.ids.A });
      }
    },
  },
  {
    name: 'Jury Bonus & Golden AP',
    humans: ['A', 'B', 'C', 'D', 'E'],
    about: 'DevB/C/D are dead and have ALREADY voted for DevA (3 votes, consumed by a tick). DevA got +1 jury AP and a GOLDEN counter — frozen live for hours. Haunt is OFF here so the tint is purely golden — see Jury Screen for the purple one.',
    cfg: { juryHaunt: false, startingHp: 4, board: 5, apSchedule: 'interval', apIntervalMinutes: 1 },
    setup: async (d) => {
      await d.topUpTo('B', 'A', 30); // DevB dies first and never walks
      for (const body of ['B', 'C', 'D']) await d.killPair('A', body);
      await settleTint(d, 'golden', (s) => (s.lastBonus ?? []).some((b) => b.id === d.ids.A && b.day === s.day), async () => {
        for (const voter of ['B', 'C', 'D']) {
          const s = await d.state();
          if ((s.pendingVotes ?? []).some((v) => v.voterId === d.ids[voter])) continue;
          await doAction(d.tokens[voter], d.gameId, 'jury_vote', { candidateId: d.ids.A });
        }
      });
    },
  },
  {
    name: 'AP Steal On Kill',
    humans: ['A', 'B'],
    about: 'apStealOnKill ON, everyone starts with 20 AP. Kill DevB (walked into range) — their whole AP stash transfers to you. Watch the counter jump.',
    cfg: { apStealOnKill: true },
    setup: (d) => d.walkAdjacentTo('A', 'B'),
  },
  {
    name: 'Heart Spawn & Pickup',
    humans: ['A', 'B'],
    about: 'Heart spawns on (up to 3 on the board, one per minute). Move onto a heart token: +1 HP, or +2 AP at full HP.',
    cfg: { heartSpawn: true, heartSchedule: 'interval', heartIntervalMinutes: 1, heartSpawnDelayMinutes: 0, heartCap: 3 },
  },
  {
    name: 'Time-Of-Day AP Schedule',
    humans: ['A', 'B'],
    about: 'AP drips once a day at 12:00 local. The top-bar countdown targets the next 12:00 slot.',
    cfg: { apSchedule: 'timeOfDay', apTimeOfDay: '12:00' },
  },
  {
    name: 'Random AP Schedule',
    humans: ['A', 'B'],
    about: 'AP drips at a secret random minute each hour — NO countdown shown (the grant time is hidden by design).',
    cfg: { apSchedule: 'random', apPeriodMinutes: 60 },
  },
  {
    name: 'Late Join Enabled',
    humans: ['A', 'E'],
    about: 'Running with DevA + a spectator, allowLateJoin ON. DevB: join mid-game with the invite code from the Lobby page.',
    cfg: { allowLateJoin: true },
    start: false, // left running so DevB can late-join
  },
  {
    name: 'Hidden Player Names',
    humans: ['A', 'B'],
    about: 'showPlayerNames OFF — name plates stripped from tanks and graves; ownership rings only.',
    cfg: { showPlayerNames: false },
  },
];

// ---------------------------------------------------------------------------
// Setup driver: walks / attacks / stacks graves through the real action API
// ---------------------------------------------------------------------------

class GameDriver {
  constructor(tokens, ids, gameId) {
    this.tokens = tokens;   // { A: token, B: token, C..., D... }
    this.ids = ids;         // { A: playerId, ... }
    this.gameId = gameId;
  }

  async state() {
    return (await gameGet(this.tokens.A, this.gameId)).state;
  }

  player(state, who) {
    const id = who.startsWith('bot-') ? who : this.ids[who];
    return state.players[id];
  }

  tokenOf(who) {
    return who.startsWith('bot-') ? this.tokens.A : this.tokens[who];
  }

  /** BFS path from `from` to `to` around LIVING players (graves passable) */
  bfsPath(state, from, to) {
    const n = state.config.board;
    const blocked = new Set(
      Object.values(state.players).filter((p) => p.hp > 0).map((p) => `${p.pos.x},${p.pos.y}`),
    );
    const key = (x, y) => `${x},${y}`;
    const prev = new Map([[key(from.x, from.y), null]]);
    const queue = [[from.x, from.y]];
    while (queue.length) {
      const [x, y] = queue.shift();
      if (x === to.x && y === to.y) break;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const k = key(nx, ny);
        if (prev.has(k) || (blocked.has(k) && !(nx === to.x && ny === to.y))) continue;
        // the target square itself is enterable even when "blocked" (it may
        // hold a grave; a living occupant would make the move illegal — the
        // action call surfaces that)
        prev.set(k, [x, y]);
        queue.push([nx, ny]);
      }
    }
    if (!prev.has(key(to.x, to.y))) return null;
    const path = [];
    let cur = [to.x, to.y];
    while (prev.get(key(cur[0], cur[1]))) {
      path.unshift({ x: cur[0], y: cur[1] });
      cur = prev.get(key(cur[0], cur[1]));
    }
    return path;
  }

  /** walk `who` along a BFS path until manhattan(pos, target) <= within */
  async walkTo(who, target, within = 1, maxIters = 80) {
    for (let i = 0; i < maxIters; i++) {
      const state = await this.state();
      const me = this.player(state, who);
      if (manhattan(me.pos, target) <= within) return state;
      const path = this.bfsPath(state, me.pos, target);
      const next = path?.[0];
      if (!next) throw new Error(`${who} cannot path to ${JSON.stringify(target)}`);
      await doAction(this.tokenOf(who), this.gameId, 'move', { to: next });
    }
    throw new Error(`${who}: walk did not converge`);
  }

  /** walk `who` within attack/give range of `other` */
  async walkAdjacentTo(who, other, maxIters = 80) {
    const state = await this.state();
    const me = this.player(state, who);
    const them = this.player(state, other);
    if (!them) throw new Error(`no player ${other}`);
    const range = me.range ?? state.config.baseRange;
    await this.walkTo(who, them.pos, Math.max(1, range), maxIters);
  }

  /** one attack that does NOT kill (leaves target chipped for heal tests) */
  async chipOnce(attacker, target) {
    await this.walkAdjacentTo(attacker, target);
    const state = await this.state();
    const t = this.player(state, target);
    if (t.hp <= state.config.startingHp - 1) return; // already chipped
    await doAction(this.tokens[attacker], this.gameId, 'attack', { targetId: this.ids[target] ?? target });
  }

  /** attack `target` until dead (walking into range each round) */
  async kill(attacker, target, maxIters = 150) {
    for (let i = 0; i < maxIters; i++) {
      const state = await this.state();
      const t = this.player(state, target);
      if (!t || t.hp <= 0) return; // already dead
      const me = this.player(state, attacker);
      const range = me.range ?? state.config.baseRange;
      if (manhattan(me.pos, t.pos) > range) await this.walkAdjacentTo(attacker, target);
      else await doAction(this.tokens[attacker], this.gameId, 'attack', { targetId: this.ids[target] ?? target });
    }
    throw new Error(`kill ${target}: did not die in ${maxIters} iterations`);
  }

  /** DevA kills the named body for grave/jury setups */
  async killPair(a, b) {
    await this.kill(a, b);
  }

  /**
   * Transfer AP one point at a time from `giver` to `recipient` (engine give
   * is +1/-1) until the recipient reaches `target` or the giver runs low.
   * Only the RECIPIENT's own ap is readable through the secrecy scrub, so the
   * recipient must be the caller's own player — always DevA here.
   */
  async topUpTo(giver, recipient, target, maxIters = 60) {
    const first = await this.state();
    const rFirst = this.player(first, recipient);
    const gFirst = this.player(first, giver);
    if (!rFirst || (rFirst.ap ?? 0) >= target) return; // already topped up
    if (!gFirst || gFirst.hp <= 0) return; // giver already spent/dead (re-run)
    await this.walkAdjacentTo(giver, recipient);
    for (let i = 0; i < maxIters; i++) {
      const s = await this.state();
      const g = this.player(s, giver);
      const r = this.player(s, recipient);
      if (!g || g.hp <= 0 || !r || r.hp <= 0) return;
      if ((r.ap ?? 0) >= target) return;
      if ((g.ap ?? 0) <= 0) return;
      await doAction(this.tokens[giver], this.gameId, 'give_ap', { targetId: this.ids[recipient] ?? recipient });
    }
  }

  /**
   * Stack `n` dead players on ONE square. Grave #1 is DevB dying at their own
   * spawn square; graves 2..n = each further body walks ONTO that square
   * (graves are passable) and dies there. Before anything, DevB — who dies
   * first and never needs to walk — donates spare AP to DevA so the kill
   * budget covers every attack (kills cost 1 AP per HP).
   */
  async stackGraves(n) {
    const bodies = ['B', 'C', 'D', 'F', 'G'].slice(0, n);
    await this.topUpTo('B', 'A', 30);
    const spot = this.player(await this.state(), 'B').pos;
    await this.kill('A', 'B'); // grave #1 at DevB's spawn
    for (const body of bodies.slice(1)) {
      const b = this.player(await this.state(), body);
      if (!b || b.hp <= 0) continue; // already stacked (re-run)
      await this.walkTo(body, spot, 0); // ONTO the grave square
      await this.kill('A', body);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function pickAppBase() {
  for (const port of APP_PORTS) {
    try {
      const res = await fetch(`http://localhost:${port}/tank-turn-tactics/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return `http://localhost:${port}/tank-turn-tactics`;
    } catch { /* next port */ }
  }
  return null;
}

async function main() {
  // --status: dump lab game states (winner, alive counts, log tail) and exit
  if (process.argv.includes('--status')) {
    const file = loadAccountsFile();
    const { token } = await ensureAccount('DevA', file);
    for (const g of (await gameList(token)).games ?? []) {
      if (!PLANS.some((p) => p.name === g.name)) continue;
      try {
        const d = await gameGet(token, g.id);
        const players = Object.values(d.state?.players ?? {});
        const alive = players.filter((p) => p.hp > 0).length;
        const dead = players.length - alive;
        const tail = (d.history ?? []).slice(-3).map((e) => `${e.seq}:${e.type}`).join(', ');
        log(`${g.name}  [${g.status}] alive=${alive} dead=${dead} winner=${d.state?.winner ?? '—'} seq=${d.state?.seq} (${tail})`);
      } catch (e) {
        log(`${g.name}  [${g.status}] game-get failed: ${e.message}`);
      }
    }
    return;
  }

  log('── tank-turn-tactics dev lab ───────────────────────────────');
  log(`stack: ${SUPABASE_URL}`);
  APP_BASE = await pickAppBase();
  log(`app:   ${APP_BASE ?? 'NOT RUNNING — start `npm run dev` in app/, then re-run to open browsers'}`);

  // 1. accounts -------------------------------------------------------------
  log('\n1. accounts (passwords in scripts/dev-accounts.json — gitignored)');
  const file = loadAccountsFile();
  const accounts = {};
  for (const name of INTERACTIVE) Object.assign(accounts, { [name]: await ensureAccount(name, file) });
  for (const name of BODIES) Object.assign(accounts, { [name]: await ensureAccount(name, file) });
  saveAccountsFile(file);

  const tokens = {}; // { A, B, C, D, E, F }
  const ids = {};
  for (const [name, acct] of Object.entries(accounts)) {
    const k = name.replace('Dev', '');
    tokens[k] = acct.token;
    ids[k] = acct.userId;
  }

  // 2. games ----------------------------------------------------------------
  log('\n2. feature games (all hosted by DevA)');
  const existing = (await gameList(tokens.A)).games ?? [];
  // game-delete only marks rows finished (tombstone) — old lab games with the
  // same name linger forever, so reuse the LIVE one and ignore tombstones.
  const firstLive = (name) => existing.find((g) => g.name === name && g.status !== 'finished');
  const fresh = process.argv.includes('--fresh'); // ignore live games, rebuild all

  // --only="Jury Screen" — restrict the run to matching games, DELETING their
  // live copies first so the current plan cfg (e.g. today's AP slot) applies.
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1].split(',').map((s) => s.trim()) : null;
  const plans = only ? PLANS.filter((p) => only.some((n) => p.name.includes(n))) : PLANS;
  if (only && plans.length === 0) {
    throw new Error(`--only "${onlyArg.split('=')[1]}": no plan name matches`);
  }

  const created = [];

  for (const plan of plans) {
    try {
      let game;
      if (only) {
        // rebuild mode: tombstone every live copy so the plan's fresh cfg wins
        for (const g of existing.filter((g) => g.name === plan.name && g.status !== 'finished')) {
          await fnCall(tokens.A, 'game-delete', { gameId: g.id }, 'DELETE');
          log(`  − old "${plan.name}" deleted`);
        }
      } else {
        game = fresh ? undefined : firstLive(plan.name);
      }
      if (!game) {
        const cfg = baseCfg(plan.cfg ?? {});
        if (plan.bots?.length) cfg.bots = plan.bots.map((d) => ({ difficulty: d }));
        const r = await gameCreate(tokens.A, {
          name: plan.name, mode: plan.mode ?? 'play', config: cfg,
        });
        game = { id: r.gameId, inviteCode: r.inviteCode, status: 'lobby' };
        log(`  + "${plan.name}" created`);
      } else {
        log(`  ↻ "${plan.name}" reused (${game.status})`);
        // game-list summaries don't carry the invite code — fetch it
        game.inviteCode ??= (await gameGet(tokens.A, game.id)).game.inviteCode;
      }

      // membership: every listed human joins before start
      const detail = await gameGet(tokens.A, game.id);
      const memberIds = new Set((detail.members ?? []).map((m) => m.player_id));
      for (const h of plan.humans) {
        if (h === 'A') continue; // creator is auto-membered
        if (!memberIds.has(ids[h])) await gameJoin(tokens[h], game.inviteCode);
      }

      if (plan.start === false) {
        log(`    · left in LOBBY (invite ${game.inviteCode}) for the late-join test`);
        created.push({ plan, game: { ...game, status: 'lobby' } });
        continue;
      }
      if (detail.game.status === 'lobby') {
        await gameStart(tokens.A, game.id);
        game.status = 'active';
      } else {
        game.status = detail.game.status;
      }
      created.push({ plan, game });
    } catch (e) {
      log(`  ✗ "${plan.name}": ${e.message}`);
    }
  }

  // 3. setups ---------------------------------------------------------------
  log('\n3. pre-driving setups (real moves & attacks — a minute or two)');
  for (const { plan, game } of created) {
    if (!plan.setup || game.status !== 'active') continue;
    try {
      await plan.setup(new GameDriver(tokens, ids, game.id));
      log(`  ✓ "${plan.name}" ready`);
    } catch (e) {
      log(`  ⚠ "${plan.name}" setup incomplete: ${e.message} (game still playable)`);
    }
  }

  // 4. browsers -------------------------------------------------------------
  log('\n4. browsers');
  if (!APP_BASE) {
    log('  skipped — start the dev server and re-run to open the windows.');
  } else {
    const profileRoot = path.join(SCRIPT_DIR, '.dev-profiles'); // gitignored
    fs.mkdirSync(profileRoot, { recursive: true });
    for (const name of INTERACTIVE) {
      const acct = accounts[name];
      let ctx;
      try {
        ctx = await chromium.launchPersistentContext(
          path.join(profileRoot, name),
          { headless: false, viewport: { width: 460, height: 900 } },
        );
      } catch (e) {
        // profile already open in another instance (previous run) — the old
        // window is still up; point the user at it instead of crashing
        log(`  ⚠ ${name}: browser already open (${e.message.split('\n')[0]}) — reuse that window`);
        continue;
      }
      const page = ctx.pages()[0] ?? await ctx.newPage();
      // Sign in through the real UI so the GoTrue session + localStorage
      // mirror is exactly what a human login produces. A persisted profile
      // may already hold a valid session — then /auth redirects to /games.
      await page.goto(`${APP_BASE}/auth`);
      await page.waitForTimeout(1500);
      if (page.url().includes('/games')) {
        log(`  ✓ ${name} (existing session)`);
      } else {
        await page.fill('#name', name);
        await page.fill('#password', file[name]);
        await page.click('button[type="submit"]');
        await page.waitForURL('**/games', { timeout: 20000 }).catch(() => {});
      }
      await page.goto(`${APP_BASE}/games`).catch(() => {});
      log(`  ✓ ${name} window open on /games`);
    }
  }

  // 5. cheat-sheet ----------------------------------------------------------
  log("\n── cheat sheet (all games live on DevA's /games) ──────────");
  // refresh real statuses (setups may have finished a game by accident);
  // prefer the LIVE duplicate over a finished tombstone with the same name
  const liveGames = (await gameList(tokens.A)).games ?? [];
  const liveOf = (name) => liveGames.find((g) => g.name === name && g.status !== 'finished')
    ?? liveGames.find((g) => g.name === name);
  for (const row of created) row.game.status = liveOf(row.plan.name)?.status ?? row.game.status;
  for (const { plan, game } of created) {
    log(`\n▸ ${plan.name}  [${game.status}]`);
    if (plan.about) log(`  ${plan.about}`);
    if (APP_BASE) {
      log(`  ${game.status === 'lobby' ? `${APP_BASE}/lobby/${game.id}` : `${APP_BASE}/game/${game.id}`}`);
    }
    if (plan.start === false) log(`  invite code for DevB: ${game.inviteCode}`);
  }
  log('\nTicks (daily AP / jury haunt / heart spawns) run on the local cron.');
  log('Fork/rewind demos live in the LOCAL test game (/test) — DB test games');
  log('are host-private by design and cannot be joined or started with bots.');
  log('Close the browser windows or Ctrl+C this script when done.');
  // keep the process alive so the browser windows stay open
  await new Promise(() => {});
}

main().catch((e) => {
  console.error('dev-setup failed:', e);
  process.exit(1);
});
