-- App-level secrets. Supabase's `postgres` role is not a superuser and
-- cannot ALTER DATABASE/ROLE SET a custom GUC ("permission denied to set
-- parameter app.cron_secret"), so the cron job reads its bearer secret from
-- this table instead of current_setting('app.cron_secret', true).
-- Service-role only (RLS on, no policies) — matches 0002's posture.
create table if not exists app_settings (
  key text primary key,
  value text not null
);

alter table app_settings enable row level security;
