import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getPlayer } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ error: 'GET required' }, 405);
  try {
    const a = admin();
    const me = await getPlayer(a, req);
    if (!me) return json({ error: 'unauthorized' }, 401);

    const { data: memberships } = await a.from('game_players')
      .select('game_id').eq('player_id', me.id);
    const ids = (memberships ?? []).map(m => m.game_id);
    if (ids.length === 0) return json({ games: [] });

    const { data: games } = await a.from('games')
      .select('id, name, mode, status, created_at').in('id', ids).order('created_at', { ascending: false });

    const { data: counts } = await a.from('game_players')
      .select('game_id').in('game_id', ids);
    const countByGame: Record<string, number> = {};
    for (const c of counts ?? []) countByGame[c.game_id] = (countByGame[c.game_id] ?? 0) + 1;

    return json({
      games: (games ?? []).map(g => ({ ...g, playerCount: countByGame[g.id] ?? 0 })),
    });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
