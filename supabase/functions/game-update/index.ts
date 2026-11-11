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

    // AP schedule: either interval (minutes between grants) or time-of-day
    // ("HH:mm" wall-clock in an IANA timezone). Exactly one is active.
    let apTimeOfDay: string | null = null;
    let apTimezone: string | null = null;
    if (typeof next.apTimeOfDay === 'string' && /^\d{2}:\d{2}$/.test(next.apTimeOfDay)) {
      const [h, m] = next.apTimeOfDay.split(':').map(Number);
      if (h > 23 || m > 59) return json({ error: 'apTimeOfDay must be HH:mm' }, 400);
      apTimeOfDay = next.apTimeOfDay;
      if (typeof next.apTimezone === 'string' && next.apTimezone) {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: next.apTimezone });
          apTimezone = next.apTimezone;
        } catch {
          return json({ error: 'invalid apTimezone (IANA id required)' }, 400);
        }
      }
      if (apTimeOfDay && !apTimezone) apTimezone = 'UTC';
    } else if (next.apTimeOfDay != null) {
      return json({ error: 'apTimeOfDay must be HH:mm' }, 400);
    }
    if (apTimeOfDay) {
      next.apTimeOfDay = apTimeOfDay;
      next.apTimezone = apTimezone;
    } else {
      delete next.apTimeOfDay;
      delete next.apTimezone;
    }

    const bots = Array.isArray(next.bots) ? next.bots : [];
    if (bots.length > 8) return json({ error: 'max 8 bots' }, 400);
    for (const b of bots) {
      if (!b || typeof b !== 'object' || !['easy', 'medium', 'hard'].includes((b as { difficulty: string }).difficulty))
        return json({ error: 'invalid bot difficulty' }, 400);
    }

    // Keep the tick column in sync: tick reads ap_interval_minutes, so a
    // config-only edit never took effect for the drip cadence.
    const intervalCol = apTimeOfDay
      ? null // time-of-day games don't drip on an interval
      : (next.apIntervalMinutes > 0 ? next.apIntervalMinutes : null);

    const { error } = await a.from('games').update({ config: next, ap_interval_minutes: intervalCol }).eq('id', gameId);
    if (error) return json({ error: 'update failed' }, 500);
    return json({ ok: true, config: next });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
