-- Atomic, single-round-trip commit for player actions.
-- The action edge function performed three sequential writes (events insert,
-- game_state upsert, activity upsert, plus a status update on win) — ~600ms
-- of sequential PostgREST round trips per action, and a crash between them
-- left the game inconsistent (event appended while the snapshot stayed
-- stale). This folds them into one transactional RPC, executed with the
-- same semantics and ordering as the old code:
--   events insert -> game_state upsert -> activity upsert -> winner update.
-- Only service_role may execute it: it bypasses RLS and writes raw event
-- rows (full attack attribution must never be client-writable).

create or replace function append_action_event(
  p_game_id    uuid,
  p_generation int,
  p_seq        int,
  p_type       text,
  p_actor_id   text,
  p_payload    jsonb,
  p_created_at timestamptz,
  p_next_seq   int,
  p_next_state jsonb,
  p_has_winner boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into events (game_id, generation, seq, type, actor_id, payload, created_at)
  values (p_game_id, p_generation, p_seq, p_type, p_actor_id, p_payload, p_created_at);

  -- upsert, matching the function's previous .upsert() (row exists in
  -- practice — game-start materializes it before any action runs)
  insert into game_state (game_id, seq, state, updated_at)
  values (p_game_id, p_next_seq, p_next_state, now())
  on conflict (game_id) do update
    set seq = excluded.seq, state = excluded.state, updated_at = excluded.updated_at;

  -- postgREST .upsert() only updates the provided non-conflict columns, so
  -- on conflict the original code left updated_at untouched — match that.
  insert into activity (game_id, seq, updated_at)
  values (p_game_id, p_seq, now())
  on conflict (game_id) do update set seq = excluded.seq;

  if p_has_winner then
    update games set status = 'finished' where id = p_game_id;
  end if;
end;
$$;

revoke all on function
  append_action_event(uuid, int, int, text, text, jsonb, timestamptz, int, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function
  append_action_event(uuid, int, int, text, text, jsonb, timestamptz, int, jsonb, boolean)
  to service_role;
