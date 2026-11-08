alter table players   enable row level security;
alter table sessions  enable row level security;
alter table games     enable row level security;
alter table game_players enable row level security;
alter table events    enable row level security;
alter table game_state enable row level security;

-- No policies for anon/authenticated on players/sessions/games/game_players/
-- game_state: default deny. Clients never query these tables directly; they
-- call Edge Functions (service role bypasses RLS). Events/gState reads also
-- go through the game-get function.

-- Explicit deny-in-spirit for events writes (service role bypasses anyway):
create policy no_client_event_writes on events
  for insert to anon, authenticated with check (false);
