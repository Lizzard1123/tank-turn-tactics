import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getPlayer } from '../_shared/auth.ts';

// Host-only game deletion (test games the host created).
// Marks the game finished and drops its rows so the host can remove a test
// game they created. Other players' memberships are left alone (cascade is
// not used so the game row itself survives as a finished tombstone).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'DELETE') return json({ error: 'DELETE required' }, 405);
  try {
    const a = admin();
    const me = await getPlayer(a, req);
    if (!me) return json({ error: 'unauthorized' }, 401);

    const { gameId } = await req.json();
    if (!gameId || typeof gameId !== 'string')
      return json({ error: 'gameId required' }, 400);

    const { data: game } = await a.from('games')
      .select('id, mode, status, created_by').eq('id', gameId).single();
    if (!game) return json({ error: 'game not found' }, 404);
    if (game.created_by !== me.id) return json({ error: 'only the host can delete this game' }, 403);
    // play games are protected once started; test games are disposable in any status
    if (game.mode !== 'test' && game.status !== 'lobby')
      return json({ error: 'only lobby play games (or any test game) can be deleted' }, 409);

    await a.from('games').update({ status: 'finished' }).eq('id', gameId);
    return json({ ok: true });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
