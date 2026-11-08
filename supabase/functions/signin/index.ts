import bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';
import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const { name, password } = await req.json();
    if (typeof name !== 'string' || typeof password !== 'string')
      return json({ error: 'name and password required' }, 400);

    const { data: player } = await admin()
      .from('players').select('id, name, password_hash').eq('name', name.trim()).single();
    if (!player || !(await bcrypt.compare(password, player.password_hash)))
      return json({ error: 'invalid name or password' }, 401);

    const token = crypto.randomUUID() + crypto.randomUUID();
    await admin().from('sessions').insert({
      token, player_id: player.id,
      expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
    });
    return json({ token, player: { id: player.id, name: player.name } });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
