import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getPlayer } from '../_shared/auth.ts';

const CONFIG_DEFAULTS = {
  seed: 0, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
};

function validateConfig(input: Record<string, unknown>): typeof CONFIG_DEFAULTS & { seed: number; bots: { difficulty: string }[] } | string {
  const c = { ...CONFIG_DEFAULTS, ...input };
  if (typeof c.seed !== 'number' || c.seed < 0 || c.seed > 2 ** 31) return 'invalid seed';
  if (typeof c.board !== 'number' || c.board < 5 || c.board > 15) return 'board must be 5-15';
  if (typeof c.startingHp !== 'number' || c.startingHp < 1 || c.startingHp > 10) return 'startingHp must be 1-10';
  if (typeof c.startingAp !== 'number' || c.startingAp < 0 || c.startingAp > 20) return 'startingAp must be 0-20';
  if (typeof c.baseRange !== 'number' || c.baseRange < 1 || c.baseRange > 6) return 'baseRange must be 1-6';
  if (typeof c.apPerDay !== 'number' || c.apPerDay < 0 || c.apPerDay > 10) return 'apPerDay must be 0-10';
  if (typeof c.upgradeCost !== 'number' || c.upgradeCost < 1 || c.upgradeCost > 10) return 'upgradeCost must be 1-10';
  if (typeof c.apIntervalMinutes !== 'number' || c.apIntervalMinutes < 0 || c.apIntervalMinutes > 1440) return 'invalid apIntervalMinutes';
  // new-rule toggles (all optional booleans; absent = off / legacy behavior)
  const boolKeys = ['apStealOnKill', 'heartGifts', 'revives', 'juryHaunt', 'heartSpawn', 'showPlayerNames'] as const;
  for (const k of boolKeys) {
    const v = (c as Record<string, unknown>)[k];
    if (v !== undefined && typeof v !== 'boolean') return `${k} must be a boolean`;
  }
  // schedule shapes (AP + hearts share the same three modes)
  const SCHEDULES = ['interval', 'timeOfDay', 'random'];
  for (const k of ['apSchedule', 'heartSchedule'] as const) {
    const v = (c as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !SCHEDULES.includes(v)) return `invalid ${k}`;
  }
  for (const k of ['apPeriodMinutes', 'heartPeriodMinutes', 'heartIntervalMinutes'] as const) {
    const v = (c as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || v < 1 || v > 1440) return `${k} must be 1-1440`;
  }
  // spawn delay allows 0 (= hearts eligible immediately)
  const hsd = (c as Record<string, unknown>).heartSpawnDelayMinutes;
  if (hsd !== undefined && (typeof hsd !== 'number' || hsd < 0 || hsd > 1440)) return 'heartSpawnDelayMinutes must be 0-1440';
  const hp = (c as Record<string, unknown>).heartPlacement;
  if (hp !== undefined && hp !== 'random' && hp !== 'smart') return 'invalid heartPlacement';
  const bots = Array.isArray(input.bots) ? input.bots : [];
  if (bots.length > 8) return 'max 8 bots';
  for (const b of bots) {
    if (!b || typeof b !== 'object' || !['easy', 'medium', 'hard'].includes((b as { difficulty: string }).difficulty))
      return 'invalid bot difficulty';
  }
  return { ...c, seed: c.seed, bots: bots as { difficulty: string }[] };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const a = admin();
    const me = await getPlayer(a, req);
    if (!me) return json({ error: 'unauthorized' }, 401);

    const body = await req.json();
    const { name, mode } = body;
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 60)
      return json({ error: 'name must be 1-60 chars' }, 400);
    if (mode !== 'play' && mode !== 'test') return json({ error: "mode must be 'play' or 'test'" }, 400);

    const config = validateConfig(body.config ?? {});
    if (typeof config === 'string') return json({ error: config }, 400);

    // bots are allowed in play mode (async lobbies with pre-filled bots)
    if (mode === 'play') {
      const bots = Array.isArray(body.config?.bots) ? body.config.bots : [];
      if (bots.length > 0) {
        for (const b of bots) {
          if (b && typeof b === 'object' && !['easy', 'medium', 'hard'].includes((b as { difficulty: string }).difficulty))
            return json({ error: 'invalid bot difficulty' }, 400);
        }
        (config as { bots?: { difficulty: string }[] }).bots = bots as { difficulty: string }[];
      }
    }

    if (config.seed === 0) config.seed = Math.floor(Math.random() * 2 ** 31);

    let dailyApTime = '09:00';
    if (mode === 'play' && typeof body.dailyApTime === 'string' && /^\d{2}:\d{2}$/.test(body.dailyApTime)) {
      dailyApTime = body.dailyApTime;
    }

    const cfgRec = config as Record<string, unknown>;

    // hearts off: delay/placement/schedule fields are meaningless
    if (cfgRec.heartSpawn !== true) {
      delete cfgRec.heartSpawnDelayMinutes;
      delete cfgRec.heartPlacement;
      delete cfgRec.heartSchedule;
    }

    // time-of-day fields ("HH:mm" + IANA tz, defaulting UTC) — AP and hearts
    // each carry their own pair; invalid values are rejected, not dropped.
    for (const [todKey, tzKey] of [['apTimeOfDay', 'apTimezone'], ['heartTimeOfDay', 'heartTimezone']]) {
      const v = cfgRec[todKey];
      if (v === undefined || v === null) { delete cfgRec[todKey]; delete cfgRec[tzKey]; continue; }
      if (typeof v !== 'string' || !/^\d{2}:\d{2}$/.test(v)) return json({ error: `${todKey} must be HH:mm` }, 400);
      const [h, m] = v.split(':').map(Number);
      if (h > 23 || m > 59) return json({ error: `${todKey} must be HH:mm` }, 400);
      const tz = cfgRec[tzKey];
      if (typeof tz === 'string' && tz) {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz });
        } catch {
          return json({ error: `invalid ${tzKey} (IANA id required)` }, 400);
        }
      } else {
        cfgRec[tzKey] = 'UTC';
      }
    }

    // tick column sync: only interval-schedule games drip on the column;
    // timeOfDay/random resolve from config alone (test keeps the 2-min floor)
    const apSchedule = (cfgRec.apSchedule as string)
      ?? (cfgRec.apTimeOfDay ? 'timeOfDay' : 'interval');
    const apIntervalMinutes = apSchedule === 'interval'
      ? (mode === 'test'
        ? ((cfgRec.apIntervalMinutes as number) > 0 ? (cfgRec.apIntervalMinutes as number) : 2)
        : ((cfgRec.apIntervalMinutes as number) > 0 ? (cfgRec.apIntervalMinutes as number) : null))
      : null;

    const { data: game, error } = await a.from('games').insert({
      name: name.trim(), mode, config, created_by: me.id,
      daily_ap_time: dailyApTime, ap_interval_minutes: apIntervalMinutes,
    }).select('id, invite_code').single();
    if (error) return json({ error: 'game creation failed' }, 500);

    const { error: memberErr } = await a.from('game_players').insert({
      game_id: game.id, player_id: me.id,
    });
    if (memberErr) return json({ error: 'membership failed' }, 500);

    return json({ gameId: game.id, inviteCode: game.invite_code });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
