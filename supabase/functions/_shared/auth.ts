import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface AuthedPlayer { id: string; name: string }

export async function getPlayer(admin: SupabaseClient, req: Request): Promise<AuthedPlayer | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data } = await admin
    .from('sessions')
    .select('expires_at, player_id, players(id, name)')
    .eq('token', token)
    .single();
  if (!data || new Date(data.expires_at) < new Date()) return null;
  const players = data.players as unknown as { id: string; name: string } | null;
  if (!players) return null;
  return { id: players.id, name: players.name };
}
