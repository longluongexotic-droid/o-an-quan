-- Bảng Vàng administration. Apply after 202610100001_ky_lo.sql.
-- Ranking overrides never alter canonical game scores, history or play limits.
begin;

alter table oaq_private.players
  add column if not exists override_enabled boolean not null default false,
  add column if not exists override_score integer check (override_score between 0 and 38),
  add column if not exists override_achieved_at timestamptz,
  add column if not exists is_hidden boolean not null default false,
  add column if not exists admin_revision integer not null default 0 check (admin_revision >= 0);

create table if not exists oaq_private.admin_allowlist (
  email text primary key check (email = lower(btrim(email)))
);
-- The owner adds approved email addresses separately through the SQL editor.
-- Keep personal account addresses out of this publicly hosted source file.

create table if not exists oaq_private.admin_requests (
  actor_id uuid not null,
  request_id uuid not null,
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);
create table if not exists oaq_private.admin_audit (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references oaq_private.players(id),
  actor_id uuid not null,
  actor_email text not null,
  request_id uuid not null,
  action text not null check (action = 'update'),
  before_data jsonb not null,
  after_data jsonb not null,
  reason text not null check (char_length(reason) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (actor_id, request_id)
);
create index if not exists oaq_admin_audit_player
  on oaq_private.admin_audit(player_id, created_at desc, id desc);

-- Check the verified email in auth.users, not mutable browser/user metadata.
create or replace function oaq_private.require_admin()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare v_email text;
begin
  select lower(btrim(users.email)) into v_email
  from auth.users as users
  join oaq_private.admin_allowlist as allowed on allowed.email = lower(btrim(users.email))
  where users.id = auth.uid()
    and users.email_confirmed_at is not null
    and users.is_anonymous is false;
  if not found then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;
  return v_email;
end;
$$;

-- Game starts and earned-score changes also invalidate a stale admin editor.
create or replace function oaq_private.bump_admin_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.admin_revision := old.admin_revision + 1;
  return new;
end;
$$;
drop trigger if exists oaq_player_admin_revision on oaq_private.players;
create trigger oaq_player_admin_revision
  before update on oaq_private.players
  for each row execute function oaq_private.bump_admin_revision();

create or replace function oaq_private.admin_player_record(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', players.id,
    'name', players.name,
    'best_score', players.best_score,
    'effective_score', case when players.override_enabled then players.override_score else players.best_score end,
    'override_enabled', players.override_enabled,
    'override_score', players.override_score,
    'is_hidden', players.is_hidden,
    'attempts_used', players.attempts_used,
    'revision', players.admin_revision,
    'achieved_at', case when players.override_enabled then players.override_achieved_at else players.achieved_at end)
  from oaq_private.players as players where players.id = p_id;
$$;

create or replace function public.oaq_admin_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object('email', oaq_private.require_admin());
end;
$$;

create or replace function public.oaq_admin_players(p_search text default '', p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_search text := lower(normalize(btrim(coalesce(p_search, '')), NFC)); v_total bigint; v_players jsonb;
begin
  perform oaq_private.require_admin();
  if char_length(v_search) > 80 or p_offset is null or p_offset not between 0 and 1000000
    or p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'INVALID_PAGE';
  end if;
  select count(*) into v_total from oaq_private.players as players
    where strpos(lower(players.name), v_search) > 0;
  select coalesce(jsonb_agg(oaq_private.admin_player_record(page.id) order by page.position), '[]'::jsonb)
    into v_players
  from (
    select players.id,
      row_number() over (order by
        case when players.override_enabled then players.override_score else players.best_score end desc nulls last,
        case when players.override_enabled then players.override_achieved_at else players.achieved_at end asc nulls last,
        players.name asc, players.id asc) as position
    from oaq_private.players as players where strpos(lower(players.name), v_search) > 0
    order by position limit p_limit offset p_offset
  ) as page;
  return jsonb_build_object('players', v_players, 'total', v_total);
end;
$$;

create or replace function public.oaq_admin_save_player(
  p_id uuid,
  p_name text,
  p_override_enabled boolean,
  p_override_score integer,
  p_is_hidden boolean,
  p_expected_revision integer,
  p_request_id uuid,
  p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_email text := oaq_private.require_admin();
  v_name text;
  v_reason text;
  v_score integer;
  v_payload jsonb;
  v_request oaq_private.admin_requests%rowtype;
  v_player oaq_private.players%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  v_name := oaq_private.normalize_name(p_name);
  v_reason := normalize(btrim(p_reason), NFC);
  if p_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision < 0
    or p_override_enabled is null or p_is_hidden is null
    or (p_override_score is not null and p_override_score not between 0 and 38)
    or v_reason is null or char_length(v_reason) not between 1 and 200
    or octet_length(v_reason) > 1024 or v_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_EDIT';
  end if;
  v_score := case when p_override_enabled then p_override_score else null end;
  v_payload := jsonb_build_object('id', p_id, 'name', v_name,
    'override_enabled', p_override_enabled, 'override_score', v_score,
    'is_hidden', p_is_hidden, 'expected_revision', p_expected_revision, 'reason', v_reason);

  -- Reserving and locking the request serializes retries, even across players.
  -- Failed validation/conflicts roll the reservation back with the transaction.
  insert into oaq_private.admin_requests(actor_id, request_id, payload)
    values (v_actor, p_request_id, v_payload) on conflict (actor_id, request_id) do nothing;
  select requests.* into v_request from oaq_private.admin_requests as requests
    where requests.actor_id = v_actor and requests.request_id = p_request_id for update;
  if v_request.payload <> v_payload then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUEST_CONFLICT';
  end if;
  if v_request.result is not null then return v_request.result; end if;

  select players.* into v_player from oaq_private.players as players where players.id = p_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'PLAYER_NOT_FOUND'; end if;
  if v_player.admin_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'ADMIN_CONFLICT';
  end if;
  v_before := oaq_private.admin_player_record(p_id);
  begin
    update oaq_private.players as players
      set name = v_name, name_key = lower(v_name),
          override_enabled = p_override_enabled, override_score = v_score,
          override_achieved_at = case
            when not p_override_enabled or v_score is null then null
            when players.override_enabled and players.override_score = v_score then players.override_achieved_at
            else now() end,
          is_hidden = p_is_hidden
      where players.id = p_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'NAME_TAKEN';
  end;
  v_after := oaq_private.admin_player_record(p_id);
  insert into oaq_private.admin_audit(player_id, actor_id, actor_email, request_id,
    action, before_data, after_data, reason)
    values (p_id, v_actor, v_email, p_request_id, 'update', v_before, v_after, v_reason);
  update oaq_private.admin_requests set result = v_after
    where actor_id = v_actor and request_id = p_request_id;
  return v_after;
end;
$$;

create or replace function public.oaq_admin_audit(p_player_id uuid default null, p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_total bigint; v_entries jsonb;
begin
  perform oaq_private.require_admin();
  if p_offset is null or p_offset not between 0 and 1000000
    or p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'INVALID_PAGE';
  end if;
  select count(*) into v_total from oaq_private.admin_audit as audit
    where p_player_id is null or audit.player_id = p_player_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', page.id, 'created_at', page.created_at, 'actor_email', page.actor_email,
      'player_name', page.after_data->>'name', 'action', page.action,
      'before', page.before_data, 'after', page.after_data, 'reason', page.reason)
      order by page.created_at desc, page.id desc), '[]'::jsonb)
    into v_entries
  from (
    select audit.* from oaq_private.admin_audit as audit
    where p_player_id is null or audit.player_id = p_player_id
    order by audit.created_at desc, audit.id desc limit p_limit offset p_offset
  ) as page;
  return jsonb_build_object('entries', v_entries, 'total', v_total);
end;
$$;

create or replace function public.oaq_top10()
returns table (rank bigint, name text, score integer, achieved_at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select row_number() over (order by ranked.score desc, ranked.achieved_at asc, ranked.id asc),
    ranked.name, ranked.score, ranked.achieved_at,
    exists (select 1 from oaq_private.player_bindings as bindings
      where bindings.player_id = ranked.id and bindings.user_id = auth.uid())
  from (
    select players.id, players.name,
      case when players.override_enabled then players.override_score else players.best_score end as score,
      case when players.override_enabled then players.override_achieved_at else players.achieved_at end as achieved_at
    from oaq_private.players as players where not players.is_hidden
  ) as ranked where ranked.score is not null
  order by ranked.score desc, ranked.achieved_at asc, ranked.id asc limit 10;
$$;

alter table oaq_private.admin_allowlist enable row level security;
alter table oaq_private.admin_requests enable row level security;
alter table oaq_private.admin_audit enable row level security;
revoke all on schema oaq_private from public, anon, authenticated;
revoke all on all tables in schema oaq_private from public, anon, authenticated;
revoke all on all sequences in schema oaq_private from public, anon, authenticated;
revoke all on all functions in schema oaq_private from public, anon, authenticated;
revoke all on function public.oaq_admin_status() from public, anon, authenticated;
revoke all on function public.oaq_admin_players(text, integer, integer) from public, anon, authenticated;
revoke all on function public.oaq_admin_save_player(uuid, text, boolean, integer, boolean, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.oaq_admin_audit(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.oaq_admin_status() to authenticated;
grant execute on function public.oaq_admin_players(text, integer, integer) to authenticated;
grant execute on function public.oaq_admin_save_player(uuid, text, boolean, integer, boolean, integer, uuid, text) to authenticated;
grant execute on function public.oaq_admin_audit(uuid, integer, integer) to authenticated;

commit;
