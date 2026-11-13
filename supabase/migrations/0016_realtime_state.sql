-- Per-member realtime state + single-round-trip reads.
--
-- Phase 1 (reads): load_game_detail folds the 8-9 sequential PostgREST
-- reads of game-get (and the reads of action and tick) into ONE RPC that
-- returns the game row, snapshot, tail, canonical history, fork points,
-- members, membership flag and the avatars/names maps. Only service_role
-- may execute it: it exposes raw event rows (full attack attribution).
--
-- Phase 2 (writes): player_activity holds one row per member carrying that
-- member's OWN pre-scrubbed view of the game (state, masked new events, a
-- small game-field patch). Every commit upserts all members' rows in the
-- same transaction as the events; the client subscribes with
-- postgres_changes (RLS limits delivery to player_id = auth.uid()) and
-- applies the row directly — no refetch. The 4s poller stays as reconciler.
--
-- append_action_event (0015) is intentionally kept: the previously deployed
-- action function still calls it, and migrations land (via the GitHub
-- integration) BEFORE the edge functions are manually redeployed. A later
-- migration drops it once the new commit_game_update callers are live.

create table if not exists player_activity (
  game_id    uuid not null references games(id) on delete cascade,
  player_id  uuid not null,
  seq        bigint not null,
  state      jsonb not null,
  events     jsonb not null default '[]'::jsonb,
  game_patch jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

alter table player_activity enable row level security;

-- Realtime delivery: postgres_changes applies this policy with the
-- subscriber's JWT, so each member is pushed only their own row. No
-- subquery (unlike `activity`) — a direct comparison cannot be un-inerted
-- by another table's RLS.
drop policy if exists player_activity_read_own on player_activity;
create policy player_activity_read_own on player_activity
  for select to authenticated
  using (player_id = auth.uid());

-- Rows are written only by commit_game_update (service_role bypasses RLS);
-- clients get SELECT only.
revoke insert, update, delete on player_activity from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'player_activity'
  ) then
    alter publication supabase_realtime add table player_activity;
  end if;
end
$$;

-- ---------------------------------------------------------------- reads ---

create or replace function load_game_detail(
  p_game_id  uuid,
  p_player_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  g games;
  uuid_re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  select * into g from games where id = p_game_id;
  if not found then
    return jsonb_build_object(
      'player', (select jsonb_build_object('id', pl.id, 'name', pl.name)
                 from players pl where pl.id = p_player_id),
      'game', null);
  end if;

  return jsonb_build_object(
    'player', (select jsonb_build_object('id', pl.id, 'name', pl.name)
               from players pl where pl.id = p_player_id),
    'game', to_jsonb(g),
    -- lobby members: exactly the columns PostgREST used to select,
    -- in joined_at order
    'members', (select coalesce(
                  jsonb_agg(jsonb_build_object(
                    'player_id', m.player_id, 'is_bot', m.is_bot,
                    'bot_difficulty', m.bot_difficulty, 'joined_at', m.joined_at)
                    order by m.joined_at), '[]'::jsonb)
                from game_players m where m.game_id = p_game_id),
    'snap', (select jsonb_build_object('seq', s.seq, 'state', s.state)
             from game_state s where s.game_id = p_game_id),
    -- current-generation events after the snapshot (empty for a lobby)
    'tail', (select coalesce(jsonb_agg(to_jsonb(e) order by e.seq), '[]'::jsonb)
             from events e
             where e.game_id = p_game_id
               and e.generation = g.cur_generation
               and e.seq > coalesce(
                     (select s2.seq from game_state s2 where s2.game_id = p_game_id), -1)),
    -- full record across generations (canonicalization happens in the
    -- engine against `forks`)
    'history', (select coalesce(jsonb_agg(to_jsonb(e) order by e.seq), '[]'::jsonb)
                from events e
                where e.game_id = p_game_id
                  and e.generation <= g.cur_generation),
    'forks', (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
              from game_forks f where f.game_id = p_game_id),
    'membership', exists(select 1 from game_players gp
                         where gp.game_id = p_game_id
                           and gp.player_id = p_player_id),
    -- avatars/names for real players only (bot ids are not uuids)
    'avatars', (select coalesce(jsonb_object_agg(p2.id, p2.avatar_url), '{}'::jsonb)
                from game_players gp2
                join players p2 on p2.id = gp2.player_id
                where gp2.game_id = p_game_id
                  and gp2.player_id::text ~* uuid_re
                  and nullif(p2.avatar_url, '') is not null),
    'names', (select coalesce(jsonb_object_agg(p3.id, p3.name), '{}'::jsonb)
              from game_players gp3
              join players p3 on p3.id = gp3.player_id
              where gp3.game_id = p_game_id
                and gp3.player_id::text ~* uuid_re)
  );
end;
$$;

revoke all on function load_game_detail(uuid, uuid) from public, anon, authenticated;
grant execute on function load_game_detail(uuid, uuid) to service_role;

-- --------------------------------------------------------------- writes ---

-- Atomic commit for both player actions and ticks: any number of events +
-- the snapshot + one per-member realtime row + a whitelisted games patch,
-- all in one transaction. Callers pass each member's state PRE-SCRUBBED
-- (no seed, others' ap/range as -1, attack-masked log) — this function
-- never scrubs itself, it only persists what it is given.
create or replace function commit_game_update(
  p_game_id       uuid,
  p_generation    int,
  p_events        jsonb,
  p_next_seq      int,
  p_next_state    jsonb,
  p_has_winner    boolean,
  p_member_states jsonb default '[]'::jsonb,
  p_game_patch    jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into events (game_id, generation, seq, type, actor_id, payload, created_at)
  select p_game_id, p_generation, (e->>'seq')::int, e->>'type', e->>'actor_id',
         e->'payload', (e->>'created_at')::timestamptz
  from jsonb_array_elements(p_events) e;

  insert into game_state (game_id, seq, state, updated_at)
  values (p_game_id, p_next_seq, p_next_state, now())
  on conflict (game_id) do update
    set seq = excluded.seq, state = excluded.state, updated_at = excluded.updated_at
    -- never let an out-of-order commit roll the snapshot back (the events
    -- PK already serializes appends; this guards a degenerate empty commit)
    where excluded.seq >= game_state.seq;

  -- one realtime row per member (real users only — bot ids are not uuids).
  -- The seq guard never lets an out-of-order commit regress a member's row.
  if p_member_states <> '[]'::jsonb then
    insert into player_activity as pa
      (game_id, player_id, seq, state, events, game_patch, updated_at)
    select p_game_id, (m->>'player_id')::uuid, p_next_seq, m->'state',
           coalesce(m->'events', '[]'::jsonb),
           coalesce(m->'game_patch', '{}'::jsonb), now()
    from jsonb_array_elements(p_member_states) m
    on conflict (game_id, player_id) do update
      set seq = excluded.seq, state = excluded.state, events = excluded.events,
          game_patch = excluded.game_patch, updated_at = now()
      where excluded.seq >= pa.seq;
  end if;

  -- legacy shared trigger: old clients refetch on it. Kept until the
  -- player_activity path is proven in prod, then removed (see 0017).
  insert into activity (game_id, seq, updated_at)
  values (p_game_id, p_next_seq, now())
  on conflict (game_id) do update set seq = excluded.seq;

  -- whitelisted games columns: tick's schedule cursors and the winner's
  -- status flip. Anything else in the patch is ignored.
  if p_game_patch <> '{}'::jsonb then
    update games set
      last_tick_at  = coalesce(nullif(p_game_patch->>'lastTickAt', '')::timestamptz, last_tick_at),
      last_heart_at = coalesce(nullif(p_game_patch->>'lastHeartAt', '')::timestamptz, last_heart_at),
      status        = coalesce(p_game_patch->>'status', status)
    where id = p_game_id;
  end if;
end;
$$;

revoke all on function
  commit_game_update(uuid, int, jsonb, int, jsonb, boolean, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function
  commit_game_update(uuid, int, jsonb, int, jsonb, boolean, jsonb, jsonb)
  to service_role;
