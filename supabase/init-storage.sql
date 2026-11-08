-- Avatars bucket + storage policies. NOT a migration: the storage schema is
-- created by the storage service after db migrations run, so `supabase start`
-- aborts on a fresh volume if a migration references storage.*. Run this once
-- against any environment whose storage service is up (hosted included, if
-- the bucket was never created):
--   psql "$DATABASE_URL" -f supabase/init-storage.sql
-- Hosted production already has all of this applied.

-- Public bucket: board images load without signed URLs.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Each player owns their avatar folder: avatars/<playerId>/...
-- auth.uid() resolves from the GoTrue session JWT (sub = auth user id).
drop policy if exists avatars_owner_write on storage.objects;
create policy avatars_owner_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_owner_update on storage.objects;
create policy avatars_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatars');
