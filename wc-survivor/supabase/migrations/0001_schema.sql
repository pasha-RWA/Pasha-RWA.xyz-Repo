-- ============================================================================
-- World Cup 2026 Survivor Pool — core schema
-- ============================================================================
-- Run order: 0001_schema -> 0002_rls_functions -> 0003_seed -> 0004_cron
-- ----------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Reference data: the 48 teams (global, shared across contests)
-- ---------------------------------------------------------------------------
create table if not exists teams (
  id          text primary key,            -- e.g. 'ARG'
  name        text not null,
  flag        text not null,               -- emoji flag
  group_code  text not null,               -- A..L (the official group draw)
  strength    int  not null default 3      -- 1..5, only used for UI ordering / hints
);

-- ---------------------------------------------------------------------------
-- Contests
-- ---------------------------------------------------------------------------
create table if not exists contests (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  season      int  not null default 2026,
  prize_pool  text,
  tiebreaker  text default 'Co-winners declared if multiple entries survive the Final.',
  -- live results ingestion config (sports API)
  provider          text,                  -- 'football-data' | 'api-football' | null (manual only)
  provider_comp_id  text,                  -- competition id at the provider (e.g. 'WC' or '1')
  provider_season   text,                  -- season/year string the provider expects
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

-- Commissioners who may lock/resolve rounds and override results
create table if not exists contest_admins (
  contest_id  uuid references contests(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  primary key (contest_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Rounds (one row per stage per contest) with deadlines + lifecycle
-- status: upcoming -> open -> locked -> resolved
-- ---------------------------------------------------------------------------
create table if not exists rounds (
  id            uuid primary key default gen_random_uuid(),
  contest_id    uuid not null references contests(id) on delete cascade,
  key           text not null check (key in ('GROUP','R32','R16','QF','SF','FINAL')),
  name          text not null,
  sort          int  not null,             -- 0..5 ordering
  pick_count    int  not null,             -- GROUP=4, others=1
  advance_count int  not null,             -- teams advancing FROM this round (32,16,8,4,2,1)
  lock_at       timestamptz,               -- picks lock at this time (kickoff of first match)
  status        text not null default 'upcoming'
                  check (status in ('upcoming','open','locked','resolved')),
  unique (contest_id, key)
);
create index if not exists idx_rounds_contest on rounds(contest_id);

-- ---------------------------------------------------------------------------
-- round_advancers: the source of truth for "who advanced FROM this round".
-- Populated by the sync-results function (real API) and/or commissioner override.
-- GROUP -> the 32 teams that reached the Round of 32, R32 -> the 16 winners, etc.
-- ---------------------------------------------------------------------------
create table if not exists round_advancers (
  contest_id  uuid not null references contests(id) on delete cascade,
  round_key   text not null,
  team_id     text not null references teams(id),
  primary key (contest_id, round_key, team_id)
);

-- ---------------------------------------------------------------------------
-- matches: optional, for live scores + ingestion bookkeeping / display
-- ---------------------------------------------------------------------------
create table if not exists matches (
  id          uuid primary key default gen_random_uuid(),
  contest_id  uuid not null references contests(id) on delete cascade,
  round_key   text not null,
  source_id   text,                        -- provider's match id (for idempotent upserts)
  home_team   text references teams(id),
  away_team   text references teams(id),
  kickoff_at  timestamptz,
  status      text,                        -- SCHEDULED | LIVE | FINISHED
  home_score  int,
  away_score  int,
  winner_team text references teams(id),
  updated_at  timestamptz not null default now(),
  unique (contest_id, source_id)
);
create index if not exists idx_matches_contest_round on matches(contest_id, round_key);

-- ---------------------------------------------------------------------------
-- entries: one per user per contest
-- ---------------------------------------------------------------------------
create table if not exists entries (
  id            uuid primary key default gen_random_uuid(),
  contest_id    uuid not null references contests(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text not null,
  created_at    timestamptz not null default now(),
  unique (contest_id, user_id)
);
create index if not exists idx_entries_contest on entries(contest_id);

-- ---------------------------------------------------------------------------
-- picks: every selection. GROUP has 4 rows; each KO round has 1.
--   * unique(entry_id, team_id)            -> a team can be used only ONCE, ever
--   * unique(entry_id, round_key, team_id) -> no duplicate within a round
-- Round-level count limits + participation are enforced by trigger / RPC.
-- ---------------------------------------------------------------------------
create table if not exists picks (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references entries(id) on delete cascade,
  round_key   text not null check (round_key in ('GROUP','R32','R16','QF','SF','FINAL')),
  team_id     text not null references teams(id),
  created_at  timestamptz not null default now(),
  unique (entry_id, team_id),
  unique (entry_id, round_key, team_id)
);
create index if not exists idx_picks_entry on picks(entry_id);
create index if not exists idx_picks_round on picks(round_key);
