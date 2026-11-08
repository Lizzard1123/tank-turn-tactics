import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifySessionJwt } from './jwt.ts';

export interface AuthedPlayer { id: string; name: string }

/**
 * Resolve the player from a signed session JWT (gateway-verified).
 * The sessions table is the revocation list: a valid signature with a
 * missing/expired sessions row is rejected.
 */
export async function getPlayer(admin: SupabaseClient, req: Request): Promise<AuthedPlayer | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const playerId = await verifySessionJwt(token);
  if (!playerId) return null;

  const { data: session } = await admin.from('sessions')
    .select('expires_at').eq('token', token).single();
  if (!session || new Date(session.expires_at) < new Date()) return null;

  const { data: player } = await admin.from('players')
    .select('id, name').eq('id', playerId).single();
  return player ?? null;
}
