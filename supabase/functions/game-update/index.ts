import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getPlayer } from '../_shared/auth.ts';

// Creator-only config update while the game is still in the lobby.
// Test-mode lobbies tweak knobs here; play-mode games keep their create-time config.
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

    const { data: game } = await a.from('games').select('mode, status, created_by, config').eq('id', gameId).single();
    if (!game) return json({ error: 'game not found' }, 404);
    if (game.created_by !== me.id) return json({ error: 'only the host can update config' }, 403);
    if (game.status !== 'lobby') return json({ error: 'game already started' }, 409);
    if (game.mode !== 'test') return json({ error: 'config edits only in test mode' }, 403);

    const cur = game.config as Record<string, unknown>;
    const next = { ...cur, ...config, seed: cur.seed, bots: config.bots ?? cur.bots };

    if (typeof next.board !== 'number' || next.board < 5 || next.board > 15) return json({ error: 'board must be 5-15' }, 400);
    if (typeof next.startingHp !== 'number' || next.startingHp < 1 || next.startingHp > 10) return json({ error: 'startingHp must be 1-10' }, 400);
    if (typeof next.startingAp !== 'number' || next.startingAp < 0 || next.startingAp > 20) return json({ error: 'startingAp must be 0-20' }, 400);
    if (typeof next.baseRange !== 'number' || next.baseRange < 1 || next.baseRange > 6) return json({ error: 'baseRange must be 1-6' }, 400);
    if (typeof next.apPerDay !== 'number' || next.apPerDay < 0 || next.apPerDay > 10) return json({ error: 'apPerDay must be 0-10' }, 400);
    if (typeof next.upgradeCost !== 'number' || next.upgradeCost < 1 || next.upgradeCost > 10) return json({ error: 'upgradeCost must be 1-10' }, 400);
    if (typeof next.apIntervalMinutes !== 'number' || next.apIntervalMinutes < 0 || next.apIntervalMinutes > 1440) return json({ error: 'invalid apIntervalMinutes' }, 400);
    const bots = Array.isArray(next.bots) ? next.bots : [];
    if (bots.length > 8) return json({ error: 'max 8 bots' }, 400);
    for (const b of bots) {
      if (!b || typeof b !== 'object' || !['easy', 'medium', 'hard'].includes((b as { difficulty: string }).difficulty))
        return json({ error: 'invalid bot difficulty' }, 400);
    }

    const { error } = await a.from('games').update({ config: next }).eq('id', gameId);
    if (error) return json({ error: 'update failed' }, 500);
    return json({ ok: true, config: next });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
