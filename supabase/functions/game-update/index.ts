import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getPlayer } from '../_shared/auth.ts';

// Creator-only config update while the game is still in the lobby.
// Both test and play mode lobbies can tweak knobs before starting.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const a = admin();
    const me = await getPlayer(a, req);
    if (!me) return json({ error: 'unauthorized' }, 401);

    const { gameId, config } = await req.json();
    if (!gameId || typeof config !== 'object' || config === null)
      return json({ error: 'gameId and config required' }, 400);

    const { data: game } = await a.from('games').select('mode, status, created_by, config, daily_ap_time').eq('id', gameId).single();
    if (!game) return json({ error: 'game not found' }, 404);
    if (game.created_by !== me.id) return json({ error: 'only the host can update config' }, 403);
    if (game.status !== 'lobby') return json({ error: 'game already started' }, 409);

    const cur = game.config as Record<string, unknown>;
    const next = { ...cur, ...config, seed: cur.seed, bots: config.bots ?? cur.bots };

    if (typeof next.board !== 'number' || next.board < 5 || next.board > 15) return json({ error: 'board must be 5-15' }, 400);
    if (typeof next.startingHp !== 'number' || next.startingHp < 1 || next.startingHp > 10) return json({ error: 'startingHp must be 1-10' }, 400);
    if (typeof next.startingAp !== 'number' || next.startingAp < 0 || next.startingAp > 20) return json({ error: 'startingAp must be 0-20' }, 400);
    if (typeof next.baseRange !== 'number' || next.baseRange < 1 || next.baseRange > 6) return json({ error: 'baseRange must be 1-6' }, 400);
    if (typeof next.apPerDay !== 'number' || next.apPerDay < 0 || next.apPerDay > 10) return json({ error: 'apPerDay must be 0-10' }, 400);
    if (typeof next.upgradeCost !== 'number' || next.upgradeCost < 1 || next.upgradeCost > 10) return json({ error: 'upgradeCost must be 1-10' }, 400);
    if (typeof next.apIntervalMinutes !== 'number' || next.apIntervalMinutes < 0 || next.apIntervalMinutes > 1440) return json({ error: 'invalid apIntervalMinutes' }, 400);
    for (const k of ['heartIntervalMinutes', 'apPeriodMinutes', 'heartPeriodMinutes']) {
      const v = (next as Record<string, unknown>)[k];
      if (v === undefined) continue; // the schedule branch enforces required-ness
      if (typeof v !== 'number' || v < 1 || v > 1440) return json({ error: `${k} must be 1-1440` }, 400);
    }
    // spawn delay allows 0 (= hearts eligible immediately)
    {
      const v = (next as Record<string, unknown>).heartSpawnDelayMinutes;
      if (v !== undefined && (typeof v !== 'number' || v < 0 || v > 1440))
        return json({ error: 'heartSpawnDelayMinutes must be 0-1440' }, 400);
    }

    // Schedule groups: AP and hearts each have one active schedule shape
    // (interval | timeOfDay | random) with mutually exclusive fields — a
    // patch switching shapes deletes the fields of the abandoned one.
    const SCHEDULES = ['interval', 'timeOfDay', 'random'];
    const patchRec = config as Record<string, unknown>;
    const nextRec = next as Record<string, unknown>;

    // new-rule toggles: booleans only (type error if a patch sends garbage;
    // fields the patch omits keep their current value)
    for (const k of ['apStealOnKill', 'heartGifts', 'revives', 'juryHaunt', 'heartSpawn', 'showPlayerNames']) {
      const v = patchRec[k];
      if (v === undefined) continue;
      if (typeof v !== 'boolean') return json({ error: `${k} must be a boolean` }, 400);
      nextRec[k] = v;
    }

    const pick = (key: string): unknown => (key in patchRec ? patchRec[key] : nextRec[key]);

    function resolveSchedule(group: 'ap' | 'heart'): string {
      const schedKey = group === 'ap' ? 'apSchedule' : 'heartSchedule';
      const patchSched = patchRec[schedKey];
      if (patchSched !== undefined) {
        if (typeof patchSched !== 'string' || !SCHEDULES.includes(patchSched))
          throw new Error(`invalid ${schedKey}`);
        nextRec[schedKey] = patchSched;
        return patchSched;
      }
      if (typeof nextRec[schedKey] === 'string' && SCHEDULES.includes(nextRec[schedKey] as string))
        return nextRec[schedKey] as string;
      // legacy: any time-of-day field (patch or current) means timeOfDay
      const todKey = group === 'ap' ? 'apTimeOfDay' : 'heartTimeOfDay';
      return (patchRec[todKey] ?? nextRec[todKey]) ? 'timeOfDay' : 'interval';
    }

    function applySchedule(group: 'ap' | 'heart'): void {
      const schedKey = group === 'ap' ? 'apSchedule' : 'heartSchedule';
      const todKey = group === 'ap' ? 'apTimeOfDay' : 'heartTimeOfDay';
      const tzKey = group === 'ap' ? 'apTimezone' : 'heartTimezone';
      const intervalKey = group === 'ap' ? 'apIntervalMinutes' : 'heartIntervalMinutes';
      const periodKey = group === 'ap' ? 'apPeriodMinutes' : 'heartPeriodMinutes';
      const schedule = resolveSchedule(group);

      // hearts: schedule fields are meaningless while spawning is off
      if (group === 'heart' && !nextRec.heartSpawn) {
        for (const k of [schedKey, todKey, tzKey, intervalKey, periodKey]) delete nextRec[k];
        delete nextRec.heartSpawnDelayMinutes;
        delete nextRec.heartPlacement;
        return;
      }

      if (schedule === 'timeOfDay') {
        const tod = pick(todKey);
        if (tod !== undefined && tod !== null) {
          if (typeof tod !== 'string' || !/^\d{2}:\d{2}$/.test(tod)) throw new Error(`${todKey} must be HH:mm`);
          const [h, m] = tod.split(':').map(Number);
          if (h > 23 || m > 59) throw new Error(`${todKey} must be HH:mm`);
          nextRec[todKey] = tod;
          const tz = pick(tzKey);
          if (tz !== undefined && tz !== null) {
            if (typeof tz !== 'string' || !tz) throw new Error(`invalid ${tzKey} (IANA id required)`);
            try {
              new Intl.DateTimeFormat('en-US', { timeZone: tz });
              nextRec[tzKey] = tz;
            } catch {
              throw new Error(`invalid ${tzKey} (IANA id required)`);
            }
          } else {
            nextRec[tzKey] = 'UTC';
          }
        } else {
          // no wall-clock configured: tick falls back to the daily_ap_time
          // column (AP only); drop any stale tz
          delete nextRec[todKey];
          delete nextRec[tzKey];
        }
        delete nextRec[periodKey];
      } else if (schedule === 'random') {
        const period = pick(periodKey);
        if (typeof period !== 'number' || period < 1 || period > 1440)
          throw new Error(`${periodKey} must be 1-1440`);
        nextRec[periodKey] = period;
        delete nextRec[todKey];
        delete nextRec[tzKey];
      } else {
        // interval: the interval number is validated by the shared check above
        delete nextRec[todKey];
        delete nextRec[tzKey];
        delete nextRec[periodKey];
      }
    }

    try {
      applySchedule('ap');
      applySchedule('heart');
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'invalid schedule' }, 400);
    }

    const hp = patchRec.heartPlacement;
    if (hp !== undefined) {
      if (hp !== 'random' && hp !== 'smart') return json({ error: 'invalid heartPlacement' }, 400);
      nextRec.heartPlacement = hp;
    }
    if (nextRec.heartSpawn !== true) delete nextRec.heartPlacement;

    const bots = Array.isArray(next.bots) ? next.bots : [];
    if (bots.length > 8) return json({ error: 'max 8 bots' }, 400);
    for (const b of bots) {
      if (!b || typeof b !== 'object' || !['easy', 'medium', 'hard'].includes((b as { difficulty: string }).difficulty))
        return json({ error: 'invalid bot difficulty' }, 400);
    }

    // Keep the tick column in sync: tick reads ap_interval_minutes for the
    // interval schedule only; timeOfDay/random resolve from config alone.
    const effApSchedule = (next.apSchedule && ['interval', 'timeOfDay', 'random'].includes(next.apSchedule))
      ? next.apSchedule
      : (next.apTimeOfDay ? 'timeOfDay' : 'interval');
    const intervalCol = effApSchedule === 'interval'
      ? (next.apIntervalMinutes > 0 ? next.apIntervalMinutes : null)
      : null;

    const { error } = await a.from('games').update({ config: next, ap_interval_minutes: intervalCol }).eq('id', gameId);
    if (error) return json({ error: 'update failed' }, 500);
    return json({ ok: true, config: next });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
