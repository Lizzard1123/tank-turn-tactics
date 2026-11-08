-- Realtime was announced in the client (postgres_changes on `events`) but the
-- table was never added to the supabase_realtime publication, so subscribers
-- received nothing and every update waited on an explicit refetch.
-- Idempotent: only add when not already a member.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table events;
  end if;
end $$;
