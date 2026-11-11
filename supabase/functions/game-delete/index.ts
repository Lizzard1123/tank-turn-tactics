import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getPlayer } from '../_shared/auth.ts';

// Host-only game deletion (test games the host created) / ending (active
// play games). Marks the game finished; the row survives as a finished
// tombstone so players keep their recap. Other players' memberships are
// left alone (cascade is not used so the game row itself survives).
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
    // host controls their game: test games are disposable in any status,
    // play games can be deleted in the lobby or ENDED once active (async
    // public daily games included) — ending finishes it for everyone
    if (game.mode !== 'test' && game.status !== 'lobby' && game.status !== 'active')
      return json({ error: 'game cannot be deleted or ended' }, 409);

    await a.from('games').update({ status: 'finished' }).eq('id', gameId);
    return json({ ok: true });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
