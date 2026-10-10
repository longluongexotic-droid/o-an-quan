import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { completedPaths, MIGRATION_URL } from '../scripts/generate-leaderboard-paths.mjs';

const V2_URL = new URL('../supabase/migrations/202610100001_ky_lo.sql', import.meta.url);
const ADMIN_URL = new URL('../supabase/migrations/202610100002_admin.sql', import.meta.url);
const uid = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const ADMIN = uid(30);
const perfect = completedPaths().find(path => path.score === 38);
const early = completedPaths().find(path => path.score === 28 && path.moves.length === 2);

async function setup(legacy = []) {
  const module = process.env.OAQ_PGLITE_MODULE
    ? await import(pathToFileURL(process.env.OAQ_PGLITE_MODULE).href)
    : await import('@electric-sql/pglite');
  const db = new module.PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz,
      is_anonymous boolean default false, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;`);
  for (let index = 1; index <= 30; index++) {
    await db.query('insert into auth.users(id,is_anonymous) values ($1,true)', [uid(index)]);
  }
  await db.query(`update auth.users set email='Admin@example.com',
    email_confirmed_at=now(),is_anonymous=false where id=$1`, [ADMIN]);
  await db.exec(await readFile(MIGRATION_URL, 'utf8'));
  for (const row of legacy) await db.query("insert into oaq_private.scores values ('ba-nuoc-v1',$1,$2,$3,$4)", row);
  await db.exec(await readFile(V2_URL, 'utf8'));
  await db.exec(await readFile(ADMIN_URL, 'utf8'));
  await db.query("insert into oaq_private.admin_allowlist(email) values ('admin@example.com')");
  const call = async (sql, params = []) => (await db.query('select ' + sql + ' as result', params)).rows[0].result;
  const status = () => call('public.oaq_admin_status()');
  const list = (search = '', offset = 0, limit = 25) => call('public.oaq_admin_players($1,$2,$3)', [search, offset, limit]);
  const audit = (player = null, offset = 0, limit = 25) => call('public.oaq_admin_audit($1,$2,$3)', [player, offset, limit]);
  const save = (row, patch = {}, request = uid(101), reason = 'Điều chỉnh theo kết quả sự kiện') => {
    const target = { ...row, ...patch };
    return call('public.oaq_admin_save_player($1,$2,$3,$4,$5,$6,$7,$8)',
      [target.id, target.name, target.override_enabled, target.override_score,
        target.is_hidden, target.revision, request, reason]);
  };
  const playerStatus = () => call('public.oaq_player_status()');
  const register = name => call('public.oaq_register_player($1)', [name]);
  const start = request => call('public.oaq_start_game($1)', [request]);
  const move = (game, expected, next) => call('public.oaq_play_move($1,$2::jsonb,$3::jsonb)',
    [game, JSON.stringify(expected), JSON.stringify(next)]);
  async function finish(profile, path = perfect) {
    for (let index = profile.active_game.moves.length; index < path.moves.length; index++) {
      profile = await move(profile.active_game.id, path.moves.slice(0, index), path.moves[index]);
    }
    return profile;
  }
  async function as(role, user, operation) {
    await db.exec('set role ' + role);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? '']);
    try { return await operation(); }
    finally { await db.exec('reset role; reset request.jwt.claim.sub;'); }
  }
  return { db, as, call, status, list, audit, save, playerStatus, register, start, move, finish };
}

async function rejectsMessage(operation, message, code = 'P0001') {
  await assert.rejects(operation, error => error.code === code && error.message === message);
}

test('only the verified non-anonymous allowlisted auth.users email may administer; metadata cannot grant access', async () => {
  const { db, as, status, list, audit, call } = await setup();
  try {
    await db.query(`update auth.users set email='admin@example.com',is_anonymous=false where id=$1`, [uid(2)]);
    await db.query(`update auth.users set email='admin@example.com',email_confirmed_at=now() where id=$1`, [uid(3)]);
    await db.query(`update auth.users set email='other@example.com',email_confirmed_at=now(),is_anonymous=false,
      raw_user_meta_data='{"email":"admin@example.com","role":"admin"}' where id=$1`, [uid(4)]);
    await as('anon', null, async () => {
      for (const operation of [status, list, audit]) await assert.rejects(operation, error => error.code === '42501');
    });
    for (const user of [null, uid(1), uid(2), uid(3), uid(4)]) {
      await as('authenticated', user, async () => {
        for (const operation of [status, list, audit,
          () => call('public.oaq_admin_save_player($1,null,null,null,null,null,null,null)', [uid(99)])]) {
          await rejectsMessage(operation, 'ADMIN_REQUIRED', '42501');
        }
      });
    }
    await as('authenticated', ADMIN, async () => {
      assert.deepEqual(await status(), { email: 'admin@example.com' });
      assert.deepEqual(await list(), { players: [], total: 0 });
      for (const table of ['admin_allowlist', 'admin_requests', 'admin_audit', 'players']) {
        await assert.rejects(() => db.query('select * from oaq_private.' + table), error => error.code === '42501');
      }
      await assert.rejects(() => db.query('select oaq_private.require_admin()'), error => error.code === '42501');
    });
    await db.query('update auth.users set email_confirmed_at=null where id=$1', [ADMIN]);
    await as('authenticated', ADMIN, () => rejectsMessage(status, 'ADMIN_REQUIRED', '42501'));
  } finally { await db.close(); }
});

test('admin ranking overrides, normalized names and reversible visibility preserve canonical scores, games and limits', async () => {
  const { db, as, list, save, audit, register, start, finish, playerStatus } = await setup();
  let original;
  let edited;
  try {
    await as('authenticated', uid(1), async () => {
      await register('Nguyễn An');
      original = await finish(await start(uid(101)));
      assert.equal(original.best_score, 38);
    });
    await as('authenticated', ADMIN, async () => {
      const row = (await list()).players[0];
      assert.equal(row.best_score, 38);
      edited = await save(row, { name: '  Nguye\u0302\u0303n Ánh  ', override_enabled: true, override_score: 13 }, uid(102));
      assert.equal(edited.name, 'Nguyễn Ánh');
      assert.equal(edited.effective_score, 13);
      assert.equal(edited.best_score, 38);
      assert.equal(edited.attempts_used, 1);
      assert.equal(edited.revision, row.revision + 1);
      assert.ok(edited.achieved_at);
      edited = await save(edited, { is_hidden: true }, uid(103), 'Ẩn nhầm bài gửi');
      assert.equal(edited.is_hidden, true);
    });
    await as('anon', null, async () => assert.deepEqual((await db.query('select * from public.oaq_top10()')).rows, []));
    await as('authenticated', uid(1), async () => {
      const profile = await playerStatus();
      assert.deepEqual(profile, { ...original, name: 'Nguyễn Ánh' });
      await rejectsMessage(() => register('Tên mới'), 'NAME_LOCKED');
      assert.equal((await start(uid(104))).attempts_used, 2);
    });
    await as('authenticated', ADMIN, async () => {
      edited = (await list()).players[0];
      edited = await save(edited, { is_hidden: false, override_score: null }, uid(105), 'Tạm xóa điểm hiển thị');
      assert.equal(edited.effective_score, null);
      assert.equal(edited.best_score, 38);
      edited = await save(edited, { override_enabled: false, override_score: 13 }, uid(106), 'Khôi phục điểm từ trò chơi');
      assert.equal(edited.effective_score, 38);
      assert.equal(edited.override_score, null);
      const history = await audit(edited.id);
      assert.equal(history.total, 4);
      assert.equal(history.entries[0].reason, 'Khôi phục điểm từ trò chơi');
      assert.equal(history.entries[0].actor_email, 'admin@example.com');
      assert.equal(history.entries.at(-1).before.name, 'Nguyễn An');
      assert.equal(history.entries.at(-1).after.name, 'Nguyễn Ánh');
    });
    await as('anon', null, async () => {
      const [row] = (await db.query('select * from public.oaq_top10()')).rows;
      assert.equal(row.name, 'Nguyễn Ánh');
      assert.equal(row.score, 38);
      assert.deepEqual(Object.keys(row), ['rank', 'name', 'score', 'achieved_at', 'is_me']);
    });
    assert.equal((await db.query('select count(*)::int as count from oaq_private.games')).rows[0].count, 2);
  } finally { await db.close(); }
});

test('admin retries are idempotent, stale writes conflict, and invalid edits roll back requests and audit', async () => {
  const { db, as, list, save, audit, register, call } = await setup();
  try {
    await as('authenticated', uid(1), () => register('An'));
    await as('authenticated', uid(2), () => register('Bình'));
    await as('authenticated', ADMIN, async () => {
      const row = (await list('An')).players[0];
      const changed = await save(row, { override_enabled: true, override_score: 0 }, uid(101));
      assert.deepEqual(await save(row, { override_enabled: true, override_score: 0 }, uid(101)), changed);
      await rejectsMessage(() => save(row, { override_enabled: true, override_score: 2 }, uid(101)), 'ADMIN_REQUEST_CONFLICT');
      await rejectsMessage(() => save(row, { is_hidden: true }, uid(102)), 'ADMIN_CONFLICT');
      await rejectsMessage(() => save(changed, { name: 'BÌNH' }, uid(103)), 'NAME_TAKEN');
      for (const [patch, reason] of [
        [{ override_score: -1 }, 'Điểm sai'], [{ override_score: 39 }, 'Điểm sai'],
        [{ override_enabled: null }, 'Sai lựa chọn'], [{ is_hidden: null }, 'Sai lựa chọn'],
        [{ revision: -1 }, 'Sai phiên bản'], [{}, ''], [{}, 'x'.repeat(201)], [{}, 'Dòng\nkhác'],
      ]) await rejectsMessage(() => save(changed, patch, uid(104), reason), 'INVALID_ADMIN_EDIT', '22023');
      await rejectsMessage(() => save(changed, { name: 'x'.repeat(25) }, uid(104)), 'INVALID_NAME', '22023');
      await rejectsMessage(() => save(changed, { id: uid(900) }, uid(104)), 'PLAYER_NOT_FOUND');
      await rejectsMessage(() => call('public.oaq_admin_save_player($1,$2,false,null,false,0,null,$3)',
        [changed.id, changed.name, 'Thiếu mã yêu cầu']), 'INVALID_ADMIN_EDIT', '22023');
      assert.equal((await audit()).total, 1);
      assert.equal((await list('An')).players[0].revision, changed.revision);
    });
    assert.equal((await db.query('select count(*)::int as count from oaq_private.admin_requests')).rows[0].count, 1);
    assert.equal((await db.query('select count(*)::int as count from oaq_private.admin_audit')).rows[0].count, 1);
  } finally { await db.close(); }
});

test('a game played while an editor is open invalidates that editor and never overwrites a deliberate ranking override', async () => {
  const { db, as, list, save, register, start, finish, playerStatus } = await setup();
  let stale;
  let profile;
  try {
    await as('authenticated', uid(1), () => register('Đang chơi'));
    await as('authenticated', ADMIN, async () => { stale = (await list()).players[0]; });
    await as('authenticated', uid(1), async () => { profile = await finish(await start(uid(101)), early); });
    await as('authenticated', ADMIN, async () => {
      await rejectsMessage(() => save(stale, { is_hidden: true }, uid(102)), 'ADMIN_CONFLICT');
      const current = (await list()).players[0];
      assert.ok(current.revision > stale.revision);
      await save(current, { override_enabled: true, override_score: 10 }, uid(103));
    });
    await as('authenticated', uid(1), async () => {
      profile = await finish(await start(uid(104)));
      assert.equal(profile.best_score, 38);
      assert.equal(profile.attempts_used, 2);
      assert.deepEqual(await playerStatus(), profile);
    });
    await as('authenticated', ADMIN, async () => {
      const row = (await list()).players[0];
      assert.equal(row.effective_score, 10);
      assert.equal(row.best_score, 38);
      assert.equal(row.attempts_used, 2);
    });
    await as('anon', null, async () => assert.equal((await db.query('select * from public.oaq_top10()')).rows[0].score, 10));
  } finally { await db.close(); }
});

test('all players are searchable and paginated, public ranking stays top ten, and migration reruns preserve overrides and audit', async () => {
  const legacy = Array.from({ length: 15 }, (_, index) => [uid(index + 1), 'Người ' + (index + 1),
    38 - index, '2026-10-09T00:00:00Z']);
  const { db, as, list, save, audit } = await setup(legacy);
  let after;
  try {
    await as('authenticated', ADMIN, async () => {
      const first = await list('', 0, 5);
      const second = await list('', 5, 5);
      assert.equal(first.total, 15);
      assert.equal(first.players.length, 5);
      assert.equal(new Set([...first.players, ...second.players].map(row => row.id)).size, 10);
      assert.equal((await list('', 15)).players.length, 0);
      assert.equal((await list('NGƯỜI 15')).players[0].name, 'Người 15');
      assert.equal((await list('%')).total, 0, 'search is literal, not a wildcard expression');
      for (const [offset, limit] of [[-1, 25], [0, 0], [0, 101], [null, 25], [1000001, 1]]) {
        await rejectsMessage(() => list('', offset, limit), 'INVALID_PAGE', '22023');
        await rejectsMessage(() => audit(null, offset, limit), 'INVALID_PAGE', '22023');
      }
      await rejectsMessage(() => list('a'.repeat(81)), 'INVALID_PAGE', '22023');
      after = await save(first.players[0], { is_hidden: true }, uid(101), 'Ẩn để kiểm tra lại');
      const ranked = (await db.query('select * from public.oaq_top10()')).rows;
      assert.equal(ranked.length, 10);
      assert.equal(ranked[0].name, 'Người 2');
      assert.deepEqual(ranked.map(row => Number(row.rank)), Array.from({ length: 10 }, (_, index) => index + 1));
    });
    await db.exec(await readFile(ADMIN_URL, 'utf8'));
    await as('authenticated', ADMIN, async () => {
      assert.deepEqual((await list('Người 1')).players.find(row => row.id === after.id), after);
      assert.equal((await audit(after.id)).total, 1);
      assert.equal((await audit(uid(900))).total, 0);
    });
    assert.equal((await db.query('select count(*)::int as count from oaq_private.scores')).rows[0].count, 15);
    const acl = (await db.query(`select p.proname,p.prosecdef,p.proconfig from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'oaq_admin_%'`)).rows;
    assert.equal(acl.length, 4);
    assert.ok(acl.every(row => row.prosecdef && row.proconfig.includes('search_path=""')));
  } finally { await db.close(); }
});
