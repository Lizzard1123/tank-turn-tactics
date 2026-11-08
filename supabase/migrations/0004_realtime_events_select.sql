-- Realtime support: postgres_changes subscribers only receive rows they can
-- SELECT under RLS. Game members (players in the game, including test-mode
-- hosts) may read the event log of their own games. Writes remain denied.
create policy game_members_read_events on events
  for select to anon, authenticated
  using (
    game_id in (
      select gp.game_id from game_players gp where gp.player_id = auth.uid()
      union
      select g.id from games g
        where g.created_by = auth.uid() and g.mode = 'test'
    )
  );
