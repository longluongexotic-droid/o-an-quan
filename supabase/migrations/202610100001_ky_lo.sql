-- Kỳ Lộ: one immutable global name, three games, server-saved move progress.
-- Apply after 202610090001_leaderboard.sql as the database owner.
begin;

create or replace function oaq_private.normalize_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare v_name text;
begin
  if p_name is null or octet_length(p_name) > 1024 then
    raise exception using errcode = '22023', message = 'INVALID_NAME';
  end if;
  if p_name ~ U&'[\0001-\001f\007f-\009f\00ad\0600-\0605\061c\06dd\070f\0890-\0891\08e2\180e\200b-\200f\202a-\202e\2060-\2064\2066-\206f\feff\fff9-\fffb\+0110bd\+0110cd\+013430-\+01343f\+01bca0-\+01bca3\+01d173-\+01d17a\+0e0001\+0e0020-\+0e007f]' then
    raise exception using errcode = '22023', message = 'INVALID_NAME';
  end if;
  v_name := normalize(btrim(regexp_replace(p_name,
    U&'[\0020\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+', ' ', 'g')), NFC);
  if char_length(v_name) not between 1 and 24 then
    raise exception using errcode = '22023', message = 'INVALID_NAME';
  end if;
  return v_name;
end;
$$;

create table if not exists oaq_private.players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 24),
  name_key text not null unique,
  attempts_used smallint not null default 0 check (attempts_used between 0 and 3),
  best_score integer check (best_score between 0 and 38),
  achieved_at timestamptz,
  created_at timestamptz not null default now(),
  check ((best_score is null) = (achieved_at is null))
);
create table if not exists oaq_private.player_bindings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  player_id uuid not null references oaq_private.players(id)
);
create index if not exists oaq_player_bindings_player on oaq_private.player_bindings(player_id);
create index if not exists oaq_players_ranking
  on oaq_private.players (best_score desc, achieved_at asc, id asc)
  where best_score is not null;

create table if not exists oaq_private.games (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references oaq_private.players(id),
  attempt_number smallint not null check (attempt_number between 1 and 3),
  level_id text not null default 'ba-nuoc-v1',
  moves jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active','completed')),
  score integer check (score between 0 and 38),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (player_id, attempt_number),
  unique (player_id, id),
  check (jsonb_typeof(moves) = 'array' and jsonb_array_length(moves) between 0 and 3),
  check ((status = 'active' and score is null and completed_at is null) or
         (status = 'completed' and score is not null and completed_at is not null))
);
create unique index if not exists oaq_one_active_game
  on oaq_private.games(player_id) where status = 'active';
create table if not exists oaq_private.game_requests (
  player_id uuid not null references oaq_private.players(id),
  request_id uuid not null,
  game_id uuid not null,
  primary key (player_id, request_id),
  foreign key (player_id, game_id) references oaq_private.games(player_id, id)
);

-- Every accepted move must extend one of the owner-generated legal terminal
-- paths. No score or board state supplied by a browser is trusted.
create table if not exists oaq_private.valid_prefixes (
  level_id text not null,
  moves jsonb not null,
  is_terminal boolean not null,
  score integer check (score between 0 and 38),
  primary key (level_id, moves),
  check ((is_terminal and score is not null) or (not is_terminal and score is null))
);
insert into oaq_private.valid_prefixes (level_id, moves, is_terminal, score)
select prefixes.level_id, prefixes.moves, bool_or(prefixes.terminal),
       max(prefixes.score) filter (where prefixes.terminal)
from (
  select paths.level_id,
         coalesce((select jsonb_agg(element.value order by element.ordinality)
                   from jsonb_array_elements(paths.moves) with ordinality as element
                   where element.ordinality <= depths.depth), '[]'::jsonb) as moves,
         depths.depth = jsonb_array_length(paths.moves) as terminal,
         paths.score
  from oaq_private.valid_paths as paths
  cross join lateral generate_series(0, jsonb_array_length(paths.moves)) as depths(depth)
  where paths.level_id = 'ba-nuoc-v1'
) as prefixes
group by prefixes.level_id, prefixes.moves
on conflict (level_id, moves) do update
  set is_terminal = excluded.is_terminal, score = excluded.score;

-- Historical submissions provide a best score, but no count of old games.
-- Reserve each normalized name and count one historical completed attempt.
-- Duplicate historical names share a player/quota; preserve every old UID's
-- binding, the maximum score, and earliest attainment of that maximum.
with legacy as (
  select scores.user_id, scores.score, scores.achieved_at,
         oaq_private.normalize_name(scores.player_name) as name,
         lower(oaq_private.normalize_name(scores.player_name)) as name_key
  from oaq_private.scores as scores where scores.level_id = 'ba-nuoc-v1'
), chosen as (
  select distinct on (name_key) name, name_key, score, achieved_at
  from legacy order by name_key, score desc, achieved_at asc, user_id asc
)
insert into oaq_private.players(name, name_key, attempts_used, best_score, achieved_at)
select name, name_key, 1, score, achieved_at from chosen
on conflict (name_key) do nothing;
insert into oaq_private.player_bindings(user_id, player_id)
select scores.user_id, players.id
from oaq_private.scores as scores
join oaq_private.players as players
  on players.name_key = lower(oaq_private.normalize_name(scores.player_name))
where scores.level_id = 'ba-nuoc-v1'
on conflict (user_id) do nothing;

alter table oaq_private.players enable row level security;
alter table oaq_private.player_bindings enable row level security;
alter table oaq_private.games enable row level security;
alter table oaq_private.game_requests enable row level security;
alter table oaq_private.valid_prefixes enable row level security;
revoke all on schema oaq_private from public, anon, authenticated;
revoke all on all tables in schema oaq_private from public, anon, authenticated;
revoke all on all sequences in schema oaq_private from public, anon, authenticated;

create or replace function oaq_private.player_profile(p_player uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', players.name,
    'attempts_used', players.attempts_used,
    'attempts_left', 3 - players.attempts_used,
    'best_score', players.best_score,
    'active_game', (
      select jsonb_build_object('id', games.id, 'moves', games.moves,
        'status', games.status, 'score', games.score)
      from oaq_private.games as games where games.player_id = players.id
      order by games.attempt_number desc limit 1))
  from oaq_private.players as players where players.id = p_player;
$$;

create or replace function public.oaq_player_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_player uuid;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'NAME_REQUIRED'; end if;
  select bindings.player_id into v_player from oaq_private.player_bindings as bindings where bindings.user_id = auth.uid();
  if not found then return null; end if;
  return oaq_private.player_profile(v_player);
end;
$$;

create or replace function public.oaq_register_player(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := oaq_private.normalize_name(p_name);
  v_key text := lower(v_name);
  v_player uuid;
  v_bound uuid;
  v_bound_key text;
begin
  if v_user is null then raise exception using errcode = '42501', message = 'NAME_REQUIRED'; end if;
  select bindings.player_id, players.name_key into v_bound, v_bound_key
    from oaq_private.player_bindings as bindings
    join oaq_private.players as players on players.id = bindings.player_id
    where bindings.user_id = v_user;
  if found then
    if v_bound_key <> v_key then raise exception using errcode = 'P0001', message = 'NAME_LOCKED'; end if;
    return oaq_private.player_profile(v_bound);
  end if;

  insert into oaq_private.players(name, name_key) values (v_name, v_key)
    on conflict (name_key) do nothing returning id into v_player;
  if not found then
    -- A same-UID concurrent registration may have just won this name.
    select bindings.player_id into v_bound
      from oaq_private.player_bindings as bindings
      join oaq_private.players as players on players.id = bindings.player_id
      where bindings.user_id = v_user and players.name_key = v_key;
    if found then return oaq_private.player_profile(v_bound); end if;
    raise exception using errcode = 'P0001', message = 'NAME_TAKEN';
  end if;
  insert into oaq_private.player_bindings(user_id, player_id) values (v_user, v_player)
    on conflict (user_id) do nothing returning player_id into v_bound;
  if not found then
    -- Raising rolls back this losing registration's newly reserved name.
    raise exception using errcode = 'P0001', message = 'NAME_LOCKED';
  end if;
  return oaq_private.player_profile(v_player);
end;
$$;

create or replace function public.oaq_start_game(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_player uuid; v_used smallint; v_game uuid;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'NAME_REQUIRED'; end if;
  if p_request_id is null then raise exception using errcode = '22023', message = 'INVALID_REQUEST'; end if;
  select bindings.player_id into v_player from oaq_private.player_bindings as bindings where bindings.user_id = auth.uid();
  if not found then raise exception using errcode = 'P0001', message = 'NAME_REQUIRED'; end if;
  select players.attempts_used into v_used from oaq_private.players as players where players.id = v_player for update;
  if exists (select 1 from oaq_private.game_requests as requests
             where requests.player_id = v_player and requests.request_id = p_request_id) then
    return oaq_private.player_profile(v_player);
  end if;
  select games.id into v_game from oaq_private.games as games where games.player_id = v_player and games.status = 'active';
  if not found then
    if v_used >= 3 then raise exception using errcode = 'P0001', message = 'ATTEMPT_LIMIT'; end if;
    insert into oaq_private.games(player_id, attempt_number) values (v_player, v_used + 1) returning id into v_game;
    update oaq_private.players set attempts_used = v_used + 1 where id = v_player;
  end if;
  -- Save aliases even when resuming, so retrying a lost resume response after
  -- completion cannot accidentally charge another game.
  insert into oaq_private.game_requests(player_id, request_id, game_id) values (v_player, p_request_id, v_game);
  return oaq_private.player_profile(v_player);
end;
$$;

create or replace function public.oaq_play_move(p_game_id uuid, p_expected_moves jsonb, p_move jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_game oaq_private.games%rowtype;
  v_candidate jsonb;
  v_terminal boolean;
  v_score integer;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'NAME_REQUIRED'; end if;
  select bindings.player_id into v_player from oaq_private.player_bindings as bindings where bindings.user_id = auth.uid();
  if not found then raise exception using errcode = 'P0001', message = 'NAME_REQUIRED'; end if;
  perform 1 from oaq_private.players as players where players.id = v_player for update;
  select games.* into v_game from oaq_private.games as games where games.id = p_game_id and games.player_id = v_player for update;
  if not found then raise exception using errcode = 'P0001', message = 'GAME_CONFLICT'; end if;
  if jsonb_typeof(p_expected_moves) is distinct from 'array' or jsonb_typeof(p_move) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_MOVE';
  end if;
  if jsonb_array_length(p_expected_moves) not between 0 and 2 then
    raise exception using errcode = 'P0001', message = 'INVALID_MOVE';
  end if;
  v_candidate := p_expected_moves || jsonb_build_array(p_move);
  if v_candidate = v_game.moves then return oaq_private.player_profile(v_player); end if;
  if v_game.status <> 'active' or p_expected_moves <> v_game.moves then
    raise exception using errcode = 'P0001', message = 'GAME_CONFLICT';
  end if;
  select prefixes.is_terminal, prefixes.score into v_terminal, v_score
    from oaq_private.valid_prefixes as prefixes
    where prefixes.level_id = v_game.level_id and prefixes.moves = v_candidate;
  if not found then raise exception using errcode = 'P0001', message = 'INVALID_MOVE'; end if;
  update oaq_private.games
    set moves = v_candidate, status = case when v_terminal then 'completed' else 'active' end,
        score = v_score, completed_at = case when v_terminal then now() else null end
    where id = v_game.id;
  if v_terminal then
    update oaq_private.players as players
      set best_score = v_score, achieved_at = now()
      where players.id = v_player and (players.best_score is null or v_score > players.best_score);
  end if;
  return oaq_private.player_profile(v_player);
end;
$$;

create or replace function public.oaq_top10()
returns table (rank bigint, name text, score integer, achieved_at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select row_number() over (order by players.best_score desc, players.achieved_at asc, players.id asc),
         players.name, players.best_score, players.achieved_at,
         exists (select 1 from oaq_private.player_bindings as bindings
                 where bindings.player_id = players.id and bindings.user_id = auth.uid())
  from oaq_private.players as players where players.best_score is not null
  order by players.best_score desc, players.achieved_at asc, players.id asc limit 10;
$$;
create or replace function public.oaq_top20()
returns table (rank bigint, name text, score integer, achieved_at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$ select * from public.oaq_top10(); $$;

-- Retire free-form score submissions; only committed server moves now score.
revoke all on function public.oaq_submit_score(text, jsonb) from public, anon, authenticated;
revoke all on all functions in schema oaq_private from public, anon, authenticated;
revoke all on function public.oaq_player_status() from public, anon, authenticated;
revoke all on function public.oaq_register_player(text) from public, anon, authenticated;
revoke all on function public.oaq_start_game(uuid) from public, anon, authenticated;
revoke all on function public.oaq_play_move(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.oaq_top10() from public, anon, authenticated;
revoke all on function public.oaq_top20() from public, anon, authenticated;
grant execute on function public.oaq_player_status() to authenticated;
grant execute on function public.oaq_register_player(text) to authenticated;
grant execute on function public.oaq_start_game(uuid) to authenticated;
grant execute on function public.oaq_play_move(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.oaq_top10() to anon, authenticated;
grant execute on function public.oaq_top20() to anon, authenticated;

commit;
