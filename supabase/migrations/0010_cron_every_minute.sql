-- Short AP intervals (the lobby knob goes down to 1 minute) need the tick
-- function invoked at least every minute; the hourly schedule could never
-- fire a 1-min drip more than once an hour. Time-of-day slots also benefit:
-- they now grant within a minute of the configured wall-clock time.
-- Replaces the hourly entry; cron.unschedule is safe if it isn't there.
select cron.unschedule('ttt-tick');
select cron.schedule(
  'ttt-tick', '* * * * *',
  $$
  select net.http_post(
    url := 'https://sifbpmpxyiycbupntobl.supabase.co/functions/v1/tick',
    headers := jsonb_build_object('Content-Type','application/json',
               'Authorization','Bearer ' || current_setting('app.cron_secret', true)),
    body := '{}'::jsonb
  );
  $$
);
