import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPABASE_CONFIG } from '../docs/leaderboard-config.mjs';

const PROJECT_URL = 'https://admin-test.supabase.co';
const ADMIN_KEY = 'oaq:admin:session:admin-test.supabase.co';
const GAME_KEY = 'oaq:leaderboard:session:admin-test.supabase.co';
const USER_ID = '11111111-2222-3333-4444-555555555555';
const PLAYER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER_ID = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee';
const REQUEST_ID = '01234567-89ab-cdef-0123-456789abcdef';
const AUDIT_ID = 'a1234567-89ab-cdef-0123-456789abcdef';
const EMAIL = 'quanly@trangnguyenkylo.invalid';
const PASSWORD = 'test-password-only';
const STAMP = '2026-10-10T10:00:00.123456+00:00';
const ADMIN_URL = 'https://games.example.test/o-an-quan/admin.html';
let importNumber = 0;

const response = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status });
const session = (overrides = {}) => ({
  access_token: 'dummy-old-access', refresh_token: 'dummy-old-refresh',
  user_id: USER_ID, expires_at: Math.floor(Date.now() / 1000) + 3600, ...overrides,
});
const verifiedUser = (overrides = {}) => ({ id: USER_ID, email: EMAIL, email_confirmed_at: STAMP, is_anonymous: false, ...overrides });
const authResponse = (overrides = {}) => ({
  access_token: 'dummy-new-access', refresh_token: 'dummy-new-refresh', expires_in: 3600,
  user: verifiedUser(), ...overrides,
});
const player = (overrides = {}) => ({
  id: PLAYER_ID, name: 'Nguyễn An', best_score: 38, effective_score: 38,
  override_enabled: false, override_score: null, is_hidden: false,
  attempts_used: 2, revision: 4, achieved_at: STAMP, ...overrides,
});
const edit = (overrides = {}) => ({
  id: PLAYER_ID, name: 'Nguyễn An', overrideEnabled: true, overrideScore: 28, isHidden: false,
  expectedRevision: 4, requestId: REQUEST_ID, reason: 'Điều chỉnh theo kết quả xác minh', ...overrides,
});
const auditEntry = (overrides = {}) => ({
  id: AUDIT_ID, created_at: STAMP, actor_email: EMAIL, player_name: 'Nguyễn An', action: 'update',
  before: player(), after: player({ revision: 5, override_enabled: true, override_score: 28, effective_score: 28 }),
  reason: 'Điều chỉnh theo kết quả xác minh', ...overrides,
});

async function fixture(t, { initialSession, href = ADMIN_URL, fetch: handler, locks = false } = {}) {
  const originalConfig = { ...SUPABASE_CONFIG };
  const globals = new Map(['fetch', 'localStorage', 'navigator', 'location', 'history'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    Object.assign(SUPABASE_CONFIG, originalConfig);
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  Object.assign(SUPABASE_CONFIG, { url: PROJECT_URL, publicKey: 'sb_publishable_dummy_test_key' });
  const gameSession = JSON.stringify({ guest: 'existing-game-identity-must-remain' });
  const storage = new Map([[GAME_KEY, gameSession]]);
  if (initialSession !== undefined) storage.set(ADMIN_KEY, typeof initialSession === 'string' ? initialSession : JSON.stringify(initialSession));
  const calls = [];
  const events = [];
  let lockTail = Promise.resolve();
  const navigator = locks ? { locks: { request: (key, options, task) => {
    events.push({ type: 'lock', key, mode: options.mode });
    const result = lockTail.then(task);
    lockTail = result.catch(() => {});
    return result;
  } } } : {};
  for (const [key, value] of Object.entries({
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    navigator,
    location: new URL(href),
    history: { replaceState: (state, title, path) => {
      events.push({ type: 'replaceState', path });
      globalThis.location.href = new URL(path, globalThis.location.href).href;
    } },
    fetch: async (url, options) => {
      const call = { url, method: options.method, headers: options.headers, body: options.body === undefined ? undefined : JSON.parse(options.body) };
      calls.push(call);
      events.push({ type: 'fetch', url });
      assert(url.startsWith(PROJECT_URL + '/'), 'All tests must use only the mock project');
      if (!handler) assert.fail('Unexpected network request');
      return handler(call, { storage, events, calls });
    },
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const moduleUrl = new URL('../docs/admin-client.mjs', import.meta.url);
  moduleUrl.searchParams.set('admin-client-test', String(++importNumber));
  return { client: await import(moduleUrl.href), storage, gameSession, calls, events };
}

test('admin reads without a session never create a guest or alter the game identity', async t => {
  const { client, storage, gameSession } = await fixture(t);
  assert.equal(await client.getAdminStatus(), null);
  await assert.rejects(client.fetchAdminPlayers(), error => error.code === 'AUTHORIZATION');
  assert.equal(storage.has(ADMIN_KEY), false);
  assert.equal(storage.get(GAME_KEY), gameSession);
});

test('password sign-in sends the exact auth grant and persists only after verified server authorization', async t => {
  const href = ADMIN_URL + '?v=build#bang-vang';
  const { client, calls, events, storage, gameSession } = await fixture(t, {
    href,
    fetch: async (call, state) => {
      assert.equal(state.storage.has(ADMIN_KEY), false, 'Do not persist tokens before admin authorization');
      if (call.url.includes('/auth/v1/token?')) return response(authResponse());
      return response(call.url.endsWith('/user') ? verifiedUser() : { email: EMAIL });
    },
  });
  assert.deepEqual(await client.signInAdmin({ password: PASSWORD, email: 'ignored@example.test' }), { email: EMAIL });
  assert.deepEqual(calls, [
    {
      url: `${PROJECT_URL}/auth/v1/token?grant_type=password`, method: 'POST',
      headers: { apikey: 'sb_publishable_dummy_test_key', 'Content-Type': 'application/json' },
      body: { email: EMAIL, password: PASSWORD },
    },
    {
      url: `${PROJECT_URL}/auth/v1/user`, method: 'GET',
      headers: { apikey: 'sb_publishable_dummy_test_key', Authorization: 'Bearer dummy-new-access' },
      body: undefined,
    },
    {
      url: `${PROJECT_URL}/rest/v1/rpc/oaq_admin_status`, method: 'POST',
      headers: { apikey: 'sb_publishable_dummy_test_key', Authorization: 'Bearer dummy-new-access', 'Content-Type': 'application/json' },
      body: {},
    },
  ]);
  const saved = JSON.parse(storage.get(ADMIN_KEY));
  assert.deepEqual(Object.keys(saved).sort(), ['access_token', 'expires_at', 'refresh_token', 'user_id']);
  assert.equal(saved.user_id, USER_ID);
  assert.equal(saved.refresh_token, 'dummy-new-refresh');
  assert.equal(JSON.stringify([...storage]).includes(PASSWORD), false, 'Store tokens only, never the typed password');
  assert.equal(calls.some(call => call.url.includes(PASSWORD)), false);
  assert.equal(globalThis.location.href, href, 'Password authentication must not put credentials in navigation URLs');
  assert.equal(events.some(event => event.type === 'replaceState'), false);
  assert.equal(storage.get(GAME_KEY), gameSession);
});

test('empty, non-string and oversized passwords are rejected before authentication or I/O', async t => {
  const { client, calls, storage, gameSession } = await fixture(t);
  for (const password of [undefined, null, 123, '', 'x'.repeat(4097)]) {
    await assert.rejects(client.signInAdmin({ password }), error => error.code === 'INVALID_PASSWORD');
  }
  assert.deepEqual(calls, []);
  assert.equal(storage.has(ADMIN_KEY), false);
  assert.equal(storage.get(GAME_KEY), gameSession);
});

test('wrong passwords remain actionable and cannot replace an existing admin session', async t => {
  const previous = JSON.stringify(session());
  const { client, calls, storage, gameSession } = await fixture(t, {
    initialSession: previous, fetch: async () => response({ code: 'invalid_credentials', message: 'Invalid login credentials' }, 400),
  });
  await assert.rejects(client.signInAdmin({ password: PASSWORD }), error => error.code === 'INVALID_PASSWORD');
  assert.equal(calls.length, 1);
  assert.equal(storage.get(ADMIN_KEY), previous);
  assert.equal(storage.get(GAME_KEY), gameSession);
});

test('anonymous, unverified, malformed or non-admin users cannot persist a password session', async t => {
  for (const overrides of [
    { is_anonymous: true }, { email_confirmed_at: null }, { email_confirmed_at: '42' }, { id: 'bad-id' },
    { id: OTHER_ID }, { email: 'different@example.test' },
  ]) await t.test(JSON.stringify(overrides), async sub => {
    const { client, storage, calls, gameSession } = await fixture(sub, {
      fetch: async call => response(call.url.includes('/auth/v1/token?') ? authResponse() : verifiedUser(overrides)),
    });
    await assert.rejects(client.signInAdmin({ password: PASSWORD }), error => error.code === 'FORBIDDEN');
    assert.equal(calls.length, 2);
    assert.equal(storage.has(ADMIN_KEY), false);
    assert.equal(storage.get(GAME_KEY), gameSession);
  });
  await t.test('verified account outside allowlist', async sub => {
    const { client, storage, calls, gameSession } = await fixture(sub, { fetch: async call => {
      if (call.url.includes('/auth/v1/token?')) return response(authResponse());
      return call.url.endsWith('/user') ? response(verifiedUser()) : response({ code: '42501', message: 'ADMIN_REQUIRED' }, 403);
    } });
    await assert.rejects(client.signInAdmin({ password: PASSWORD }), error => error.code === 'FORBIDDEN');
    assert.equal(calls.length, 3);
    assert.equal(storage.has(ADMIN_KEY), false);
    assert.equal(storage.get(GAME_KEY), gameSession);
  });
});

test('malformed token responses cannot persist a password session', async t => {
  const { client, storage, calls } = await fixture(t, { fetch: async () => response(authResponse({ access_token: '' })) });
  await assert.rejects(client.signInAdmin({ password: PASSWORD }), error => error.code === 'INVALID_RESPONSE');
  assert.equal(calls.length, 1);
  assert.equal(storage.has(ADMIN_KEY), false);
});

test('password errors distinguish incomplete setup and server rate limits', async t => {
  let next;
  const { client, storage, gameSession } = await fixture(t, { fetch: async () => response(next[0], next[1]) });
  for (next of [
    [{ error_code: 'invalid_credentials' }, 400, 'INVALID_PASSWORD'],
    [{ code: 'email_not_confirmed' }, 400, 'NOT_READY'],
    [{ code: 'over_request_rate_limit' }, 429, 'RATE_LIMIT'],
  ]) await assert.rejects(client.signInAdmin({ password: PASSWORD }), error => error.code === next[2]);
  assert.equal(storage.has(ADMIN_KEY), false);
  assert.equal(storage.get(GAME_KEY), gameSession);
});

test('expired admin sessions refresh while preserving the user and game session', async t => {
  const { client, calls, storage, gameSession } = await fixture(t, { initialSession: session({ expires_at: 1 }), fetch: async call => {
    return response(call.url.includes('/auth/v1/token?') ? authResponse() : { email: EMAIL });
  } });
  assert.deepEqual(await client.getAdminStatus(), { email: EMAIL });
  assert.deepEqual(calls[0].body, { refresh_token: 'dummy-old-refresh' });
  assert.equal(calls[0].url, `${PROJECT_URL}/auth/v1/token?grant_type=refresh_token`);
  assert.equal(calls[1].headers.Authorization, 'Bearer dummy-new-access');
  assert.equal(JSON.parse(storage.get(ADMIN_KEY)).user_id, USER_ID);
  assert.equal(storage.get(GAME_KEY), gameSession);
});

test('refreshing cannot replace an admin identity with another user', async t => {
  const initial = JSON.stringify(session({ expires_at: 1 }));
  const { client, storage, calls } = await fixture(t, {
    initialSession: initial, fetch: async () => response(authResponse({ user: verifiedUser({ id: OTHER_ID }) })),
  });
  await assert.rejects(client.getAdminStatus(), error => error.code === 'INVALID_RESPONSE');
  assert.equal(storage.get(ADMIN_KEY), initial);
  assert.equal(calls.length, 1);
});

test('HTTP 401 retries preserve the save request UUID, payload and optimistic revision', async t => {
  let saves = 0;
  const saved = player({ override_enabled: true, override_score: 28, effective_score: 28, revision: 5 });
  const { client, calls } = await fixture(t, { initialSession: session(), fetch: async call => {
    if (call.url.includes('/auth/v1/token?')) return response(authResponse());
    if (++saves === 1) return response({ message: 'JWT expired' }, 401);
    return response(saved);
  } });
  assert.deepEqual(await client.saveAdminPlayer(edit()), saved);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].body, calls[2].body);
  assert.equal(calls[2].body.p_request_id, REQUEST_ID);
  assert.equal(calls[2].body.p_expected_revision, 4);
  assert.equal(calls[2].headers.Authorization, 'Bearer dummy-new-access');
});

test('logout accepts HTTP 204 and clears only the admin session', async t => {
  const { client, calls, storage, gameSession } = await fixture(t, { initialSession: session(), fetch: async () => response(null, 204) });
  await client.signOutAdmin();
  assert.equal(calls[0].url, `${PROJECT_URL}/auth/v1/logout?scope=local`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(storage.has(ADMIN_KEY), false);
  assert.equal(storage.get(GAME_KEY), gameSession);
  assert.equal(await client.getAdminStatus(), null);
});

test('logout clears corrupt sessions and network-failed sessions without touching game identity', async t => {
  await t.test('corrupt', async sub => {
    const { client, storage, gameSession } = await fixture(sub, { initialSession: '{broken-json' });
    await assert.rejects(client.getAdminStatus(), error => error.code === 'SESSION_INVALID');
    assert.equal(storage.get(ADMIN_KEY), '{broken-json');
    await client.signOutAdmin();
    assert.equal(storage.has(ADMIN_KEY), false);
    assert.equal(storage.get(GAME_KEY), gameSession);
  });
  await t.test('network error', async sub => {
    const { client, storage, gameSession } = await fixture(sub, { initialSession: session(), fetch: async () => { throw new Error('Offline'); } });
    await assert.rejects(client.signOutAdmin(), error => error.code === 'NETWORK');
    assert.equal(storage.has(ADMIN_KEY), false);
    assert.equal(storage.get(GAME_KEY), gameSession);
  });
});

test('removing admin storage in another tab does not revive its cached session', async t => {
  const { client, storage, calls } = await fixture(t, { initialSession: session(), fetch: async () => response({ email: EMAIL }) });
  assert.deepEqual(await client.getAdminStatus(), { email: EMAIL });
  storage.delete(ADMIN_KEY);
  assert.equal(await client.getAdminStatus(), null);
  assert.equal(calls.length, 1);
});

test('logout racing a pending refresh cannot restore an admin session afterwards', async t => {
  let releaseRefresh;
  let startedRefresh;
  const refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
  const refreshStarted = new Promise(resolve => { startedRefresh = resolve; });
  const { client, storage, gameSession } = await fixture(t, { initialSession: session({ expires_at: 1 }), locks: true, fetch: async call => {
    if (call.url.includes('/auth/v1/token?')) { startedRefresh();await refreshGate;return response(authResponse()); }
    if (call.url.includes('/logout?')) return response(null, 204);
    return response({ email: EMAIL });
  } });
  const loading = client.getAdminStatus();
  await refreshStarted;
  const logout = client.signOutAdmin();
  releaseRefresh();
  await Promise.all([loading, logout]);
  assert.equal(storage.has(ADMIN_KEY), false);
  assert.equal(storage.get(GAME_KEY), gameSession);
  assert.equal(await client.getAdminStatus(), null);
});

test('logout racing a pending password login leaves no admin session afterwards', async t => {
  let releaseLogin;
  let startedLogin;
  const loginGate = new Promise(resolve => { releaseLogin = resolve; });
  const loginStarted = new Promise(resolve => { startedLogin = resolve; });
  const { client, storage, gameSession } = await fixture(t, { locks: true, fetch: async call => {
    if (call.url.includes('/auth/v1/token?')) { startedLogin();await loginGate;return response(authResponse()); }
    if (call.url.includes('/logout?')) return response(null, 204);
    return response(call.url.endsWith('/user') ? verifiedUser() : { email: EMAIL });
  } });
  const login = client.signInAdmin({ password: PASSWORD });
  await loginStarted;
  const logout = client.signOutAdmin();
  releaseLogin();
  await Promise.all([login, logout]);
  assert.equal(storage.has(ADMIN_KEY), false);
  assert.equal(storage.get(GAME_KEY), gameSession);
  assert.equal(await client.getAdminStatus(), null);
});

test('player searches send normalized pagination and return only public admin fields', async t => {
  const { client, calls } = await fixture(t, { initialSession: session(), fetch: async () => response({
    players: [{ ...player(), private_user_id: USER_ID }], total: 51,
  }) });
  assert.deepEqual(await client.fetchAdminPlayers({ search: '  Nguyê\u0303n  ', offset: 25, limit: 25 }), { players: [player()], total: 51 });
  assert.equal(calls[0].url, `${PROJECT_URL}/rest/v1/rpc/oaq_admin_players`);
  assert.deepEqual(calls[0].body, { p_search: 'Nguyễn', p_offset: 25, p_limit: 25 });
});

test('edits strip claimed quota and earned scores and preserve UUID when retrying a lost response', async t => {
  let attempts = 0;
  const saved = player({ override_enabled: true, override_score: 28, effective_score: 28, revision: 5 });
  const { client, calls } = await fixture(t, { initialSession: session(), fetch: async () => {
    if (++attempts === 1) throw new Error('Lost response');
    return response(saved);
  } });
  const input = edit({ name: '  Nguyê\u0303n  An  ', reason: '  Xác minh kết quả  ', attempts_used: 0, best_score: 999 });
  await assert.rejects(client.saveAdminPlayer(input), error => error.code === 'NETWORK');
  assert.deepEqual(await client.saveAdminPlayer(input), saved);
  const expected = {
    p_id: PLAYER_ID, p_name: 'Nguyễn An', p_override_enabled: true, p_override_score: 28, p_is_hidden: false,
    p_expected_revision: 4, p_request_id: REQUEST_ID, p_reason: 'Xác minh kết quả',
  };
  assert.deepEqual(calls.map(call => call.body), [expected, expected]);
});

test('disabling an override sends null while an enabled null override can remove a ranked score', async t => {
  let index = 0;
  const answers = [player({ revision: 5 }), player({ override_enabled: true, override_score: null, effective_score: null, achieved_at: null, revision: 6 })];
  const { client, calls } = await fixture(t, { initialSession: session(), fetch: async () => response(answers[index++]) });
  await client.saveAdminPlayer(edit({ overrideEnabled: false, overrideScore: 28 }));
  await client.saveAdminPlayer(edit({ overrideEnabled: true, overrideScore: null }));
  assert.equal(calls[0].body.p_override_score, null);
  assert.equal(calls[1].body.p_override_score, null);
});

test('invalid edits and pagination are rejected before authentication or I/O', async t => {
  const { client } = await fixture(t);
  for (const input of [
    { id: 'bad' }, { requestId: 'bad' }, { expectedRevision: -1 }, { expectedRevision: 1.5 },
    { overrideEnabled: 'true' }, { isHidden: 1 }, { overrideScore: -1 }, { overrideScore: 39 }, { overrideScore: 1.5 },
    { reason: '' }, { reason: 'x'.repeat(201) }, { reason: 'Line\nBreak' }, { name: '' }, { name: 'x'.repeat(25) },
  ]) await assert.rejects(client.saveAdminPlayer(edit(input)), error => ['INVALID_INPUT', 'INVALID_NAME'].includes(error.code));
  for (const input of [{ offset: -1 }, { limit: 101 }, { offset: 1000001 }, { search: 'x'.repeat(81) }]) {
    await assert.rejects(client.fetchAdminPlayers(input), error => error.code === 'INVALID_INPUT');
  }
  await assert.rejects(client.fetchAdminAudit({ playerId: 'bad' }), error => error.code === 'INVALID_INPUT');
});

test('malformed player records and pagination responses cannot reach the admin UI', async t => {
  const records = [
    { id: 'bad' }, { best_score: 39 }, { effective_score: -1 }, { override_score: 2.5 },
    { override_enabled: 'false' }, { is_hidden: null }, { attempts_used: 4 }, { revision: -1 },
    { effective_score: 28 }, { achieved_at: '42' }, { achieved_at: null },
  ];
  const { client } = await fixture(t, { initialSession: session(), fetch: async () => response({ players: [player(records.shift())], total: 1 }) });
  while (records.length) await assert.rejects(client.fetchAdminPlayers(), error => error.code === 'INVALID_RESPONSE');
});

test('audit history validates consistent player identities, names and UUID entry IDs', async t => {
  const entries = [auditEntry()];
  const { client, calls } = await fixture(t, { initialSession: session(), fetch: async () => response({ entries, total: 1 }) });
  assert.deepEqual(await client.fetchAdminAudit({ playerId: PLAYER_ID, offset: 0, limit: 10 }), { entries, total: 1 });
  assert.deepEqual(calls[0].body, { p_player_id: PLAYER_ID, p_offset: 0, p_limit: 10 });
  for (const overrides of [
    { id: 0 }, { id: 1.5 }, { id: 'bad' }, { created_at: '42' },
    { after: player({ id: OTHER_ID }) }, { player_name: 'Different player' },
  ]) {
    entries[0] = auditEntry(overrides);
    await assert.rejects(client.fetchAdminAudit(), error => error.code === 'INVALID_RESPONSE');
  }
});

test('server authorization, conflict and rate-limit errors remain actionable', async t => {
  const errors = [
    [{ message: 'ADMIN_REQUIRED', code: '42501' }, 403, 'FORBIDDEN'],
    [{ message: 'ADMIN_CONFLICT', code: 'P0001' }, 400, 'CONFLICT'],
    [{ message: 'ADMIN_REQUEST_CONFLICT', code: 'P0001' }, 400, 'CONFLICT'],
    [{ message: 'NAME_TAKEN', code: 'P0001' }, 400, 'NAME_TAKEN'],
    [{ message: 'PLAYER_NOT_FOUND', code: 'P0001' }, 400, 'NOT_FOUND'],
    [{ code: 'over_request_rate_limit' }, 429, 'RATE_LIMIT'],
  ];
  let next;
  const { client } = await fixture(t, { initialSession: session(), fetch: async () => response(next[0], next[1]) });
  for (next of errors) await assert.rejects(client.fetchAdminPlayers(), error => error.code === next[2]);
});
