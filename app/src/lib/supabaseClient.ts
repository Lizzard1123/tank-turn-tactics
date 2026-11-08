import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const BASE = SUPABASE_URL ?? 'http://127.0.0.1:54321';
const KEY = ANON_KEY ?? 'anon-placeholder-key-not-used-by-edge-functions';

// Full client: auth (GoTrue), storage, and realtime (postgres_changes on the
// events table). Reads/writes go through the edge functions; storage and the
// players table are called directly with the session supabase-js attaches
// automatically.
export const supabase = createClient(BASE, KEY, {
  realtime: { params: { eventsPerSecond: 5 } },
});
