import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { applyEvent, planBotAction, type GameEvent, type GameState } from '../_shared/engine.ts';

// AP distribution flow (both modes, one mechanism):
//   - game-start seeds last_tick_at = null; interval games then fire their
//     first tick on the first invocation; time-of-day games fire at their slot.
//   - interval games (test): due once ap_interval_minutes has elapsed since
//     last_tick_at (the COLUMN, which game-update keeps in sync with
//     config.apIntervalMinutes — the knob only worked if the column moved).
//   - time-of-day games (play, or any game with config.apTimeOfDay): due in the
//     first invocation at/after the configured local wall-clock time
//     (config.apTimeOfDay in config.apTimezone) that is on a LATER local day
//     than last_tick_at — so a slot grants at most once/day and downtime
//     catches up exactly once, never once per missed hour.
//   - each tick appends a daily_tick event granting config.apPerDay AP to every
//     alive player (engine reducer, daily_tick branch); last_tick_at persists
//     below after tickGame returns. The cron schedule must fire at least every
//     minute for short intervals to work (0003 moved hourly → * * * * *).
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

function timeOfDayDue(game: {
  apTimeOfDay?: string; apTimezone?: string; daily_ap_time: string; last_tick_at: string | null;
}): boolean {
  // config schedule wins; fall back to the daily_ap_time column (UTC).
  const tod = game.apTimeOfDay ?? game.daily_ap_time ?? '09:00';
  const [h, m] = tod.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;

  const now = new Date();
  // Without a timezone, work in UTC wall-clock (the column's original meaning).
  const tz = game.apTimezone;
  if (tz) {
    const nowP = tzParts(now, tz);
    if (!nowP) return false;
    if (nowP.hh * 60 + nowP.mi < h * 60 + m) return false; // before today's slot
    if (!game.last_tick_at) return true;                    // never ticked
    const lastP = tzParts(new Date(game.last_tick_at), tz);
    if (!lastP) return false;
    // due only if the last grant was on a PREVIOUS local day
    return Date.UTC(lastP.y, lastP.mo, lastP.day) < Date.UTC(nowP.y, nowP.mo, nowP.day);
  }
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (utcMinutes < h * 60 + m) return false;
  if (!game.last_tick_at) return true;
  const last = new Date(game.last_tick_at);
  const lastDay = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
  const todayDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return lastDay < todayDay;
}

function dueForTick(game: {
  mode: string; daily_ap_time: string; ap_interval_minutes: number | null; last_tick_at: string | null;
  config: { apIntervalMinutes?: number; apTimeOfDay?: string; apTimezone?: string };
}): boolean {
  // Time-of-day schedule: play mode always, or any game that configured
  // config.apTimeOfDay (one shared mechanism, not two tick paths).
  if (game.mode === 'play' || game.config?.apTimeOfDay) {
    return timeOfDayDue({
      apTimeOfDay: game.config?.apTimeOfDay,
      apTimezone: game.config?.apTimezone,
      daily_ap_time: game.daily_ap_time,
      last_tick_at: game.last_tick_at,
    });
  }
  // Interval schedule: due once the interval has elapsed (null last_tick_at =
  // first tick fires immediately). Prefer the synced column; fall back to config.
  const interval = (game.ap_interval_minutes ?? game.config?.apIntervalMinutes ?? 2) * 60_000;
  if (!game.last_tick_at) return true;
  return Date.now() - new Date(game.last_tick_at).getTime() >= interval;
}

async function tickGame(gameId: string): Promise<number> {
  const a = admin();
  const { data: game } = await a.from('games').select('*').eq('id', gameId).single();
  if (!game || game.status !== 'active') return 0;

  const { data: snap } = await a.from('game_state').select('seq, state').eq('game_id', gameId).single();
  if (!snap) return 0;
  let state: GameState = snap.state;

  let appended = 0;

  // 1. AP drip (only if not already ticked for this slot — checked by caller)
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

  // 2. bot pass: each bot plans one action (loop until no bot wants to act)
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
      .select('id, mode, daily_ap_time, ap_interval_minutes, last_tick_at, config')
      .eq('status', 'active');

    let total = 0;
    const ticked: string[] = [];
    for (const game of activeGames ?? []) {
      if (dueForTick(game)) {
        const n = await tickGame(game.id);
        if (n > 0) {
          await a.from('games').update({ last_tick_at: new Date().toISOString() }).eq('id', game.id);
          total += n;
          ticked.push(game.id);
        }
      }
    }
    return json({ ok: true, ticked, eventsAppended: total });
  } catch (e) {
    return json({ error: `tick failed: ${e instanceof Error ? e.message : 'unknown'}` }, 500);
  }
});
