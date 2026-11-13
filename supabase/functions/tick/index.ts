import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import {
  applyEvent, planBotAction, heartSpawnPos, normalizeHeartState, mulberry32, hashSeed,
  scrubState, attackMask, attackActors, maskLog,
  type GameEvent, type GameState,
} from '../_shared/engine.ts';
import { canonicalHistory, effectiveForks } from '../_shared/history.ts';

// AP + heart scheduling (both modes, one mechanism, three schedule shapes):
//   - game-start seeds last_tick_at (play: now, test: null) and started_at
//     (the anchor for 'random' periods).
//   - interval: due once the interval has elapsed since the last grant
//     (the COLUMN, which game-update keeps in sync with config).
//   - timeOfDay: due in the first invocation at/after the slot's local
//     wall-clock instant when that instant is strictly AFTER the last grant —
//     one grant per slot; a game seeded at start (before its slot, same local
//     day) still grants at today's slot; downtime catches up exactly once.
//   - random: each period of length P (anchored at started_at) has ONE grant
//     minute, derived deterministically from the game seed:
//       offset(i) = floor(mulberry32(hashSeed(`${seed}:${key}:${i}`))() * P)
//     due iff now >= started_at + i*P + offset(i) AND the last grant happened
//     before that instant (at most one grant per period, catch-up once).
//     No public countdown — the client hides the timer in this mode.
//   - hearts run the SAME three shapes off config.heartSchedule with their
//     own last_heart_at column; spawn position comes from the engine's
//     heartSpawnPos(state) and travels inside the heart_spawn event.
//   - cron must fire at least every minute (0003/0010/0011) for short
//     intervals and per-minute random granularity.

type ScheduleMode = 'interval' | 'timeOfDay' | 'random';

interface RawEventRow {
  seq: number; type: string; actor_id: string;
  payload: unknown; created_at: string; generation?: number;
}

interface TickDetail {
  game: {
    id: string; mode: string; status: string;
    cur_generation: number; fork_seq: number | null;
    ap_interval_minutes: number | null;
  } | null;
  members: Array<{ player_id: string }>;
  snap: { seq: number; state: GameState } | null;
  history: RawEventRow[];
  forks: Array<{ parent_generation: number; to_seq: number }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tzParts(d: Date, timeZone: string): { y: number; mo: number; day: number; hh: number; mi: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return { y: get('year'), mo: get('month'), day: get('day'), hh: get('hour') % 24, mi: get('minute') };
  } catch {
    return null; // unknown tz id — caller treats as not-due, never silently UTC
  }
}

// Legacy fallback: no apSchedule in config = old resolution order — play
// mode always used the daily time-of-day slot (daily_ap_time column), test
// mode used the interval unless apTimeOfDay was set.
function resolveApSchedule(config: Record<string, unknown>, mode: string): ScheduleMode {
  const s = config.apSchedule as ScheduleMode | undefined;
  if (s === 'interval' || s === 'timeOfDay' || s === 'random') return s;
  return mode === 'play' || config.apTimeOfDay ? 'timeOfDay' : 'interval';
}

function resolveHeartSchedule(config: Record<string, unknown>): ScheduleMode | null {
  if (!config.heartSpawn) return null;
  const s = config.heartSchedule as ScheduleMode | undefined;
  if (s === 'interval' || s === 'timeOfDay' || s === 'random') return s;
  return 'interval'; // hearts default to a simple cadence
}

function randomDue(spec: { startedAt: string | null; lastAt: string | null; periodMinutes?: number; seed: number; key: string }): boolean {
  const P = (spec.periodMinutes ?? 0) * 60_000;
  if (!spec.startedAt || P <= 0) return false;
  const start = new Date(spec.startedAt).getTime();
  const now = Date.now();
  const i = Math.floor((now - start) / P);
  if (i < 0) return false;
  const offset = Math.floor(mulberry32(hashSeed(`${spec.seed}:${spec.key}:${i}`))() * P);
  const dueAt = start + i * P + offset;
  if (now < dueAt) return false;
  // at most one grant per period: skip if the last grant happened at/after
  // this period's due instant (also covers catch-up after downtime: only the
  // CURRENT period can fire, never one per missed period)
  if (spec.lastAt && new Date(spec.lastAt).getTime() >= dueAt) return false;
  return true;
}

// UTC instant of the slot (h:m) on the local (tz) calendar day of `now`.
// Iterative correction: a naive UTC guess renders back to a DIFFERENT local
// wall-clock across DST boundaries, so format the guess in the tz and nudge
// until its wall-clock equals the target (converges in ≤2 steps).
function slotInstantUTC(tz: string, h: number, m: number, now: Date): number | null {
  const p = tzParts(now, tz);
  if (!p) return null;
  const target = Date.UTC(p.y, p.mo - 1, p.day, h, m);
  let g = target;
  for (let i = 0; i < 3; i++) {
    const w = tzParts(new Date(g), tz);
    if (!w) return null;
    g += target - Date.UTC(w.y, w.mo - 1, w.day, w.hh, w.mi);
  }
  return g;
}

function timeOfDayDue(spec: { timeOfDay?: string; timezone?: string; lastAt: string | null }): boolean {
  const tod = spec.timeOfDay ?? '09:00';
  const [h, m] = tod.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;

  const now = new Date();
  const nowMs = now.getTime();
  // Instant-based, not day-based: due once now is past TODAY's slot AND that
  // slot instant is strictly after the last grant. The previous day-comparison
  // ("last grant on an earlier local day") broke games seeded at start on the
  // SAME local day as their slot but before it — the seed counted as today's
  // grant and the whole day was skipped. Grant time lands a second or two
  // after the slot instant, so `slot > lastAt` stays false after granting —
  // exactly one grant per slot.
  if (spec.timezone) {
    const slot = slotInstantUTC(spec.timezone, h, m, now);
    if (slot === null) return false; // unknown tz id — not due, never silently UTC
    if (nowMs < slot) return false;  // before today's slot
    if (!spec.lastAt) return true;   // never granted
    return slot > new Date(spec.lastAt).getTime();
  }
  const S = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m);
  if (nowMs < S) return false;
  if (!spec.lastAt) return true;
  return S > new Date(spec.lastAt).getTime();
}

function intervalDue(spec: { intervalMinutes?: number; lastAt: string | null; fallbackMinutes: number }): boolean {
  const interval = (spec.intervalMinutes && spec.intervalMinutes > 0 ? spec.intervalMinutes : spec.fallbackMinutes) * 60_000;
  if (!spec.lastAt) return true;
  // cron fires ~every minute with sub-second jitter; when the interval
  // EQUALS the cron period, `now - last` lands just under the interval
  // (59.6s) and every other grant is skipped (observed in prod: 1-minute
  // interval dripped every 2 minutes). Tolerate a few seconds of jitter —
  // safe because cron's period (60s) far exceeds the tolerance, so a grant
  // can never fire twice per interval.
  const JITTER_MS = 5000;
  return Date.now() - new Date(spec.lastAt).getTime() >= interval - JITTER_MS;
}

function dueForTick(game: {
  mode: string; daily_ap_time: string; ap_interval_minutes: number | null;
  last_tick_at: string | null; last_heart_at: string | null; started_at: string | null;
  config: Record<string, unknown>;
}): { ap: boolean; heart: boolean } {
  const cfg = game.config ?? {};
  const seed = typeof cfg.seed === 'number' ? cfg.seed : 0;

  // --- AP ---
  const apMode = resolveApSchedule(cfg, game.mode);
  let ap: boolean;
  if (apMode === 'timeOfDay') {
    ap = timeOfDayDue({
      timeOfDay: (cfg.apTimeOfDay as string) ?? game.daily_ap_time,
      timezone: cfg.apTimezone as string | undefined,
      lastAt: game.last_tick_at,
    });
  } else if (apMode === 'random') {
    ap = randomDue({
      startedAt: game.started_at, lastAt: game.last_tick_at,
      periodMinutes: cfg.apPeriodMinutes as number | undefined,
      seed, key: 'ap',
    });
  } else {
    ap = intervalDue({
      intervalMinutes: (game.ap_interval_minutes ?? (cfg.apIntervalMinutes as number | undefined)) ?? undefined,
      lastAt: game.last_tick_at,
      fallbackMinutes: 2,
    });
  }

  // --- hearts ---
  // spawn delay: no hearts at all until heartSpawnDelayMinutes after
  // started_at (0/unset = hearts eligible immediately) — keeps the early
  // game heart-free regardless of schedule shape
  const delayMinutes = (cfg.heartSpawnDelayMinutes as number | undefined) ?? 0;
  let heartDelayOk = true;
  if (delayMinutes > 0) {
    heartDelayOk = !!game.started_at
      && Date.now() - new Date(game.started_at).getTime() >= delayMinutes * 60_000;
  }

  const heartMode = resolveHeartSchedule(cfg);
  let heart = false;
  if (heartDelayOk && heartMode === 'interval') {
    heart = intervalDue({
      intervalMinutes: cfg.heartIntervalMinutes as number | undefined,
      lastAt: game.last_heart_at,
      fallbackMinutes: 60,
    });
  } else if (heartDelayOk && heartMode === 'timeOfDay') {
    heart = timeOfDayDue({
      timeOfDay: cfg.heartTimeOfDay as string | undefined,
      timezone: (cfg.heartTimezone as string | undefined) ?? 'UTC',
      lastAt: game.last_heart_at,
    });
  } else if (heartDelayOk && heartMode === 'random') {
    heart = randomDue({
      startedAt: game.started_at, lastAt: game.last_heart_at,
      periodMinutes: cfg.heartPeriodMinutes as number | undefined,
      seed, key: 'heart',
    });
  }

  return { ap, heart };
}

// System caller id for the detail RPC — it only gates the `player` field
// (which tick ignores); the game data itself is what tick reads.
const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';

async function tickGame(gameId: string, due: { ap: boolean; heart: boolean }): Promise<number> {
  const a = admin();
  // ONE read for everything (migration 0016): game, snapshot, canonical-
  // history inputs, fork points, members (with names via the engine state).
  const { data: d, error: loadErr } = await a.rpc('load_game_detail', {
    p_game_id: gameId, p_player_id: SYSTEM_ID,
  });
  if (loadErr) throw new Error(`detail load failed: ${loadErr.message}`);
  const detail = d as unknown as TickDetail;
  const game = detail.game;
  if (!game || game.status !== 'active') return 0;
  const snap = detail.snap;
  if (!snap) return 0;
  // legacy snapshots carry a single `heart`; normalize to the `hearts` array
  let state: GameState = normalizeHeartState(snap.state as GameState);

  // all events this tick appends, committed atomically at the end
  const newEvents: GameEvent[] = [];

  // 1. AP drip (only when the AP schedule is due)
  if (due.ap) {
    const apGained = (state.config as { apPerDay?: number }).apPerDay ?? 1;
    const drip: GameEvent = {
      seq: state.seq + 1, type: 'daily_tick', actorId: 'system',
      createdAt: new Date().toISOString(), payload: { apGained, elapsedMinutes: game.mode === 'test' ? (game.ap_interval_minutes ?? 2) : 1440 },
    };
    state = applyEvent(state, drip);
    newEvents.push(drip);
  }

  // 2. heart spawn (only when the heart schedule is due); placed BEFORE the
  // bot pass so bots can immediately react and claim it. The board holds at
  // most heartCap unclaimed hearts — spawn only when under the cap.
  if (due.heart) {
    const cap = (state.config as { heartCap?: number }).heartCap ?? 1;
    const onBoard = (state.hearts ?? []).length;
    const pos = onBoard >= cap ? null : heartSpawnPos(state);
    if (pos) {
      const spawn: GameEvent = {
        seq: state.seq + 1, type: 'heart_spawn', actorId: 'system',
        createdAt: new Date().toISOString(),
        payload: { x: pos.x, y: pos.y, placement: (state.config as { heartPlacement?: string }).heartPlacement ?? 'random' },
      };
      state = applyEvent(state, spawn);
      newEvents.push(spawn);
    }
  }

  // 3. bot pass: each bot plans one action (loop until no bot wants to act)
  const botIds = Object.values(state.players).filter(p => p.isBot && p.hp > 0).map(p => p.id);
  for (let pass = 0; pass < 8; pass++) {
    let acted = 0;
    for (const botId of botIds) {
      const action = planBotAction(state, botId);
      if (!action) continue;
      const ev: GameEvent = {
        seq: state.seq + 1, type: 'bot_action', actorId: botId,
        createdAt: new Date().toISOString(), payload: { inner: action },
      };
      try {
        state = applyEvent(state, ev);
      } catch {
        continue; // bot tried something illegal (e.g. race); skip it
      }
      newEvents.push(ev);
      acted++;
    }
    if (acted === 0) break;
  }

  if (newEvents.length === 0) return 0;

  // schedule cursor / winner-status patch for games + the per-member rows
  // (one transaction, see commit_game_update)
  const patch: Record<string, string> = {};
  if (due.ap) patch.lastTickAt = new Date().toISOString();
  if (due.heart) patch.lastHeartAt = new Date().toISOString();
  if (state.winner) patch.status = 'finished';

  // Per-member realtime rows (migration 0016): each member's own scrubbed
  // view of the post-tick state, with the log mask-rewritten over the
  // canonical timeline INCLUDING the new events. Tick events (system drips,
  // heart spawns, bot actions) are never identity-masked — only top-level
  // human attacks are secret — so `events` carries them as-is for the
  // recipients' board fx and scrubber history.
  const canonical = canonicalHistory(
    (detail.history ?? []).map((r) => ({
      seq: r.seq, type: r.type as GameEvent['type'], actorId: r.actor_id,
      createdAt: r.created_at, payload: (r.payload ?? {}) as GameEvent['payload'],
      generation: r.generation as number,
    })),
    effectiveForks(detail.forks ?? [], game.cur_generation, game.fork_seq),
  );
  const full = [...canonical, ...newEvents];
  const mask = attackMask(full);
  const actors = attackActors(full);
  const memberStates = (detail.members ?? [])
    .filter((m) => UUID_RE.test(m.player_id))
    .map((m) => ({
      player_id: m.player_id,
      state: {
        ...scrubState(state, m.player_id),
        log: maskLog(state.log, actors, m.player_id, mask, (id) => state.players[id]?.name ?? id),
      },
      events: newEvents.map((e) => ({ ...e, generation: game.cur_generation })),
      game_patch: patch,
    }));

  // Atomic commit (migration 0016): all events + snapshot + per-member
  // realtime rows + the schedule cursor / winner-status patch in ONE
  // transaction — previously up to a dozen sequential writes, with a crash
  // in between leaving partial ticks committed.
  const { error: commitErr } = await a.rpc('commit_game_update', {
    p_game_id: gameId,
    p_generation: game.cur_generation,
    p_events: newEvents.map((e) => ({
      seq: e.seq, type: e.type, actor_id: e.actorId,
      payload: e.payload, created_at: e.createdAt,
    })),
    p_next_seq: state.seq,
    p_next_state: state,
    p_has_winner: !!state.winner,
    p_member_states: memberStates,
    p_game_patch: patch,
  });
  if (commitErr) throw new Error(`tick commit failed: ${commitErr.message}`);
  return newEvents.length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  // cron secret check (set CRON_SECRET; empty means local dev = open)
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const auth = req.headers.get('Authorization') ?? '';
    if (auth !== `Bearer ${cronSecret}`) return json({ error: 'unauthorized' }, 401);
  }

  try {
    const a = admin();
    const { data: activeGames } = await a.from('games')
      .select('id, mode, daily_ap_time, ap_interval_minutes, last_tick_at, last_heart_at, started_at, config')
      .eq('status', 'active');

    let total = 0;
    const ticked: string[] = [];
    const hearted: string[] = [];
    const failed: string[] = [];
    // per-game isolation: one bad game must not throw away the whole batch
    // (an uncaught error here 500s the request and every OTHER active game
    // silently misses its grant for that fire)
    for (const game of activeGames ?? []) {
      try {
        const due = dueForTick(game);
        if (!due.ap && !due.heart) continue;
        // last_tick_at / last_heart_at / winner status are patched inside
        // the same transaction as the events (commit_game_update)
        const n = await tickGame(game.id, due);
        if (n > 0) {
          total += n;
          ticked.push(game.id);
          if (due.heart) hearted.push(game.id);
        }
      } catch (gameErr) {
        failed.push(game.id);
        console.error(`tick: game ${game.id} failed:`, gameErr instanceof Error ? gameErr.message : gameErr);
      }
    }
    return json({ ok: true, ticked, hearted, failed, eventsAppended: total });
  } catch (e) {
    return json({ error: `tick failed: ${e instanceof Error ? e.message : 'unknown'}` }, 500);
  }
});
