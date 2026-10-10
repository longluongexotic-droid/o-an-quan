import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPABASE_CONFIG } from '../docs/leaderboard-config.mjs';

const PROJECT_URL = 'https://testproject.supabase.co';
const STORAGE_KEY = 'oaq:leaderboard:session:testproject.supabase.co';
const USER_ID = '11111111-2222-3333-4444-555555555555';
const GAME_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const REQUEST_ID = '01234567-89ab-cdef-0123-456789abcdef';
const MOVES = [{ pit: 9, direction: -1 }, { pit: 7, direction: 1 }, { pit: 7, direction: -1 }];
let importNumber = 0;

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function authResponse(overrides = {}) {
  return {
    access_token: 'dummy-access-token', refresh_token: 'dummy-refresh-token',
    expires_in: 3600, user: { id: USER_ID }, ...overrides,
  };
}

function savedSession(overrides = {}) {
  return {
    access_token: 'dummy-old-access', refresh_token: 'dummy-old-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600, user_id: USER_ID, ...overrides,
  };
}

function row(overrides = {}) {
  return { rank: 1, name: 'Nguyễn An', score: 38, achieved_at: '2026-10-09T00:00:00.123456+00:00', is_me: false, ...overrides };
}

function game(overrides = {}) {
  return { id: GAME_ID, moves: [], status: 'active', score: null, ...overrides };
}

function profile(overrides = {}) {
  return { name: 'Nguyễn An', attempts_used: 0, attempts_left: 3, best_score: null, active_game: null, ...overrides };
}

async function fixture(t, { initialStorage, blockedStorage = false, fetch } = {}) {
  const originalConfig = { ...SUPABASE_CONFIG };
  const originals = new Map(['fetch', 'localStorage', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    Object.assign(SUPABASE_CONFIG, originalConfig);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  Object.assign(SUPABASE_CONFIG, { url: PROJECT_URL, publicKey: 'sb_publishable_dummy_test_key' });
  const storage = new Map(initialStorage ? [[STORAGE_KEY, initialStorage]] : []);
  if (blockedStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage is blocked'); } });
  } else {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    } });
  }
  // No browser or real Supabase project is contacted. Every credential is a dummy.
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch ?? (async () => {
    assert.fail('Unexpected network request');
  }) });
  const moduleUrl = new URL('../docs/leaderboard.mjs', import.meta.url);
  moduleUrl.searchParams.set('client-test', String(++importNumber));
  return { client: await import(moduleUrl.href), storage };
}

test('names normalize NFC and spaces, count Unicode code points, and reject controls', async t => {
  const { client } = await fixture(t);
  assert.equal(client.normalizePlayerName('  Nguyê\u0303n\u00a0 \u2002An  '), 'Nguyễn An');
  assert.equal(client.normalizePlayerName('🙂'.repeat(24)), '🙂'.repeat(24));
  assert.equal(client.normalizePlayerName('An <b>'), 'An <b>'); // Rendered as text by the UI.
  for (const name of ['', '   ', '🙂'.repeat(25), 'An\nBình', 'An\tBình', 'An\u007fBình', 'An\u200bBình', 'An\u202eBình']) {
    assert.throws(() => client.normalizePlayerName(name), error => error.code === 'INVALID_NAME');
  }
});

test('a corrupt saved session is preserved and never replaced with a new guest', async t => {
  const corrupt = '{invalid-json';
  let networkCalls = 0;
  const { client, storage } = await fixture(t, { initialStorage: corrupt, fetch: async () => { networkCalls++; return response(authResponse()); } });
  await assert.rejects(client.getPlayerStatus(), error => error.code === 'SESSION_INVALID');
  assert.equal(networkCalls, 0);
  assert.equal(storage.get(STORAGE_KEY), corrupt);
});

test('an expired guest refreshes without changing its user ID', async t => {
  const calls = [];
  const { client, storage } = await fixture(t, {
    initialStorage: JSON.stringify(savedSession({ expires_at: 1 })),
    fetch: async (url, options) => {
      calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      if (url.includes('/auth/v1/token?')) return response(authResponse({ access_token: 'dummy-new-access', refresh_token: 'dummy-new-refresh' }));
      return response(profile());
    },
  });
  assert.deepEqual(await client.getPlayerStatus(), profile());
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${PROJECT_URL}/auth/v1/token?grant_type=refresh_token`);
  assert.deepEqual(calls[0].body, { refresh_token: 'dummy-old-refresh' });
  assert.equal(calls[1].headers.Authorization, 'Bearer dummy-new-access');
  const saved = JSON.parse(storage.get(STORAGE_KEY));
  assert.equal(saved.user_id, USER_ID);
  assert.equal(saved.refresh_token, 'dummy-new-refresh');
});

test('failed refresh preserves the guest and never signs up a replacement', async t => {
  const initial = JSON.stringify(savedSession({ expires_at: 1 }));
  const urls = [];
  const { client, storage } = await fixture(t, { initialStorage: initial, fetch: async url => {
    urls.push(url);
    return response({ error_code: 'refresh_token_not_found' }, 400);
  } });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(client.getPlayerStatus(), error => error.code === 'SESSION_EXPIRED');
  }
  assert.equal(urls.length, 2);
  assert(urls.every(url => url.includes('grant_type=refresh_token')));
  assert.equal(storage.get(STORAGE_KEY), initial);
});

test('a refresh response for a different user cannot overwrite the stored identity', async t => {
  const initial = JSON.stringify(savedSession({ expires_at: 1 }));
  const { client, storage } = await fixture(t, { initialStorage: initial, fetch: async () => response(authResponse({
    user: { id: 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee' },
  })) });
  await assert.rejects(client.getPlayerStatus(), error => error.code === 'INVALID_RESPONSE');
  assert.equal(storage.get(STORAGE_KEY), initial);
});

test('initial status creates one guest but does not register or start a game', async t => {
  const calls = [];
  const { client } = await fixture(t, { fetch: async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return response(url.endsWith('/signup') ? authResponse() : null);
  } });
  assert.equal(await client.getPlayerStatus(), null);
  assert.equal(await client.getPlayerStatus(), null);
  assert.equal(calls.filter(call => call.url.endsWith('/signup')).length, 1);
  assert.deepEqual(calls[0].body, { data: {} });
  assert.equal(calls[0].headers.Authorization, undefined);
  assert(calls.slice(1).every(call => call.url.endsWith('/oaq_player_status') && call.headers.Authorization === 'Bearer dummy-access-token'));
});

test('registration sends one normalized name and returns the canonical profile', async t => {
  const calls = [];
  const { client } = await fixture(t, { initialStorage: JSON.stringify(savedSession()), fetch: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return response({ ...profile(), private_user_id: USER_ID });
  } });
  assert.deepEqual(await client.registerPlayer({ name: '  Nguyê\u0303n  An ' }), profile());
  assert.deepEqual(calls, [{ url: `${PROJECT_URL}/rest/v1/rpc/oaq_register_player`, body: { p_name: 'Nguyễn An' } }]);
});

test('status restores the last completed canonical game without starting another attempt', async t => {
  const calls = [];
  const canonical = profile({ attempts_used: 3, attempts_left: 0, best_score: 38, active_game: game({ status: 'completed', moves: MOVES, score: 38 }) });
  const { client } = await fixture(t, { initialStorage: JSON.stringify(savedSession()), fetch: async url => { calls.push(url); return response(canonical); } });
  assert.deepEqual(await client.getPlayerStatus(), canonical);
  assert.deepEqual(calls, [`${PROJECT_URL}/rest/v1/rpc/oaq_player_status`]);
});

test('start retries keep the supplied request UUID unchanged', async t => {
  const calls = [];
  const canonical = profile({ attempts_used: 1, attempts_left: 2, active_game: game() });
  const { client } = await fixture(t, { initialStorage: JSON.stringify(savedSession()), fetch: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return response(canonical);
  } });
  assert.deepEqual(await client.startGame({ requestId: REQUEST_ID }), canonical);
  assert.deepEqual(await client.startGame({ requestId: REQUEST_ID }), canonical);
  assert.deepEqual(calls, Array.from({ length: 2 }, () => ({ url: `${PROJECT_URL}/rest/v1/rpc/oaq_start_game`, body: { p_request_id: REQUEST_ID } })));
});

test('move retries send the same expected prefix and move without trusting a claimed score', async t => {
  const calls = [];
  const canonical = profile({ attempts_used: 1, attempts_left: 2, active_game: game({ moves: MOVES.slice(0, 2) }) });
  const { client } = await fixture(t, { initialStorage: JSON.stringify(savedSession()), fetch: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return response(canonical);
  } });
  const input = { gameId: GAME_ID, expectedMoves: [{ ...MOVES[0], gained: 999 }], move: { ...MOVES[1], score: 999 }, score: 999 };
  assert.deepEqual(await client.playGameMove(input), canonical);
  assert.deepEqual(await client.playGameMove(input), canonical);
  assert.deepEqual(calls, Array.from({ length: 2 }, () => ({
    url: `${PROJECT_URL}/rest/v1/rpc/oaq_play_move`,
    body: { p_game_id: GAME_ID, p_expected_moves: MOVES.slice(0, 1), p_move: MOVES[1] },
  })));
});

test('invalid UUIDs and malformed move prefixes are rejected before authentication or network I/O', async t => {
  let calls = 0;
  const { client } = await fixture(t, { fetch: async () => { calls++; return response(null); } });
  for (const requestId of [undefined, '', 'not-a-uuid', ' '+REQUEST_ID]) {
    await assert.rejects(client.startGame({ requestId }), error => error.code === 'INVALID_GAME');
  }
  await assert.rejects(client.playGameMove({ gameId: 'bad', expectedMoves: [], move: MOVES[0] }), error => error.code === 'INVALID_GAME');
  for (const overrides of [
    { expectedMoves: 1 }, { expectedMoves: MOVES }, { expectedMoves: [{ pit: 6, direction: 1 }] },
    { move: { pit: 0, direction: 1 } }, { move: { pit: 9, direction: 0 } }, { move: { pit: 9, direction: '-1' } },
  ]) {
    await assert.rejects(client.playGameMove({ gameId: GAME_ID, expectedMoves: [], move: MOVES[0], ...overrides }), error => error.code === 'INVALID_MOVE');
  }
  assert.equal(calls, 0);
});

test('concurrent status calls create one guest session', async t => {
  let signups = 0;
  const { client } = await fixture(t, { fetch: async url => {
    if (url.endsWith('/signup')) { signups++; await Promise.resolve(); return response(authResponse()); }
    return response(null);
  } });
  assert.deepEqual(await Promise.all([client.getPlayerStatus(), client.getPlayerStatus()]), [null, null]);
  assert.equal(signups, 1);
});

test('public top10 reads require no signup and expose only expected fields', async t => {
  const calls = [];
  const rows = [row({ private_user_id: USER_ID }), row({ rank: 2, name: 'Bình', score: 28, achieved_at: '2026-10-09T01:00:00Z', is_me: true })];
  const { client } = await fixture(t, { fetch: async (url, options) => { calls.push({ url, options }); return response(rows); } });
  assert.deepEqual(await client.fetchTop10(), [row(), row({ rank: 2, name: 'Bình', score: 28, achieved_at: '2026-10-09T01:00:00Z', is_me: true })]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${PROJECT_URL}/rest/v1/rpc/oaq_top10`);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body), {});
});

test('top10 rejects more than ten entries and malformed ranking data', async t => {
  let payload;
  const { client } = await fixture(t, { fetch: async () => response(payload) });
  for (const bad of [
    {}, Array.from({ length: 11 }, (_, index) => row({ rank: index + 1 })),
    [row({ rank: 2 })], [row({ score: -1 })], [row({ score: 39 })], [row({ score: 3.5 })],
    [row({ name: '' })], [row({ name: 'An\u200b' })], [row({ is_me: 'yes' })], [row({ achieved_at: '1' })],
  ]) {
    payload = bad;
    await assert.rejects(client.fetchTop10(), error => error.code === 'INVALID_RESPONSE');
  }
  payload = [];
  assert.deepEqual(await client.fetchTop10(), []);
});

test('profiles reject inconsistent attempts, malformed games, and invalid completed scores', async t => {
  let payload;
  const { client } = await fixture(t, { initialStorage: JSON.stringify(savedSession()), fetch: async () => response(payload) });
  const trackedProfile = overrides => profile({ attempts_used: 1, attempts_left: 2, active_game: game(), ...overrides });
  for (const bad of [
    {}, profile({ attempts_used: -1 }), profile({ attempts_used: 4, attempts_left: -1 }), profile({ attempts_left: 2 }),
    profile({ best_score: -1 }), profile({ best_score: 39 }), profile({ active_game: undefined }),
    trackedProfile({ active_game: game({ id: 'bad' }) }), trackedProfile({ active_game: game({ moves: 2 }) }),
    trackedProfile({ active_game: game({ moves: [{ pit: 6, direction: 1 }] }) }), trackedProfile({ active_game: game({ moves: MOVES }) }),
    trackedProfile({ best_score: 38, active_game: game({ status: 'completed', moves: [MOVES[0]], score: 13 }) }),
    trackedProfile({ best_score: 38, active_game: game({ status: 'completed', moves: MOVES, score: null }) }),
    trackedProfile({ best_score: 38, active_game: game({ status: 'completed', moves: MOVES, score: -1 }) }),
  ]) {
    payload = bad;
    await assert.rejects(client.getPlayerStatus(), error => error.code === 'INVALID_RESPONSE');
  }
  payload = null;
  assert.equal(await client.getPlayerStatus(), null);
  await assert.rejects(client.registerPlayer({ name: 'An' }), error => error.code === 'INVALID_RESPONSE');
});

test('a restored game requires a counted attempt, an unfinished score, and a consistent best score', async t => {
  let payload;
  const { client } = await fixture(t, { initialStorage: JSON.stringify(savedSession()), fetch: async () => response(payload) });
  const base = profile({ attempts_used: 1, attempts_left: 2, active_game: game() });
  for (const bad of [
    profile({ active_game: game() }),
    { ...base, active_game: game({ moves: MOVES.slice(0, 1), score: 3 }) },
    { ...base, best_score: null, active_game: game({ status: 'completed', moves: MOVES, score: 38 }) },
    { ...base, best_score: 28, active_game: game({ status: 'completed', moves: MOVES, score: 38 }) },
  ]) {
    payload = bad;
    await assert.rejects(client.getPlayerStatus(), error => error.code === 'INVALID_RESPONSE');
  }
  payload = base;
  assert.deepEqual(await client.getPlayerStatus(), base);
  payload = { ...base, best_score: 38, active_game: game({ status: 'completed', moves: MOVES, score: 28 }) };
  assert.deepEqual(await client.getPlayerStatus(), payload);
});

test('backend game errors keep their stable codes and use Vietnamese messages', async t => {
  let payload;
  const calls = [];
  const { client } = await fixture(t, { initialStorage: JSON.stringify(savedSession()), fetch: async url => { calls.push(url); return response(payload, 400); } });
  for (const code of ['NAME_LOCKED', 'NAME_TAKEN', 'ATTEMPT_LIMIT', 'GAME_CONFLICT', 'NAME_REQUIRED', 'INVALID_MOVE']) {
    payload = { code: 'P0001', message: code };
    await assert.rejects(client.registerPlayer({ name: 'An' }), error => error.code === code && error.message !== code);
  }
  payload = { code: '22023', message: 'invalid name' };
  await assert.rejects(client.registerPlayer({ name: 'An' }), error => error.code === 'INVALID_NAME');
  await assert.rejects(client.startGame({ requestId: REQUEST_ID }), error => error.code === 'INVALID_GAME');
  assert(calls.every(url => url.endsWith('/oaq_register_player') || url.endsWith('/oaq_start_game')));
});

test('blocked browser storage reuses its in-memory guest', async t => {
  let signups = 0;
  const { client } = await fixture(t, { blockedStorage: true, fetch: async url => {
    if (url.endsWith('/signup')) { signups++; return response(authResponse()); }
    return response(null);
  } });
  assert.equal(await client.getPlayerStatus(), null);
  assert.equal(await client.getPlayerStatus(), null);
  assert.equal(signups, 1);
});

test('missing configuration and network errors require an online connection before play', async t => {
  const { client } = await fixture(t, { fetch: async () => { throw new Error('private transport diagnostic'); } });
  SUPABASE_CONFIG.url = '';
  assert.equal(client.isLeaderboardConfigured(), false);
  await assert.rejects(client.getPlayerStatus(), error => error.code === 'NOT_CONFIGURED' && error.message.includes('trước khi chơi'));
  SUPABASE_CONFIG.url = PROJECT_URL;
  await assert.rejects(client.getPlayerStatus(), error => error.code === 'NETWORK'
    && error.message.includes('kết nối mạng để chơi') && !error.message.includes('private transport diagnostic'));
});

test('an in-flight AbortSignal cancels the request without becoming a network error', async t => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const { client } = await fixture(t, { fetch: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    started();
  }) });
  const controller = new AbortController();
  const pending = client.fetchTop10({ signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending, error => error.code === 'ABORTED');
});

test('an already aborted status load does no signup or network I/O', async t => {
  let called = false;
  const { client } = await fixture(t, { fetch: async () => { called = true; return response(null); } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.getPlayerStatus({ signal: controller.signal }), error => error.code === 'ABORTED');
  assert.equal(called, false);
});
