-- Supabase Auth migration: players are auth.users now.
-- The client signs up with a synthetic email derived from the player name;
-- this trigger mirrors every auth.users row into players with the SAME id,
-- so auth.uid() in RLS policies resolves to the player id directly.

create or replace function public.handle_new_player()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_name text;
begin
  new_name := coalesce(new.raw_user_meta_data ->> 'name', 'player-' || left(new.id::text, 8));
  insert into players (id, name)
  values (new.id, new_name);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_player();

-- Name availability pre-check for the signup form (anon has no SELECT on
-- players, so the check runs as the definer).
create or replace function public.player_name_taken(p_name text)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from players where lower(name) = lower(p_name));
$$;

grant execute on function public.player_name_taken(text) to anon, authenticated;

-- The custom session table is obsolete: GoTrue issues and verifies tokens.
-- Passwords live in auth.users now, so the custom-auth column goes too.
drop table if exists sessions;
alter table players drop column if exists password_hash;
