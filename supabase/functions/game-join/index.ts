import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getPlayer } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const a = admin();
    const me = await getPlayer(a, req);
    if (!me) return json({ error: 'unauthorized' }, 401);

    const { inviteCode } = await req.json();
    if (typeof inviteCode !== 'string' || inviteCode.length < 4)
      return json({ error: 'invalid invite code' }, 400);

    const { data: game } = await a.from('games')
      .select('id, status, mode, created_by').eq('invite_code', inviteCode).single();
    if (!game) return json({ error: 'game not found' }, 404);
    if (game.mode === 'test') return json({ error: 'test games are private' }, 403);
    if (game.status !== 'lobby') return json({ error: 'game already started' }, 409);

    const { error } = await a.from('game_players').insert({
      game_id: game.id, player_id: me.id,
    });
    if (error) {
      if (error.code === '23505') return json({ gameId: game.id }); // already a member
      return json({ error: 'join failed' }, 500);
    }
    return json({ gameId: game.id });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
