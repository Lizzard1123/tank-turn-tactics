-- Player avatars: profile pictures rendered inside tank circles on the board.
-- Avatars are NOT part of engine state — they ride alongside via game-get.
alter table players add column avatar_url text;

-- Public bucket: board images load without signed URLs.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Each player owns their avatar folder: avatars/<playerId>/...
-- auth.uid() resolves from our session JWT (sub = player id).
create policy avatars_owner_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatars');

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
