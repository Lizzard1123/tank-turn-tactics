-- Fix the 0010 regression: 0010 rewrote the 'ttt-tick' command to read its
-- bearer secret via current_setting('app.cron_secret', true) — but that GUC
-- was never set (see 0009: Supabase's postgres role cannot ALTER DATABASE SET
-- a custom parameter), so the expression yields NULL, every per-minute POST
-- went out with a null Authorization header, and the tick function 401'd it.
-- pg_cron still reports the runs as "succeeded" because it only tracks that
-- the statement executed. Read the secret from the app_settings table
-- (migration 0009) like the working pre-0010 job did.
select cron.unschedule('ttt-tick');
select cron.schedule(
  'ttt-tick', '* * * * *',
  $$
  select net.http_post(
    url := 'https://sifbpmpxyiycbupntobl.supabase.co/functions/v1/tick',
    headers := jsonb_build_object('Content-Type','application/json',
               'Authorization','Bearer ' || (select value from app_settings where key = 'cron_secret')),
    body := '{}'::jsonb
  );
  $$
);
