-- game_players has RLS enabled with no policies (0002). That made every
-- policy that checks membership via a game_players subquery evaluate empty
-- for everyone -- realtime delivery has been inert in prod since launch
-- (the old events SELECT policy had the same inert subquery), and the
-- client's 4s poller has been doing all the work. Let members read their
-- own membership row so the activity policy's subquery resolves and
-- postgres_changes delivers again. Own row only: no other members' rows,
-- no game data (player_id/game_id/joined_at -- nothing the app doesn't
-- already show them).
-- idempotent: this was also applied out-of-band via the Management API, so a
-- replay by the Supabase GitHub integration must not fail on 42710.
drop policy if exists game_players_read_own on game_players;
create policy game_players_read_own on game_players
  for select to authenticated
  using (player_id = auth.uid());
