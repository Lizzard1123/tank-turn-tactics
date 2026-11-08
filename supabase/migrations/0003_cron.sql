-- pg_cron schedule: hourly tick invocation via pg_net.
-- NOTE: <project-ref> is substituted at deploy time (see supabase/functions/README.md).
-- For local development, the tick function is invoked directly via curl.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'ttt-tick', '0 * * * *',  -- hourly
  $$
  select net.http_post(
    url := 'https://PLACEHOLDER-project-ref.supabase.co/functions/v1/tick',
    headers := jsonb_build_object('Content-Type','application/json',
               'Authorization','Bearer ' || current_setting('app.cron_secret', true)),
    body := '{}'::jsonb
  );
  $$
);
