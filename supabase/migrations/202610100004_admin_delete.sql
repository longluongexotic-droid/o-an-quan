-- Permanent player deletion, restricted to verified administrators.
-- Preserve the administrative history even after the player no longer exists.
begin;

alter table oaq_private.admin_audit
  alter column player_id drop not null,
  alter column after_data drop not null,
  drop constraint if exists admin_audit_player_id_fkey,
  drop constraint if exists admin_audit_action_check;
alter table oaq_private.admin_audit
  add constraint admin_audit_player_id_fkey
    foreign key (player_id) references oaq_private.players(id) on delete set null,
  add constraint admin_audit_action_check check (action in ('update', 'delete'));
create index if not exists oaq_admin_audit_deleted_player
  on oaq_private.admin_audit ((before_data->>'id'), created_at desc, id desc)
  where player_id is null;

create or replace function public.oaq_admin_delete_player(
  p_id uuid,
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
  v_reason text := normalize(btrim(p_reason), NFC);
  v_payload jsonb;
  v_request oaq_private.admin_requests%rowtype;
  v_player oaq_private.players%rowtype;
  v_before jsonb;
  v_result jsonb;
begin
  if p_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision < 0
    or v_reason is null or char_length(v_reason) not between 1 and 200
    or octet_length(v_reason) > 1024 or v_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_EDIT';
  end if;
  v_payload := jsonb_build_object('action', 'delete', 'id', p_id,
    'expected_revision', p_expected_revision, 'reason', v_reason);

  -- Share the save RPC's per-actor request namespace. A lost response can be
  -- retried safely after deletion, without deleting a newly registered name.
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
  v_result := jsonb_build_object('id', p_id, 'name', v_player.name, 'deleted', true);

  -- The retired v1 table is an import source when the Kỳ Lộ migration is
  -- rerun. Remove only this puzzle's old submissions associated with the
  -- deleted player's bindings, so that those submissions cannot restore it.
  delete from oaq_private.scores as scores
    using oaq_private.player_bindings as bindings
    where scores.level_id = 'ba-nuoc-v1'
      and scores.user_id = bindings.user_id and bindings.player_id = p_id;
  delete from oaq_private.game_requests where player_id = p_id;
  delete from oaq_private.games where player_id = p_id;
  delete from oaq_private.player_bindings where player_id = p_id;
  insert into oaq_private.admin_audit(player_id, actor_id, actor_email, request_id,
    action, before_data, after_data, reason)
    values (p_id, v_actor, v_email, p_request_id, 'delete', v_before, null, v_reason);
  delete from oaq_private.players where id = p_id;

  update oaq_private.admin_requests set result = v_result
    where actor_id = v_actor and request_id = p_request_id;
  return v_result;
end;
$$;

-- A start may read its binding just before an administrator deletes the
-- player. Recheck after acquiring the player lock instead of using a null
-- attempt count when that delete commits while the start is waiting.
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
  if not found then raise exception using errcode = 'P0001', message = 'NAME_REQUIRED'; end if;
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
  -- Preserve resume aliases, so a retry cannot charge another attempt.
  insert into oaq_private.game_requests(player_id, request_id, game_id) values (v_player, p_request_id, v_game);
  return oaq_private.player_profile(v_player);
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
    where p_player_id is null or audit.player_id = p_player_id
      or (audit.player_id is null and audit.before_data->>'id' = p_player_id::text);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', page.id, 'created_at', page.created_at, 'actor_email', page.actor_email,
      'player_name', coalesce(page.after_data->>'name', page.before_data->>'name'), 'action', page.action,
      'before', page.before_data, 'after', page.after_data, 'reason', page.reason)
      order by page.created_at desc, page.id desc), '[]'::jsonb)
    into v_entries
  from (
    select audit.* from oaq_private.admin_audit as audit
    where p_player_id is null or audit.player_id = p_player_id
      or (audit.player_id is null and audit.before_data->>'id' = p_player_id::text)
    order by audit.created_at desc, audit.id desc limit p_limit offset p_offset
  ) as page;
  return jsonb_build_object('entries', v_entries, 'total', v_total);
end;
$$;

revoke all on function public.oaq_admin_delete_player(uuid, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.oaq_admin_delete_player(uuid, integer, uuid, text) to authenticated;
revoke all on function public.oaq_admin_audit(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.oaq_admin_audit(uuid, integer, integer) to authenticated;

commit;
