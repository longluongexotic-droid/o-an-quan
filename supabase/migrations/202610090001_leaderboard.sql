-- Shared leaderboard for the fixed "Ba nước đi" puzzle.
-- Run as the database owner. Enable Supabase Anonymous Sign-Ins separately.
-- Changing the puzzle requires a new versioned level and regenerated allowlist.
begin;

create schema if not exists oaq_private;
revoke all on schema oaq_private from public, anon, authenticated;

create table if not exists oaq_private.valid_paths (
  level_id text not null,
  moves jsonb not null,
  score integer not null check (score between 0 and 38),
  primary key (level_id, moves),
  check (jsonb_typeof(moves) = 'array' and jsonb_array_length(moves) between 1 and 3)
);

create table if not exists oaq_private.scores (
  level_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_name text not null check (char_length(player_name) between 1 and 24),
  score integer not null check (score between 0 and 38),
  achieved_at timestamptz not null default now(),
  primary key (level_id, user_id)
);
create index if not exists oaq_scores_ranking
  on oaq_private.scores (level_id, score desc, achieved_at asc, user_id asc);

alter table oaq_private.valid_paths enable row level security;
alter table oaq_private.scores enable row level security;
revoke all on all tables in schema oaq_private from public, anon, authenticated;
revoke all on all sequences in schema oaq_private from public, anon, authenticated;

-- BEGIN GENERATED TERMINAL PATHS
-- Generated from engine.mjs: 275 complete paths; do not edit manually.
insert into oaq_private.valid_paths (level_id, moves, score) values
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":9,"direction":1},{"pit":11,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":9,"direction":1},{"pit":11,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":9,"direction":1},{"pit":10,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":9,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 2),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":9,"direction":1},{"pit":7,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":9,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":9,"direction":-1},{"pit":8,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":9,"direction":-1},{"pit":8,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":9,"direction":-1},{"pit":7,"direction":1}]'::jsonb, 13),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":9,"direction":-1},{"pit":7,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":7,"direction":1},{"pit":9,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":7,"direction":1},{"pit":9,"direction":-1}]'::jsonb, 4),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":7,"direction":1},{"pit":8,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":7,"direction":1},{"pit":8,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":7,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":1},{"pit":7,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":1},{"pit":10,"direction":1}]'::jsonb, 12),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 13),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":1},{"pit":9,"direction":1}]'::jsonb, 12),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":1},{"pit":9,"direction":-1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":1},{"pit":8,"direction":1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":1},{"pit":8,"direction":-1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":1},{"pit":7,"direction":1}]'::jsonb, 26),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 23),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":-1},{"pit":10,"direction":1}]'::jsonb, 2),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":-1},{"pit":10,"direction":-1}]'::jsonb, 1),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 23),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":-1},{"pit":8,"direction":1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":-1},{"pit":8,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":-1},{"pit":7,"direction":1}]'::jsonb, 22),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":11,"direction":-1},{"pit":7,"direction":-1}]'::jsonb, 17),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":10,"direction":1},{"pit":11,"direction":1}]'::jsonb, 25),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":10,"direction":1},{"pit":11,"direction":-1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":10,"direction":1},{"pit":9,"direction":1}]'::jsonb, 12),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":10,"direction":1},{"pit":9,"direction":-1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":10,"direction":1},{"pit":8,"direction":1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":10,"direction":1},{"pit":8,"direction":-1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":10,"direction":1},{"pit":7,"direction":1}]'::jsonb, 29),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":10,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 11),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":10,"direction":-1},{"pit":10,"direction":1}]'::jsonb, 4),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":10,"direction":-1},{"pit":10,"direction":-1}]'::jsonb, 4),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":10,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 19),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":10,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 4),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":10,"direction":-1},{"pit":7,"direction":1}]'::jsonb, 4),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":10,"direction":-1},{"pit":7,"direction":-1}]'::jsonb, 4),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":1},{"pit":11,"direction":1}]'::jsonb, 25),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":1},{"pit":11,"direction":-1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":1},{"pit":10,"direction":1}]'::jsonb, 25),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":1},{"pit":8,"direction":1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":1},{"pit":8,"direction":-1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":1},{"pit":7,"direction":1}]'::jsonb, 29),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 12),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 4),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":-1},{"pit":10,"direction":1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":-1},{"pit":10,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 23),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":-1},{"pit":8,"direction":1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":-1},{"pit":8,"direction":-1}]'::jsonb, 6),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":-1},{"pit":7,"direction":1}]'::jsonb, 22),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":9,"direction":-1},{"pit":7,"direction":-1}]'::jsonb, 17),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":1},{"pit":11,"direction":1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":1},{"pit":11,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":1},{"pit":10,"direction":1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":1},{"pit":9,"direction":1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":1},{"pit":9,"direction":-1}]'::jsonb, 5),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":1},{"pit":7,"direction":1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 6),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":-1},{"pit":10,"direction":1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":-1},{"pit":10,"direction":-1}]'::jsonb, 5),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 6),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":-1},{"pit":7,"direction":1}]'::jsonb, 5),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":8,"direction":-1},{"pit":7,"direction":-1}]'::jsonb, 5),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":1},{"pit":10,"direction":1}]'::jsonb, 29),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":1},{"pit":9,"direction":1}]'::jsonb, 33),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":1},{"pit":9,"direction":-1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":1},{"pit":8,"direction":1}]'::jsonb, 12),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":1},{"pit":8,"direction":-1}]'::jsonb, 11),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 20),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":-1},{"pit":10,"direction":1}]'::jsonb, 20),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":-1},{"pit":10,"direction":-1}]'::jsonb, 2),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 20),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":-1},{"pit":8,"direction":1}]'::jsonb, 2),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":-1},{"pit":8,"direction":-1}]'::jsonb, 2),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":-1},{"pit":7,"direction":1}]'::jsonb, 26),
  ('ba-nuoc-v1', '[{"pit":11,"direction":-1},{"pit":7,"direction":-1},{"pit":7,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":11,"direction":1},{"pit":7,"direction":1}]'::jsonb, 30),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":11,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 26),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":11,"direction":-1},{"pit":10,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":11,"direction":-1},{"pit":10,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":11,"direction":-1},{"pit":8,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":11,"direction":-1},{"pit":8,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":9,"direction":1},{"pit":10,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":9,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":9,"direction":1},{"pit":7,"direction":1}]'::jsonb, 29),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":9,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 26),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":9,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":9,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":9,"direction":-1},{"pit":8,"direction":1}]'::jsonb, 1),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":9,"direction":-1},{"pit":8,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":7,"direction":1},{"pit":9,"direction":1}]'::jsonb, 1),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":7,"direction":1},{"pit":9,"direction":-1}]'::jsonb, 1),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":7,"direction":1},{"pit":8,"direction":1}]'::jsonb, 1),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":7,"direction":1},{"pit":8,"direction":-1}]'::jsonb, 1),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":7,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":7,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 15),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":7,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":9,"direction":1},{"pit":7,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 15),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":11,"direction":1},{"pit":10,"direction":1}]'::jsonb, 17),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":11,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 20),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":11,"direction":1},{"pit":8,"direction":1}]'::jsonb, 17),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":11,"direction":1},{"pit":8,"direction":-1}]'::jsonb, 17),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":11,"direction":1},{"pit":7,"direction":1}]'::jsonb, 17),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":11,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 20),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":11,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 5),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":11,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 5),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":11,"direction":-1},{"pit":8,"direction":1}]'::jsonb, 5),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":11,"direction":-1},{"pit":8,"direction":-1}]'::jsonb, 5),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":11,"direction":-1},{"pit":7,"direction":1}]'::jsonb, 5),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":11,"direction":-1},{"pit":7,"direction":-1}]'::jsonb, 6),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":10,"direction":1},{"pit":11,"direction":1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":10,"direction":1},{"pit":11,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":10,"direction":1},{"pit":9,"direction":1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":10,"direction":1},{"pit":9,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":10,"direction":1},{"pit":7,"direction":1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":10,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":10,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 4),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":10,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 5),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":10,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 4),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":10,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 4),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":9,"direction":1},{"pit":8,"direction":1}]'::jsonb, 19),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":9,"direction":1},{"pit":8,"direction":-1}]'::jsonb, 19),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":9,"direction":1},{"pit":7,"direction":1}]'::jsonb, 19),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":9,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 22),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":9,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 18),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":9,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 5),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":9,"direction":-1},{"pit":10,"direction":1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":9,"direction":-1},{"pit":10,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":9,"direction":-1},{"pit":8,"direction":1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":9,"direction":-1},{"pit":8,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":7,"direction":1},{"pit":8,"direction":1}]'::jsonb, 19),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":7,"direction":1},{"pit":8,"direction":-1}]'::jsonb, 19),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":7,"direction":1},{"pit":7,"direction":1}]'::jsonb, 19),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":7,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 38),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":7,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 17),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":7,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 5),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":7,"direction":-1},{"pit":10,"direction":1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":7,"direction":-1},{"pit":10,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":7,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 19),
  ('ba-nuoc-v1', '[{"pit":9,"direction":-1},{"pit":7,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 19),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":9,"direction":1},{"pit":11,"direction":1}]'::jsonb, 17),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":9,"direction":1},{"pit":11,"direction":-1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":9,"direction":1},{"pit":10,"direction":1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":9,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 9),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":9,"direction":1},{"pit":7,"direction":1}]'::jsonb, 9),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":9,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":9,"direction":-1},{"pit":8,"direction":1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":9,"direction":-1},{"pit":8,"direction":-1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":9,"direction":-1},{"pit":7,"direction":1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":9,"direction":-1},{"pit":7,"direction":-1}]'::jsonb, 20),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":7,"direction":1},{"pit":11,"direction":1}]'::jsonb, 17),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":7,"direction":1},{"pit":11,"direction":-1}]'::jsonb, 22),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":7,"direction":1},{"pit":10,"direction":1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":7,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":7,"direction":1},{"pit":8,"direction":1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":7,"direction":1},{"pit":8,"direction":-1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":7,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 11),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":7,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 11),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":7,"direction":-1},{"pit":10,"direction":1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":7,"direction":-1},{"pit":10,"direction":-1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":7,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":1},{"pit":7,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 11),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":11,"direction":1},{"pit":7,"direction":1}]'::jsonb, 14),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":11,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 1),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":11,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":11,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":11,"direction":-1},{"pit":10,"direction":1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":11,"direction":-1},{"pit":10,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":11,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":11,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":11,"direction":-1},{"pit":8,"direction":1}]'::jsonb, 10),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":11,"direction":-1},{"pit":8,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":11,"direction":-1},{"pit":7,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":11,"direction":-1},{"pit":7,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":9,"direction":1},{"pit":10,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":9,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":9,"direction":1},{"pit":7,"direction":1}]'::jsonb, 13),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":9,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":9,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 12),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":9,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 12),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":9,"direction":-1},{"pit":8,"direction":1}]'::jsonb, 20),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":9,"direction":-1},{"pit":8,"direction":-1}]'::jsonb, 12),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":7,"direction":1},{"pit":9,"direction":1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":7,"direction":1},{"pit":9,"direction":-1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":7,"direction":1},{"pit":8,"direction":1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":7,"direction":1},{"pit":8,"direction":-1}]'::jsonb, 8),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":7,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 13),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":7,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 15),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":7,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 12),
  ('ba-nuoc-v1', '[{"pit":8,"direction":-1},{"pit":7,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 26),
  ('ba-nuoc-v1', '[{"pit":7,"direction":1},{"pit":10,"direction":1},{"pit":7,"direction":1}]'::jsonb, 15),
  ('ba-nuoc-v1', '[{"pit":7,"direction":1},{"pit":10,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 15),
  ('ba-nuoc-v1', '[{"pit":7,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 28),
  ('ba-nuoc-v1', '[{"pit":7,"direction":1},{"pit":9,"direction":1},{"pit":10,"direction":1}]'::jsonb, 24),
  ('ba-nuoc-v1', '[{"pit":7,"direction":1},{"pit":9,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 13),
  ('ba-nuoc-v1', '[{"pit":7,"direction":1},{"pit":9,"direction":1},{"pit":7,"direction":1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":7,"direction":1},{"pit":9,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 28),
  ('ba-nuoc-v1', '[{"pit":7,"direction":1},{"pit":9,"direction":-1}]'::jsonb, 28),
  ('ba-nuoc-v1', '[{"pit":7,"direction":1},{"pit":7,"direction":1},{"pit":10,"direction":1}]'::jsonb, 24),
  ('ba-nuoc-v1', '[{"pit":7,"direction":1},{"pit":7,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 13),
  ('ba-nuoc-v1', '[{"pit":7,"direction":1},{"pit":7,"direction":1},{"pit":8,"direction":1}]'::jsonb, 13),
  ('ba-nuoc-v1', '[{"pit":7,"direction":1},{"pit":7,"direction":1},{"pit":8,"direction":-1}]'::jsonb, 13),
  ('ba-nuoc-v1', '[{"pit":7,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 28),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":11,"direction":1},{"pit":11,"direction":1}]'::jsonb, 29),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":11,"direction":1},{"pit":11,"direction":-1}]'::jsonb, 1),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":11,"direction":1},{"pit":10,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":11,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 16),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":11,"direction":1},{"pit":8,"direction":1}]'::jsonb, 2),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":11,"direction":1},{"pit":8,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":11,"direction":1},{"pit":7,"direction":1}]'::jsonb, 20),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":11,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 17),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":11,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 13),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":11,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 4),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":11,"direction":-1},{"pit":8,"direction":1}]'::jsonb, 2),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":11,"direction":-1},{"pit":8,"direction":-1}]'::jsonb, 2),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":11,"direction":-1},{"pit":7,"direction":1}]'::jsonb, 2),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":11,"direction":-1},{"pit":7,"direction":-1}]'::jsonb, 2),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":10,"direction":1},{"pit":11,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":10,"direction":1},{"pit":11,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":10,"direction":1},{"pit":9,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":10,"direction":1},{"pit":9,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":10,"direction":1},{"pit":7,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":10,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":10,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 2),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":10,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 2),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":10,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 1),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":10,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 4),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":9,"direction":1},{"pit":11,"direction":1}]'::jsonb, 12),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":9,"direction":1},{"pit":11,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":9,"direction":1},{"pit":10,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":9,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":9,"direction":1},{"pit":7,"direction":1}]'::jsonb, 2),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":9,"direction":1},{"pit":7,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":9,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 15),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":9,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 2),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":9,"direction":-1},{"pit":10,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":9,"direction":-1},{"pit":10,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":9,"direction":-1},{"pit":8,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":9,"direction":-1},{"pit":8,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":9,"direction":-1},{"pit":7,"direction":1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":9,"direction":-1},{"pit":7,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":7,"direction":1},{"pit":11,"direction":1}]'::jsonb, 12),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":7,"direction":1},{"pit":11,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":7,"direction":1},{"pit":10,"direction":1}]'::jsonb, 11),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":7,"direction":1},{"pit":10,"direction":-1}]'::jsonb, 17),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":7,"direction":1},{"pit":8,"direction":1}]'::jsonb, 12),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":7,"direction":1},{"pit":8,"direction":-1}]'::jsonb, 0),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":7,"direction":-1},{"pit":11,"direction":1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":7,"direction":-1},{"pit":11,"direction":-1}]'::jsonb, 5),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":7,"direction":-1},{"pit":10,"direction":1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":7,"direction":-1},{"pit":10,"direction":-1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":7,"direction":-1},{"pit":9,"direction":1}]'::jsonb, 3),
  ('ba-nuoc-v1', '[{"pit":7,"direction":-1},{"pit":7,"direction":-1},{"pit":9,"direction":-1}]'::jsonb, 3)
on conflict (level_id, moves) do update set score = excluded.score;
-- END GENERATED TERMINAL PATHS

create or replace function public.oaq_submit_score(p_name text, p_moves jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_score integer;
  v_best integer;
  v_improved boolean;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'An authenticated player is required.';
  end if;

  if octet_length(p_name) > 1024 then
    raise exception using errcode = '22023', message = 'Player name is too long.';
  end if;
  -- Match client Cc/Cf rejection before normalizing whitespace. U+0000 cannot
  -- occur in PostgreSQL text. These ranges cover Unicode control/format chars.
  if p_name is null or p_name ~ U&'[\0001-\001f\007f-\009f\00ad\0600-\0605\061c\06dd\070f\0890-\0891\08e2\180e\200b-\200f\202a-\202e\2060-\2064\2066-\206f\feff\fff9-\fffb\+0110bd\+0110cd\+013430-\+01343f\+01bca0-\+01bca3\+01d173-\+01d17a\+0e0001\+0e0020-\+0e007f]' then
    raise exception using errcode = '22023', message = 'Player name contains unsupported characters.';
  end if;
  v_name := normalize(btrim(regexp_replace(p_name,
    U&'[\0020\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+', ' ', 'g')), NFC);
  if char_length(v_name) not between 1 and 24 then
    raise exception using errcode = '22023', message = 'Player name must contain 1 to 24 characters.';
  end if;

  if jsonb_typeof(p_moves) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'A completed move sequence is required.';
  end if;
  if jsonb_array_length(p_moves) not between 1 and 3 then
    raise exception using errcode = '22023', message = 'A completed move sequence is required.';
  end if;
  -- Exact JSONB equality rejects incomplete, illegal, reordered, extra-field,
  -- or fabricated moves. The score is calculated offline by the same engine
  -- and installed by the owner; the client never supplies a score to trust.
  select paths.score into v_score
    from oaq_private.valid_paths as paths
    where paths.level_id = 'ba-nuoc-v1' and paths.moves = p_moves;
  if not found then
    raise exception using errcode = '22023', message = 'This is not a legal completed game.';
  end if;

  -- INSERT's unique-key lock serializes first submissions. Existing players
  -- take a row lock before comparing/updating, including concurrent retries.
  insert into oaq_private.scores (level_id, user_id, player_name, score)
    values ('ba-nuoc-v1', v_user, v_name, v_score)
    on conflict (level_id, user_id) do nothing
    returning score into v_best;
  if found then
    v_improved := true;
  else
    select scores.score into v_best
      from oaq_private.scores as scores
      where scores.level_id = 'ba-nuoc-v1' and scores.user_id = v_user
      for update;
    v_improved := v_score > v_best;
    update oaq_private.scores as scores
      set player_name = v_name,
          score = greatest(scores.score, v_score),
          achieved_at = case when v_improved then now() else scores.achieved_at end
      where scores.level_id = 'ba-nuoc-v1' and scores.user_id = v_user
      returning scores.score into v_best;
  end if;
  return jsonb_build_object('score', v_score, 'best_score', v_best, 'improved', v_improved);
end;
$$;

create or replace function public.oaq_top20()
returns table (rank bigint, name text, score integer, achieved_at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select row_number() over (order by scores.score desc, scores.achieved_at asc, scores.user_id asc),
         scores.player_name,
         scores.score,
         scores.achieved_at,
         coalesce(scores.user_id = auth.uid(), false)
  from oaq_private.scores as scores
  where scores.level_id = 'ba-nuoc-v1'
  order by scores.score desc, scores.achieved_at asc, scores.user_id asc
  limit 20;
$$;

-- PostgreSQL functions are executable by PUBLIC by default. Narrow that
-- privilege explicitly; anonymous sign-in JWTs use authenticated, not anon.
revoke all on function public.oaq_submit_score(text, jsonb) from public, anon, authenticated;
revoke all on function public.oaq_top20() from public, anon, authenticated;
grant execute on function public.oaq_submit_score(text, jsonb) to authenticated;
grant execute on function public.oaq_top20() to anon, authenticated;

commit;
