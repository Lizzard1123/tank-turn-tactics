export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  // DELETE preflights from the browser (game delete) — without a methods
  // header the preflight fails and every non-GET/POST call dies with
  // "Failed to fetch".
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
