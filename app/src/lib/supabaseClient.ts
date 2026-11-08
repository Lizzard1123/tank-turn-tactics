import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const BASE = SUPABASE_URL ?? 'http://127.0.0.1:54321';
const KEY = ANON_KEY ?? 'anon-placeholder-key-not-used-by-edge-functions';

// Realtime client (postgres_changes on the events table). Reads go through
// the edge functions; this client only listens.
export const supabase = createClient(BASE, KEY, {
  realtime: { params: { eventsPerSecond: 5 } },
});

// Storage calls need OUR session JWT (sub = player id) so storage RLS
// policies resolve auth.uid() to the uploader. supabase-js v2 has no
// setAuth for custom tokens, so build a per-token client with the header
// baked in (memoized — one client per token per page load).
const storageClients = new Map<string, SupabaseClient>();

export function getStorageClient(token: string): SupabaseClient {
  let client = storageClients.get(token);
  if (!client) {
    client = createClient(BASE, KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    storageClients.set(token, client);
  }
  return client;
}
