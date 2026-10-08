import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPABASE_CONFIG } from '../docs/leaderboard-config.mjs';

const PROJECT_URL = 'https://testproject.supabase.co';
const STORAGE_KEY = 'oaq:leaderboard:session:testproject.supabase.co';
const USER_ID = '11111111-2222-3333-4444-555555555555';
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
  // Use the module's no-lock fallback here; the request AbortSignal is tested
  // directly below. No browser or real Supabase project is contacted.
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
  await assert.rejects(client.submitScore({ name: 'An', moves: MOVES }), error => error.code === 'SESSION_INVALID');
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
      return response({ score: 28, best_score: 38, improved: false });
    },
  });
  assert.deepEqual(await client.submitScore({ name: 'An', moves: MOVES }), { score: 28, best_score: 38, improved: false });
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
    await assert.rejects(client.submitScore({ name: 'An', moves: MOVES }), error => error.code === 'SESSION_EXPIRED');
  }
  assert.equal(urls.length, 2);
  assert(urls.every(url => url.includes('grant_type=refresh_token')));
  assert.equal(storage.get(STORAGE_KEY), initial);
});

test('a refresh response for a different user cannot overwrite the stored identity', async t => {
  const initial = JSON.stringify(savedSession({ expires_at: 1 }));
  const { client, storage } = await fixture(t, { initialStorage: initial, fetch: async () => response(authResponse({
    user: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
  })) });
  await assert.rejects(client.submitScore({ name: 'An', moves: MOVES }), error => error.code === 'INVALID_RESPONSE');
  assert.equal(storage.get(STORAGE_KEY), initial);
});

test('submission sends normalized name and move proof, never a claimed score', async t => {
  const calls = [];
  const { client } = await fixture(t, { fetch: async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    if (url.endsWith('/signup')) return response(authResponse());
    return response({ score: 28, best_score: 28, improved: true });
  } });
  const input = { name: '  Nguyê\u0303n  An ', score: 999, moves: MOVES.map(move => ({ ...move, gained: 999 })) };
  assert.deepEqual(await client.submitScore(input), { score: 28, best_score: 28, improved: true });
  await client.submitScore(input);
  assert.equal(calls.filter(call => call.url.endsWith('/signup')).length, 1);
  assert.deepEqual(calls[0].body, { data: {} });
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[1].headers.Authorization, 'Bearer dummy-access-token');
  assert.deepEqual(calls[1].body, { p_name: 'Nguyễn An', p_moves: MOVES });
  assert.equal(calls[1].url, `${PROJECT_URL}/rest/v1/rpc/oaq_submit_score`);
});

test('concurrent submissions create one guest session', async t => {
  let signups = 0;
  const { client } = await fixture(t, { fetch: async url => {
    if (url.endsWith('/signup')) {
      signups++;
      await Promise.resolve();
      return response(authResponse());
    }
    return response({ score: 38, best_score: 38, improved: true });
  } });
  await Promise.all([client.submitScore({ name: 'An', moves: MOVES }), client.submitScore({ name: 'An', moves: MOVES })]);
  assert.equal(signups, 1);
});

test('public top20 reads require no guest signup and expose only expected fields', async t => {
  const calls = [];
  const rows = [row({ private_user_id: USER_ID }), row({ rank: 2, name: 'Bình', score: 28, achieved_at: '2026-10-09T01:00:00Z', is_me: true })];
  const { client } = await fixture(t, { fetch: async (url, options) => {
    calls.push({ url, options });
    return response(rows);
  } });
  const result = await client.fetchTop20();
  assert.deepEqual(result, [row(), row({ rank: 2, name: 'Bình', score: 28, achieved_at: '2026-10-09T01:00:00Z', is_me: true })]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${PROJECT_URL}/rest/v1/rpc/oaq_top20`);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body), {});
});

test('top20 rejects invalid shape, rank, score, names, and timestamps', async t => {
  let payload;
  const { client } = await fixture(t, { fetch: async () => response(payload) });
  for (const bad of [
    {}, Array.from({ length: 21 }, (_, index) => row({ rank: index + 1 })),
    [row({ rank: 2 })], [row({ score: -1 })], [row({ score: 39 })], [row({ score: 3.5 })],
    [row({ name: '' })], [row({ name: 'An\u200b' })], [row({ is_me: 'yes' })], [row({ achieved_at: '1' })],
  ]) {
    payload = bad;
    await assert.rejects(client.fetchTop20(), error => error.code === 'INVALID_RESPONSE');
  }
  payload = [];
  assert.deepEqual(await client.fetchTop20(), []);
});

test('a negative or inconsistent score submission response is rejected', async t => {
  let payload;
  const { client } = await fixture(t, { initialStorage: JSON.stringify(savedSession()), fetch: async () => response(payload) });
  for (const bad of [
    { score: -1, best_score: 38, improved: false }, { score: 28, best_score: -1, improved: false },
    { score: 28, best_score: 38, improved: true }, { score: 38, best_score: 28, improved: false },
  ]) {
    payload = bad;
    await assert.rejects(client.submitScore({ name: 'An', moves: MOVES }), error => error.code === 'INVALID_RESPONSE');
  }
});

test('blocked browser storage reuses its in-memory guest', async t => {
  let signups = 0;
  const { client } = await fixture(t, { blockedStorage: true, fetch: async url => {
    if (url.endsWith('/signup')) { signups++; return response(authResponse()); }
    return response({ score: 38, best_score: 38, improved: true });
  } });
  await client.submitScore({ name: 'An', moves: MOVES });
  await client.submitScore({ name: 'An', moves: MOVES });
  assert.equal(signups, 1);
});

test('a network failure produces a useful error without exposing transport details', async t => {
  const { client } = await fixture(t, { fetch: async () => { throw new Error('private transport diagnostic'); } });
  await assert.rejects(client.fetchTop20(), error => error.code === 'NETWORK'
    && error.message.includes('kết nối mạng') && !error.message.includes('private transport diagnostic'));
});

test('an in-flight AbortSignal cancels the request and does not become a network error', async t => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const { client } = await fixture(t, { fetch: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    started();
  }) });
  const controller = new AbortController();
  const pending = client.fetchTop20({ signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending, error => error.code === 'ABORTED');
});

test('an already aborted load does no network I/O', async t => {
  let called = false;
  const { client } = await fixture(t, { fetch: async () => { called = true; return response([]); } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.fetchTop20({ signal: controller.signal }), error => error.code === 'ABORTED');
  assert.equal(called, false);
});
