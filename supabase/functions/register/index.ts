import { hashSync } from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';
import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { signSessionJwt } from '../_shared/jwt.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const { name, password } = await req.json();
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 24)
      return json({ error: 'name must be 2-24 chars' }, 400);
    if (typeof password !== 'string' || password.length < 8)
      return json({ error: 'password must be 8+ chars' }, 400);

    const clean = name.trim();
    const hash = hashSync(password);
    const { data, error } = await admin()
      .from('players').insert({ name: clean, password_hash: hash })
      .select('id, name').single();
    if (error) return json({ error: 'name taken' }, 409);

    const token = await signSessionJwt(data.id);
    const { error: sessErr } = await admin().from('sessions').insert({
      token, player_id: data.id,
      expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
    });
    if (sessErr) return json({ error: 'session creation failed' }, 500);
    return json({ token, player: data });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});
