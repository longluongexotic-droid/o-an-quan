import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { completedPaths, MIGRATION_URL, withGeneratedSeed } from '../scripts/generate-leaderboard-paths.mjs';

// npm ci installs the pinned test dependency; CI can override its module path.
async function databaseModule() {
  if (process.env.OAQ_PGLITE_MODULE) return import(pathToFileURL(process.env.OAQ_PGLITE_MODULE).href);
  return import('@electric-sql/pglite');
}

test('terminal allowlist exactly follows the game engine, including early finishes', async () => {
  const paths = completedPaths();
  assert.equal(paths.length, 275);
  assert.equal(paths.filter(path => path.moves.length === 2).length, 3);
  assert.equal(new Set(paths.map(path => JSON.stringify(path.moves))).size, paths.length);
  assert.equal(Math.max(...paths.map(path => path.score)), 38);
  assert.equal(Math.min(...paths.map(path => path.score)), 0);
  const migration = await readFile(MIGRATION_URL, 'utf8');
  assert.equal(withGeneratedSeed(migration), migration, 'regenerate the seed after any rule change');
});

test('leaderboard RPC validates games, protects scores, and returns one best per player', async () => {
  const { PGlite } = await databaseModule();
  const db = new PGlite();
  const player = '00000000-0000-4000-8000-000000000001';
  const other = '00000000-0000-4000-8000-000000000002';
  const paths = completedPaths();
  const perfect = paths.find(path => path.score === 38);
  const zero = paths.find(path => path.score === 0);
  const early = paths.find(path => path.moves.length === 2);
  const submit = (name, moves) => db.query(
    'select public.oaq_submit_score($1,$2::jsonb) as result', [name, JSON.stringify(moves)]);
  const top = () => db.query('select * from public.oaq_top20()');
  async function as(role, uid, operation) {
    await db.exec('set role ' + role);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid ?? '']);
    try { return await operation(); }
    finally { await db.exec('reset role; reset request.jwt.claim.sub;'); }
  }
  async function rejectsCode(operation, code) {
    await assert.rejects(operation, error => error.code === code);
  }
  try {
    await db.exec(
      'create role anon nologin; create role authenticated nologin; create schema auth;' +
      'create table auth.users (id uuid primary key);' +
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;" +
      'grant usage on schema public,auth to anon,authenticated;' +
      'grant execute on function auth.uid() to anon,authenticated;');
    await db.query('insert into auth.users(id) values ($1),($2)', [player, other]);
    await db.exec(await readFile(MIGRATION_URL, 'utf8'));

    const seeded = await db.query('select moves,score from oaq_private.valid_paths');
    assert.equal(seeded.rows.length, paths.length);
    assert.deepEqual(
      seeded.rows.map(row => JSON.stringify(row)).sort(),
      paths.map(path => JSON.stringify({ moves: path.moves, score: path.score })).sort());
    await as('anon', null, async () => {
      assert.deepEqual((await top()).rows, []);
      await rejectsCode(() => submit('Khách', perfect.moves), '42501');
      await rejectsCode(() => db.query('select * from oaq_private.valid_paths'), '42501');
    });
    await as('authenticated', null, () => rejectsCode(() => submit('Khách', perfect.moves), '42501'));

    await as('authenticated', player, async () => {
      await rejectsCode(() => db.query('select * from oaq_private.scores'), '42501');
      await rejectsCode(() => db.query("insert into oaq_private.scores values ('ba-nuoc-v1',$1,'Fake',99,now())", [player]), '42501');
      const invalidMoves = [null, {}, [], perfect.moves.slice(0, 1), [...perfect.moves, perfect.moves[0]],
        perfect.moves.map((move, index) => index ? move : { ...move, score: 999 }),
        perfect.moves.map((move, index) => index ? move : { ...move, pit: 6 }),
        perfect.moves.map((move, index) => index ? move : { ...move, direction: 0 })];
      for (const moves of invalidMoves) await rejectsCode(() => submit('Người chơi', moves), '22023');
      for (const name of [null, '', '   ', 'a'.repeat(25), 'A\nB', 'A\tB', 'A\u200bB', 'A\u202eB', 'A\u{e0001}B']) {
        await rejectsCode(() => submit(name, perfect.moves), '22023');
      }
      const first = (await submit(' \u00a0Nguye\u0302\u0303n\u2003\u2009 An\u3000', zero.moves)).rows[0].result;
      assert.deepEqual(first, { score: 0, best_score: 0, improved: true });
      assert.equal((await top()).rows[0].name, 'Nguyễn An');
    });
    await db.query("update oaq_private.scores set achieved_at='2000-01-01T00:00:00Z' where user_id=$1", [player]);
    await as('authenticated', player, async () => {
      const improved = (await submit('Nguyễn An', perfect.moves)).rows[0].result;
      assert.deepEqual(improved, { score: 38, best_score: 38, improved: true });
    });
    const firstBest = (await db.query('select achieved_at from oaq_private.scores where user_id=$1', [player])).rows[0].achieved_at;
    assert.notEqual(firstBest.getUTCFullYear(), 2000, 'a better score gets a new achievement date');
    await as('authenticated', player, async () => {
      assert.deepEqual((await submit('Tên mới', zero.moves)).rows[0].result, { score: 0, best_score: 38, improved: false });
      assert.deepEqual((await submit('Tên mới', perfect.moves)).rows[0].result, { score: 38, best_score: 38, improved: false });
      const mine = (await top()).rows[0];
      assert.equal(mine.name, 'Tên mới');
      assert.equal(mine.is_me, true);
      assert.deepEqual(mine.achieved_at, firstBest);
      assert.deepEqual(Object.keys(mine), ['rank', 'name', 'score', 'achieved_at', 'is_me']);
    });
    await as('authenticated', other, async () => {
      assert.deepEqual((await submit('Tên mới', early.moves)).rows[0].result, { score: 28, best_score: 28, improved: true });
      const rows = (await top()).rows;
      assert.equal(rows.length, 2, 'same display name does not combine distinct people');
      assert.equal(rows[0].is_me, false);
      assert.equal(rows[1].is_me, true);
    });
    await as('anon', null, async () => {
      const rows = (await top()).rows;
      assert.equal(rows.length, 2);
      assert.ok(rows.every(row => row.is_me === false));
    });
    const total = (await db.query('select count(*)::int as total from oaq_private.scores')).rows[0].total;
    assert.equal(total, 2, 'invalid games and retries do not create extra leaderboard rows');
  } finally { await db.close(); }
});

test('top twenty uses score, first achievement time, and stable user ID ties', async () => {
  const { PGlite } = await databaseModule();
  const db = new PGlite();
  try {
    await db.exec(
      'create role anon nologin; create role authenticated nologin; create schema auth;' +
      'create table auth.users (id uuid primary key);' +
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;" +
      'grant usage on schema public,auth to anon,authenticated;' +
      'grant execute on function auth.uid() to anon,authenticated;');
    await db.exec(await readFile(MIGRATION_URL, 'utf8'));
    for (let index = 1; index <= 25; index++) {
      const uid = '00000000-0000-4000-8000-' + String(index).padStart(12, '0');
      await db.query('insert into auth.users(id) values ($1)', [uid]);
      await db.query("insert into oaq_private.scores values ('ba-nuoc-v1',$1,$2,$3,$4)",
        [uid, 'Người ' + index, index <= 2 ? 38 : 30, index === 2 ? '2026-10-08T00:00:00Z' : '2026-10-09T00:00:00Z']);
    }
    await db.exec('set role anon');
    const rows = (await db.query('select * from public.oaq_top20()')).rows;
    assert.equal(rows.length, 20);
    assert.deepEqual(rows.map(row => Number(row.rank)), Array.from({ length: 20 }, (_, index) => index + 1));
    assert.equal(rows[0].name, 'Người 2', 'earlier achievement wins equal score');
    assert.equal(rows[1].name, 'Người 1', 'higher score wins before timestamp ordering');
    assert.equal(rows[2].name, 'Người 3', 'equal score/time falls back to stable user UUID');
    assert.equal(rows[19].name, 'Người 20');
    assert.ok(rows.every(row => !Object.hasOwn(row, 'user_id')));
  } finally { await db.close(); }
});
