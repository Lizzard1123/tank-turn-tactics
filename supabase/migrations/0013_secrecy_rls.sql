-- Secrecy hardening:
--   1. events: members must not read raw event rows. The old SELECT policy
--      existed only so realtime postgres_changes could push INSERTs as a
--      refetch trigger, but it also let any member read the FULL event log
--      (actor ids, payloads) directly over PostgREST — attack attribution
--      the game deliberately hides ("guess who shot you unless it's the last
--      hit"). The client never consumed the realtime payload, only its
--      existence, so the trigger signal moves to a minimal `activity` table.
--   2. activity: one row per game (game_id, last seq), readable by members
--      only. Subscribed for realtime INSERT/UPDATE as the refetch trigger.
drop policy if exists game_members_read_events on events;
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then
    alter publication supabase_realtime drop table events;
  end if;
end $$;

create table if not exists activity (
  game_id   uuid primary key references games(id) on delete cascade,
  seq       bigint not null,
  updated_at timestamptz not null default now()
);
alter table activity enable row level security;
drop policy if exists activity_members_read on activity;
create policy activity_members_read on activity
  for select to anon, authenticated
  using (
    game_id in (
      select gp.game_id from game_players gp where gp.player_id = auth.uid()
      union
      select g.id from games g
        where g.created_by = auth.uid() and g.mode = 'test'
    )
  );
-- belt and braces: RLS with no write policies already denies client writes,
-- but make the intent explicit (the service role keeps its own grants).
revoke insert, update, delete on activity from anon, authenticated;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity'
  ) then
    alter publication supabase_realtime add table activity;
  end if;
end $$;
