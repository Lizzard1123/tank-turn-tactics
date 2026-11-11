-- Random-schedule support (AP + heart spawns). The 'random' schedule mode
-- derives each period's grant minute from the game seed, so the only state
-- needed is the period ANCHOR (started_at) and per-schedule last-grant
-- timestamps. last_tick_at already exists (shared with interval/timeOfDay);
-- hearts get their own cadence column.
alter table games add column started_at timestamptz;
alter table games add column last_heart_at timestamptz;

-- Backfill: anchor running games at their creation time (period math shifts
-- once, harmless — the next grant is computed from the new anchor either
-- way). Lobby/finished games keep null; game-start sets it going forward.
update games set started_at = created_at where status = 'active';
