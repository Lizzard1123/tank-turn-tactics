-- Canonical fork history. Each fork truncates the PARENT generation at
-- to_seq; the new generation continues at to_seq + 1. Recording one row per
-- fork lets game-get assemble the true timeline: for every generation, keep
-- its events up to the fork that ended it — never the discarded branch tail
-- (replaying those was teleporting tanks across forked timelines).
create table if not exists game_forks (
  game_id uuid not null references games(id) on delete cascade,
  parent_generation int not null,
  to_seq bigint not null,
  primary key (game_id, parent_generation)
);

-- Service-role only (matches 0002's posture): without RLS Supabase's default
-- privileges let any anon client insert/delete cut rows — e.g. collapsing
-- another game's canonical history to nothing.
alter table game_forks enable row level security;

-- Backfill: games record only the LATEST fork point (games.fork_seq), which
-- is the fork that ended generation cur_generation - 1.
insert into game_forks (game_id, parent_generation, to_seq)
  select id, cur_generation - 1, fork_seq
  from games
  where fork_seq is not null
  on conflict do nothing;
