import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { completedPaths, MIGRATION_URL } from '../scripts/generate-leaderboard-paths.mjs';

const V2_URL = new URL('../supabase/migrations/202610100001_ky_lo.sql', import.meta.url);
const uid = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const paths = completedPaths();
const perfect = paths.find(path => path.score === 38);
const early = paths.find(path => path.moves.length === 2);
const zero = paths.find(path => path.score === 0);

async function setup(legacy = []) {
  const module = process.env.OAQ_PGLITE_MODULE
    ? await import(pathToFileURL(process.env.OAQ_PGLITE_MODULE).href)
    : await import('@electric-sql/pglite');
  const db = new module.PGlite();
  await db.exec(
    'create role anon nologin; create role authenticated nologin; create schema auth;' +
    'create table auth.users (id uuid primary key);' +
    "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;" +
    'grant usage on schema public,auth to anon,authenticated;' +
    'grant execute on function auth.uid() to anon,authenticated;');
  for (let index = 1; index <= 30; index++) await db.query('insert into auth.users(id) values ($1)', [uid(index)]);
  await db.exec(await readFile(MIGRATION_URL, 'utf8'));
  for (const row of legacy) {
    await db.query("insert into oaq_private.scores values ('ba-nuoc-v1',$1,$2,$3,$4)", row);
  }
  await db.exec(await readFile(V2_URL, 'utf8'));
  const call = async (sql, params = []) => (await db.query('select ' + sql + ' as result', params)).rows[0].result;
  const status = () => call('public.oaq_player_status()');
  const register = name => call('public.oaq_register_player($1)', [name]);
  const start = request => call('public.oaq_start_game($1)', [request]);
  const move = (game, expected, next) => call('public.oaq_play_move($1,$2::jsonb,$3::jsonb)',
    [game, JSON.stringify(expected), JSON.stringify(next)]);
  async function as(role, user, operation) {
    await db.exec('set role ' + role);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? '']);
    try { return await operation(); }
    finally { await db.exec('reset role; reset request.jwt.claim.sub;'); }
  }
  async function finish(profile, path) {
    const game = profile.active_game.id;
    for (let index = 0; index < path.moves.length; index++) profile = await move(game, path.moves.slice(0, index), path.moves[index]);
    return profile;
  }
  return { db, call, status, register, start, move, as, finish };
}

async function rejectsMessage(operation, message, code = 'P0001') {
  await assert.rejects(operation, error => error.code === code && error.message === message);
}

test('names are global, normalized, immutable, and not reclaimable with a new guest', async () => {
  const { db, as, status, register, start } = await setup();
  try {
    await as('authenticated', uid(1), async () => {
      assert.equal(await status(), null);
      await rejectsMessage(() => start(uid(100)), 'NAME_REQUIRED');
      for (const name of ['', ' '.repeat(3), null, 'a'.repeat(25), 'A\nB', 'A\u200bB']) {
        await rejectsMessage(() => register(name), 'INVALID_NAME', '22023');
      }
      const profile = await register(' \u00a0Nguye\u0302\u0303n\u2003 An ');
      assert.deepEqual(profile, { name: 'Nguyễn An', attempts_used: 0, attempts_left: 3, best_score: null, active_game: null });
      assert.deepEqual(await register('NGUYỄN AN'), profile, 'same normalized key preserves the original display name');
      await rejectsMessage(() => register('Tên khác'), 'NAME_LOCKED');
      assert.deepEqual(await status(), profile);
    });
    await as('authenticated', uid(2), () => rejectsMessage(() => register('nguyễn an'), 'NAME_TAKEN'));
    assert.equal((await db.query('select count(*)::int as count from oaq_private.players')).rows[0].count, 1);
    await db.query('delete from auth.users where id=$1', [uid(1)]);
    await as('authenticated', uid(3), () => rejectsMessage(() => register('Nguyễn An'), 'NAME_TAKEN'));
  } finally { await db.close(); }
});

test('a name receives at most three started games; start retries and parallel requests consume once', async () => {
  const { db, as, register, status, start, finish } = await setup();
  try {
    await as('authenticated', uid(1), async () => {
      await register('Ba ván');
      const simultaneous = await Promise.all([start(uid(101)), start(uid(102)), start(uid(101))]);
      assert.ok(simultaneous.every(profile => profile.attempts_used === 1));
      const game = simultaneous[0].active_game.id;
      assert.ok(simultaneous.every(profile => profile.active_game.id === game));
      assert.equal((await status()).active_game.id, game, 'reload resumes the canonical game');
      let profile = await finish(simultaneous[0], early);
      assert.equal(profile.active_game.status, 'completed');
      assert.equal(profile.active_game.score, 28);
      assert.equal((await start(uid(102))).attempts_used, 1, 'retry of a resume request after completion does not charge again');
      profile = await start(uid(103));
      assert.equal(profile.attempts_used, 2);
      profile = await finish(profile, perfect);
      assert.equal(profile.best_score, 38);
      profile = await start(uid(104));
      assert.equal(profile.attempts_used, 3);
      assert.equal(profile.attempts_left, 0);
      assert.equal((await start(uid(105))).active_game.id, profile.active_game.id, 'the third active game can still resume at the limit');
      profile = await finish(profile, zero);
      assert.equal(profile.best_score, 38);
      assert.equal((await start(uid(105))).attempts_used, 3);
      await rejectsMessage(() => start(uid(106)), 'ATTEMPT_LIMIT');
      assert.deepEqual(await status(), profile);
    });
    assert.equal((await db.query('select count(*)::int as count from oaq_private.games')).rows[0].count, 3);
  } finally { await db.close(); }
});

test('canonical move progress rejects resets, branches, fabricated moves, other players, and stale retries', async () => {
  const { db, as, register, start, status, move } = await setup();
  let game;
  try {
    await as('authenticated', uid(1), async () => {
      await register('Tiến từng nước');
      let profile = await start(uid(101));
      game = profile.active_game.id;
      for (const bad of [null, [], { pit: 6, direction: 1 }, { ...perfect.moves[0], score: 99 }, { pit: 9, direction: 0 }]) {
        await rejectsMessage(() => move(game, [], bad), 'INVALID_MOVE');
      }
      profile = await move(game, [], perfect.moves[0]);
      assert.equal(profile.active_game.status, 'active');
      assert.deepEqual(profile.active_game.moves, perfect.moves.slice(0, 1));
      assert.deepEqual(await move(game, [], perfect.moves[0]), profile, 'same committed move retry is idempotent');
      assert.deepEqual(await status(), profile);
      await rejectsMessage(() => move(game, [], { pit: 7, direction: 1 }), 'GAME_CONFLICT');
      await rejectsMessage(() => move(game, profile.active_game.moves, { pit: 6, direction: 1 }), 'INVALID_MOVE');
      profile = await move(game, perfect.moves.slice(0, 1), perfect.moves[1]);
      await rejectsMessage(() => move(game, [], perfect.moves[0]), 'GAME_CONFLICT');
      assert.deepEqual((await start(uid(102))).active_game.moves, perfect.moves.slice(0, 2));
      const final = await move(game, perfect.moves.slice(0, 2), perfect.moves[2]);
      assert.equal(final.active_game.status, 'completed');
      assert.equal(final.active_game.score, 38);
      assert.deepEqual(await move(game, perfect.moves.slice(0, 2), perfect.moves[2]), final);
      await rejectsMessage(() => move(game, perfect.moves.slice(0, 2), { pit: 11, direction: 1 }), 'GAME_CONFLICT');
      const date = (await db.query('select achieved_at from public.oaq_top10()')).rows[0].achieved_at;
      await move(game, perfect.moves.slice(0, 2), perfect.moves[2]);
      assert.deepEqual((await db.query('select achieved_at from public.oaq_top10()')).rows[0].achieved_at, date);
    });
    await as('authenticated', uid(2), async () => {
      await register('Người khác');
      await rejectsMessage(() => move(game, [], perfect.moves[0]), 'GAME_CONFLICT');
    });
  } finally { await db.close(); }
});

test('legacy duplicates preserve maximum score, earliest attainment, original identities, and a shared remaining quota', async () => {
  const legacy = [
    [uid(1), ' Nguyễn An ', 28, '2026-10-09T10:00:00Z'],
    [uid(2), 'NGUYỄN AN', 38, '2026-10-09T12:00:00Z'],
    [uid(3), 'nguye\u0302\u0303n an', 38, '2026-10-09T11:00:00Z'],
    [uid(4), 'Bình', 19, '2026-10-09T09:00:00Z'],
  ];
  const { db, as, status, start, finish, register } = await setup(legacy);
  let shared;
  try {
    for (const user of [uid(1), uid(2), uid(3)]) {
      await as('authenticated', user, async () => {
        const profile = await status();
        assert.equal(profile.name, 'nguyễn an');
        assert.equal(profile.best_score, 38);
        assert.equal(profile.attempts_used, 1);
        assert.equal(profile.attempts_left, 2);
        assert.equal(profile.active_game, null);
        const rows = (await db.query('select * from public.oaq_top10()')).rows;
        assert.equal(rows[0].is_me, true);
        assert.equal(rows[0].achieved_at.toISOString(), '2026-10-09T11:00:00.000Z');
      });
    }
    assert.equal((await db.query('select count(*)::int as count from oaq_private.players')).rows[0].count, 2);
    await as('authenticated', uid(5), () => rejectsMessage(() => register('Nguyễn An'), 'NAME_TAKEN'));
    await as('authenticated', uid(1), async () => { shared = await start(uid(101));assert.equal(shared.attempts_used, 2); });
    await as('authenticated', uid(2), async () => {
      assert.deepEqual(await start(uid(102)), shared);
      shared = await finish(shared, early);
      assert.equal(shared.best_score, 38);
    });
    await as('authenticated', uid(3), async () => {
      shared = await finish(await start(uid(103)), zero);
      assert.equal(shared.attempts_used, 3);
      await rejectsMessage(() => start(uid(104)), 'ATTEMPT_LIMIT');
    });
    await db.exec(await readFile(V2_URL, 'utf8'));
    await as('authenticated', uid(1), async () => { assert.deepEqual(await status(), shared); });
    assert.equal((await db.query('select count(*)::int as count from oaq_private.scores')).rows[0].count, legacy.length, 'v1 scores remain intact');
  } finally { await db.close(); }
});

test('top ten is public, tie order is stable, private progress is locked, and v1 score writes are retired', async () => {
  const legacy = Array.from({ length: 15 }, (_, index) => [uid(index + 1), 'Hạng ' + (index + 1),
    index < 2 ? 38 : 28, index === 1 ? '2026-10-08T00:00:00Z' : '2026-10-09T00:00:00Z']);
  const { db, as, register, start, move, status } = await setup(legacy);
  try {
    await as('anon', null, async () => {
      const rows = (await db.query('select * from public.oaq_top10()')).rows;
      assert.equal(rows.length, 10);
      assert.deepEqual(rows.map(row => Number(row.rank)), Array.from({ length: 10 }, (_, index) => index + 1));
      assert.equal(rows[0].name, 'Hạng 2');
      assert.equal(rows[1].name, 'Hạng 1');
      assert.ok(rows.every(row => row.is_me === false));
      assert.deepEqual(Object.keys(rows[0]), ['rank', 'name', 'score', 'achieved_at', 'is_me']);
      assert.deepEqual((await db.query('select * from public.oaq_top20()')).rows, rows);
      for (const operation of [status, () => register('Khách'), () => start(uid(101)), () => move(uid(102), [], perfect.moves[0])]) {
        await assert.rejects(operation, error => error.code === '42501');
      }
    });
    await as('authenticated', uid(1), async () => {
      for (const table of ['players', 'player_bindings', 'games', 'game_requests', 'valid_prefixes', 'valid_paths', 'scores']) {
        await assert.rejects(() => db.query('select * from oaq_private.' + table), error => error.code === '42501');
      }
      await assert.rejects(() => db.query("select public.oaq_submit_score('Cheat',$1::jsonb)", [JSON.stringify(perfect.moves)]), error => error.code === '42501');
      await assert.rejects(() => db.query('select oaq_private.player_profile($1)', [uid(1)]), error => error.code === '42501');
    });
    const acl = await db.query("select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('oaq_player_status','oaq_register_player','oaq_start_game','oaq_play_move','oaq_top10')");
    assert.equal(acl.rows.length, 5);
    assert.ok(acl.rows.every(row => row.prosecdef && row.proconfig.includes('search_path=""')));
  } finally { await db.close(); }
});
