-- Player avatars: profile pictures rendered inside tank circles on the board.
-- Avatars are NOT part of engine state — they ride alongside via game-get.
alter table players add column avatar_url text;

-- Players may read their own row (PostgREST UPDATE filters need the row
-- visible to SELECT; without this the UPDATE policy matches 0 rows).
create policy players_select_own on players
  for select to authenticated
  using (id = auth.uid());

-- Players may update their own row (used to persist avatar_url; accepting
-- name edits as collateral — names are validated at registration).
create policy players_update_own on players
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- NOTE: the avatars bucket + storage.objects policies moved out of this
-- migration into ../init-storage.sql. The storage schema is created by the
-- storage service AFTER db migrations run on a fresh local stack, so a
-- migration referencing storage.buckets made `supabase start` abort on
-- clean volumes. Hosted projects already have the bucket (this migration's
-- original content ran there); run init-storage.sql once on any other
-- environment after the stack is up.
