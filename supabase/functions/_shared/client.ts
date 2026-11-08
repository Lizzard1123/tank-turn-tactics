import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

let cached: SupabaseClient | null = null;

export function admin(): SupabaseClient {
  if (!cached) {
    cached = createClient(
      Deno.env.get('SUPABASE_URL') ?? 'http://localhost:54321',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { persistSession: false } },
    );
  }
  return cached;
}
