-- pg_cron schedule: hourly tick invocation via pg_net.
-- Calls the tick Edge Function with the CRON_SECRET (read from the
-- app.cron_secret database setting).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'ttt-tick', '0 * * * *',  -- hourly
  $$
  select net.http_post(
    url := 'https://sifbpmpxyiycbupntobl.supabase.co/functions/v1/tick',
    headers := jsonb_build_object('Content-Type','application/json',
               'Authorization','Bearer ' || current_setting('app.cron_secret', true)),
    body := '{}'::jsonb
  );
  $$
);
