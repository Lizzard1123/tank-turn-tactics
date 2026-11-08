create extension if not exists pgcrypto;

create table players (
  id uuid primary key default gen_random_uuid(),
  name text unique not null check (char_length(name) between 2 and 24),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table sessions (
  token text primary key,
  player_id uuid not null references players(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode text not null check (mode in ('play','test')),
  config jsonb not null,
  status text not null default 'lobby' check (status in ('lobby','active','finished')),
  created_by uuid not null references players(id),
  daily_ap_time time not null default '09:00',      -- play mode
  ap_interval_minutes int,                           -- test mode
  last_tick_at timestamptz,
  cur_generation int not null default 1,             -- bumped on fork
  fork_seq int,                                      -- replay truncation point
  invite_code text unique not null default substr(md5(random()::text), 1, 10),
  created_at timestamptz not null default now()
);

create table game_players (
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  is_bot boolean not null default false,
  bot_difficulty text check (bot_difficulty in ('easy','medium','hard')),
  joined_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

create table events (
  game_id uuid not null references games(id) on delete cascade,
  generation int not null default 1,   -- forked history gets generation+1
  seq int not null,
  type text not null,
  actor_id text not null,          -- uuid string, bot id, or 'system'
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (game_id, generation, seq)
);

create table game_state (
  game_id uuid primary key references games(id) on delete cascade,
  seq int not null,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create index events_game_seq_idx on events (game_id, generation, seq);
create index games_status_idx on games (status);
