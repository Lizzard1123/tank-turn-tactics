import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { applyEvent, planBotAction, heartSpawnPos, mulberry32, hashSeed, type GameEvent, type GameState } from '../_shared/engine.ts';

// AP + heart scheduling (both modes, one mechanism, three schedule shapes):
//   - game-start seeds last_tick_at (play: now, test: null) and started_at
//     (the anchor for 'random' periods).
//   - interval: due once the interval has elapsed since the last grant
//     (the COLUMN, which game-update keeps in sync with config).
//   - timeOfDay: due in the first invocation at/after the configured local
//     wall-clock time that is on a LATER local day than the last grant —
//     grants at most once/day; downtime catches up exactly once.
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

function timeOfDayDue(spec: { timeOfDay?: string; timezone?: string; lastAt: string | null }): boolean {
  const tod = spec.timeOfDay ?? '09:00';
  const [h, m] = tod.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;

  const now = new Date();
  const tz = spec.timezone;
  if (tz) {
    const nowP = tzParts(now, tz);
    if (!nowP) return false;
    if (nowP.hh * 60 + nowP.mi < h * 60 + m) return false; // before today's slot
    if (!spec.lastAt) return true;                          // never granted
    const lastP = tzParts(new Date(spec.lastAt), tz);
    if (!lastP) return false;
    // due only if the last grant was on a PREVIOUS local day
    return Date.UTC(lastP.y, lastP.mo, lastP.day) < Date.UTC(nowP.y, nowP.mo, nowP.day);
  }
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (utcMinutes < h * 60 + m) return false;
  if (!spec.lastAt) return true;
  const last = new Date(spec.lastAt);
  const lastDay = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
  const todayDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return lastDay < todayDay;
}

function intervalDue(spec: { intervalMinutes?: number; lastAt: string | null; fallbackMinutes: number }): boolean {
  const interval = (spec.intervalMinutes && spec.intervalMinutes > 0 ? spec.intervalMinutes : spec.fallbackMinutes) * 60_000;
  if (!spec.lastAt) return true;
  return Date.now() - new Date(spec.lastAt).getTime() >= interval;
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

async function tickGame(gameId: string, due: { ap: boolean; heart: boolean }): Promise<number> {
  const a = admin();
  const { data: game } = await a.from('games').select('*').eq('id', gameId).single();
  if (!game || game.status !== 'active') return 0;

  const { data: snap } = await a.from('game_state').select('seq, state').eq('game_id', gameId).single();
  if (!snap) return 0;
  let state: GameState = snap.state;

  let appended = 0;

  // 1. AP drip (only when the AP schedule is due)
  if (due.ap) {
    const apGained = (state.config as { apPerDay?: number }).apPerDay ?? 1;
    const drip: GameEvent = {
      seq: state.seq + 1, type: 'daily_tick', actorId: 'system',
      createdAt: new Date().toISOString(), payload: { apGained, elapsedMinutes: game.mode === 'test' ? (game.ap_interval_minutes ?? 2) : 1440 },
    };
    state = applyEvent(state, drip);
    await a.from('events').insert({
      game_id: gameId, generation: game.cur_generation, seq: drip.seq,
      type: drip.type, actor_id: drip.actorId, payload: drip.payload, created_at: drip.createdAt,
    });
    appended++;
  }

  // 2. heart spawn (only when the heart schedule is due); placed BEFORE the
  // bot pass so bots can immediately react and claim it
  if (due.heart) {
    const pos = heartSpawnPos(state);
    if (pos) {
      const spawn: GameEvent = {
        seq: state.seq + 1, type: 'heart_spawn', actorId: 'system',
        createdAt: new Date().toISOString(),
        payload: { x: pos.x, y: pos.y, placement: (state.config as { heartPlacement?: string }).heartPlacement ?? 'random' },
      };
      state = applyEvent(state, spawn);
      await a.from('events').insert({
        game_id: gameId, generation: game.cur_generation, seq: spawn.seq,
        type: spawn.type, actor_id: spawn.actorId, payload: spawn.payload, created_at: spawn.createdAt,
      });
      appended++;
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
      await a.from('events').insert({
        game_id: gameId, generation: game.cur_generation, seq: ev.seq,
        type: ev.type, actor_id: ev.actorId, payload: ev.payload, created_at: ev.createdAt,
      });
      acted++;
      appended++;
    }
    if (acted === 0) break;
  }

  await a.from('game_state').upsert({
    game_id: gameId, seq: state.seq, state, updated_at: new Date().toISOString(),
  });

  if (state.winner) {
    await a.from('games').update({ status: 'finished' }).eq('id', gameId);
  }
  return appended;
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
        const n = await tickGame(game.id, due);
        if (n > 0) {
          const patch: Record<string, string> = {};
          if (due.ap) patch.last_tick_at = new Date().toISOString();
          if (due.heart) patch.last_heart_at = new Date().toISOString();
          await a.from('games').update(patch).eq('id', game.id);
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
