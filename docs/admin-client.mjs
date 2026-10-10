import { SUPABASE_CONFIG } from './leaderboard-config.mjs';
import { normalizePlayerName } from './leaderboard.mjs';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const TIMEOUT = 12000;
let memorySession = null;
let authRequest = null;
let logoutRequest = null;
let storageUnavailable = false;

export class AdminError extends Error {
  constructor(message, code = 'SERVER') { super(message);this.name = 'AdminError';this.code = code; }
}

function config() {
  let url;
  try { url = new URL(SUPABASE_CONFIG.url); } catch { /* Reject below. */ }
  const key = SUPABASE_CONFIG.publicKey?.trim();
  let secret = key?.startsWith('sb_secret_');
  if (key?.split('.').length === 3) {
    try { secret ||= JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'; } catch { /* API rejects invalid keys. */ }
  }
  if (!url || url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password || !key || secret) {
    throw new AdminError('Kết nối quản lý chưa được cấu hình đúng.', 'CONFIGURATION');
  }
  return { url: url.origin, key, storageKey: `oaq:admin:session:${url.host}` };
}

const invalid = () => new AdminError('Máy chủ trả về dữ liệu không hợp lệ. Hãy tải lại trang.', 'INVALID_RESPONSE');
const score = value => value === null || (Number.isInteger(value) && value >= 0 && value <= 38);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
function sessionValid(value) {
  return value && UUID.test(value.user_id) && typeof value.access_token === 'string' && value.access_token.length > 0 && value.access_token.length < 16384
    && typeof value.refresh_token === 'string' && value.refresh_token.length > 0 && value.refresh_token.length < 16384
    && Number.isFinite(value.expires_at) && value.expires_at > 0;
}
function stored(c) {
  if (storageUnavailable) return memorySession;
  let raw;
  try {
    if (!globalThis.localStorage) { storageUnavailable = true;return memorySession; }
    raw = globalThis.localStorage.getItem(c.storageKey);
  } catch { storageUnavailable = true;return memorySession; }
  if (!raw) { memorySession = null;return null; }
  let value;
  try { value = JSON.parse(raw); } catch { /* Preserve corrupt state for an explicit logout. */ }
  if (!sessionValid(value)) throw new AdminError('Phiên quản trị không hợp lệ. Hãy đăng xuất rồi đăng nhập lại.', 'SESSION_INVALID');
  memorySession = value;
  return value;
}
function save(c, value) {
  memorySession = value;
  if (storageUnavailable) return;
  try {
    if (value) globalThis.localStorage?.setItem(c.storageKey, JSON.stringify(value));
    else globalThis.localStorage?.removeItem(c.storageKey);
  } catch { storageUnavailable = true; }
}
function fromResponse(data, previous) {
  const value = {
    access_token: data?.access_token, refresh_token: data?.refresh_token, user_id: data?.user?.id,
    expires_at: Number.isFinite(data?.expires_at) ? data.expires_at : Number.isFinite(data?.expires_in) ? Date.now() / 1000 + data.expires_in : NaN,
  };
  if (!sessionValid(value) || (previous && previous.user_id !== value.user_id)) throw invalid();
  return value;
}
function serverError(response, data) {
  const messages = {
    ADMIN_REQUIRED: ['Email này không có quyền quản lý Bảng Vàng.', 'FORBIDDEN'],
    ADMIN_CONFLICT: ['Hồ sơ đã thay đổi. Hãy tải lại dữ liệu trước khi chỉnh sửa.', 'CONFLICT'],
    NAME_TAKEN: ['Tên này đã có người dùng. Hãy chọn tên khác.', 'NAME_TAKEN'],
    PLAYER_NOT_FOUND: ['Không tìm thấy người chơi. Hãy tải lại danh sách.', 'NOT_FOUND'],
    REQUEST_CONFLICT: ['Yêu cầu lưu đã được dùng cho một thay đổi khác. Hãy tải lại dữ liệu.', 'CONFLICT'],
    ADMIN_REQUEST_CONFLICT: ['Yêu cầu lưu đã được dùng cho một thay đổi khác. Hãy tải lại dữ liệu.', 'CONFLICT'],
    INVALID_NAME: ['Tên cần có 1–24 ký tự hợp lệ.', 'INVALID_NAME'],
  };
  if (messages[data?.message]) return new AdminError(...messages[data.message]);
  if (response.status === 429 || data?.error_code === 'over_email_send_rate_limit') return new AdminError('Đã đạt giới hạn gửi liên kết. Hãy chờ một lát rồi thử lại.', 'RATE_LIMIT');
  if (data?.code === 'email_address_not_authorized' || data?.error_code === 'email_address_not_authorized') return new AdminError('Dịch vụ email chưa cho phép gửi tới địa chỉ này. Cần cấu hình email trên Supabase.', 'EMAIL_DELIVERY');
  if (response.status === 401) return new AdminError('Phiên quản trị đã hết hạn. Hãy đăng nhập lại.', 'AUTHORIZATION');
  if (response.status === 403 || data?.code === '42501') return new AdminError('Bạn không có quyền quản lý Bảng Vàng.', 'FORBIDDEN');
  if (data?.code === '22023') return new AdminError('Thông tin chỉnh sửa không hợp lệ. Hãy kiểm tra lại.', 'INVALID_INPUT');
  if (response.status === 404 || data?.code === 'PGRST202') return new AdminError('Máy chủ quản lý chưa sẵn sàng. Hãy thử lại sau.', 'NOT_READY');
  return new AdminError('Chưa kết nối được máy chủ. Hãy thử lại.', 'SERVER');
}
async function request(c, path, { body, token, method = 'POST' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const headers = { apikey: c.key };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(c.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    const raw = await response.text();
    let data = null;
    try { if (raw) data = JSON.parse(raw); } catch { if (response.ok) throw invalid(); }
    if (!response.ok) {
      if (path.startsWith('/auth/v1/token?') && [400, 401, 403].includes(response.status)) {
        throw new AdminError('Phiên quản trị đã hết hạn. Hãy đăng nhập lại bằng liên kết mới.', 'AUTHORIZATION');
      }
      throw serverError(response, data);
    }
    return data;
  } catch (error) {
    if (error instanceof AdminError) throw error;
    if (controller.signal.aborted) throw new AdminError('Kết nối quá chậm. Hãy thử lại.', 'TIMEOUT');
    throw new AdminError('Mất kết nối mạng. Hãy thử lại khi có mạng.', 'NETWORK');
  } finally { clearTimeout(timer); }
}
async function identity(c, force = false) {
  if (logoutRequest) { try { await logoutRequest; } catch { /* Local logout still clears this session. */ }return null; }
  if (authRequest) await authRequest;
  const update = async () => {
    const previous = stored(c);
    if (!previous) return null;
    if (!force && previous.expires_at > Date.now() / 1000 + 60) return previous;
    const data = await request(c, '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: previous.refresh_token } });
    const next = fromResponse(data, previous);
    save(c, next);
    return next;
  };
  const locks = globalThis.navigator?.locks;
  authRequest = locks ? locks.request(c.storageKey, { mode: 'exclusive', signal: AbortSignal.timeout(TIMEOUT) }, update) : update();
  try { return await authRequest; }
  catch (error) {
    if (error?.name === 'TimeoutError') throw new AdminError('Một cửa sổ khác đang kết nối. Hãy thử lại.', 'TIMEOUT');
    throw error;
  } finally { authRequest = null; }
}
async function rpc(name, body = {}) {
  const c = config();
  let session = await identity(c);
  if (!session) throw new AdminError('Hãy đăng nhập để quản lý Bảng Vàng.', 'AUTHORIZATION');
  try { return await request(c, `/rest/v1/rpc/${name}`, { body, token: session.access_token }); }
  catch (error) {
    if (error.code !== 'AUTHORIZATION') throw error;
    session = await identity(c, true);
    if (!session) throw new AdminError('Hãy đăng nhập để quản lý Bảng Vàng.', 'AUTHORIZATION');
    return request(c, `/rest/v1/rpc/${name}`, { body, token: session.access_token });
  }
}
function adminStatus(data) {
  if (!data || typeof data.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw invalid();
  return { email: data.email };
}

export async function sendLoginLink({ email } = {}) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new AdminError('Hãy nhập email hợp lệ.', 'INVALID_EMAIL');
  const redirect = new URL('./admin.html', globalThis.location.href);
  redirect.search = '';redirect.hash = '';
  if (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(redirect.hostname))) throw new AdminError('Đường dẫn đăng nhập không hợp lệ.', 'CONFIGURATION');
  await request(config(), `/auth/v1/otp?redirect_to=${encodeURIComponent(redirect.href)}`, { body: { email: email.trim().toLowerCase(), create_user: true } });
}
export async function consumeLoginCallback() {
  const hash = new URLSearchParams(globalThis.location.hash.slice(1));
  if (!hash.has('access_token') && !hash.has('refresh_token') && !hash.has('error') && !hash.has('error_code')) return false;
  // Remove credentials before any asynchronous work or link navigation.
  globalThis.history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search);
  if (hash.has('error') || hash.has('error_code')) throw new AdminError('Liên kết đăng nhập không hợp lệ hoặc đã hết hạn. Hãy gửi liên kết mới.', 'LOGIN_EXPIRED');
  const c = config();
  const access = hash.get('access_token');
  const refresh = hash.get('refresh_token');
  const seconds = Number(hash.get('expires_in'));
  if (!access || access.length >= 16384 || !refresh || refresh.length >= 16384 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) throw invalid();
  const user = await request(c, '/auth/v1/user', { method: 'GET', token: access });
  if (!user || !UUID.test(user.id) || user.is_anonymous !== false || !date(user.email_confirmed_at)) throw new AdminError('Cần xác minh email trước khi quản lý Bảng Vàng.', 'FORBIDDEN');
  adminStatus(await request(c, '/rest/v1/rpc/oaq_admin_status', { body: {}, token: access }));
  save(c, fromResponse({ access_token: access, refresh_token: refresh, expires_in: seconds, user }));
  return true;
}
export async function getAdminStatus() {
  const c = config();
  if (!stored(c)) return null;
  return adminStatus(await rpc('oaq_admin_status'));
}
export async function signOutAdmin() {
  if (logoutRequest) return logoutRequest;
  const c = config();
  const logout = async () => {
    if (authRequest) { try { await authRequest; } catch { /* Explicit logout clears a failed refresh. */ } }
    const clear = async () => {
      let session;
      try { session = stored(c); } catch { /* Explicit logout can clear corrupt sessions. */ }
      try { if (session) await request(c, '/auth/v1/logout?scope=local', { token: session.access_token }); }
      finally { save(c, null); }
    };
    const locks = globalThis.navigator?.locks;
    try {
      if (locks) await locks.request(c.storageKey, { mode: 'exclusive', signal: AbortSignal.timeout(TIMEOUT) }, clear);
      else await clear();
    } finally { save(c, null); }
  };
  logoutRequest = logout();
  try { await logoutRequest; } finally { logoutRequest = null; }
}
function pagination(offset, limit) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new AdminError('Phân trang không hợp lệ.', 'INVALID_INPUT');
}
function player(data) {
  let name;
  try { name = normalizePlayerName(data?.name); } catch { throw invalid(); }
  if (!UUID.test(data?.id) || !score(data.best_score) || !score(data.effective_score) || !score(data.override_score)
    || typeof data.override_enabled !== 'boolean' || typeof data.is_hidden !== 'boolean'
    || !Number.isInteger(data.attempts_used) || data.attempts_used < 0 || data.attempts_used > 3
    || !Number.isSafeInteger(data.revision) || data.revision < 0
    || data.effective_score !== (data.override_enabled ? data.override_score : data.best_score)
    || (data.achieved_at !== null && !date(data.achieved_at))
    || (data.effective_score === null) !== (data.achieved_at === null)) throw invalid();
  return { id: data.id, name, best_score: data.best_score, effective_score: data.effective_score, override_enabled: data.override_enabled,
    override_score: data.override_score, is_hidden: data.is_hidden, attempts_used: data.attempts_used, revision: data.revision, achieved_at: data.achieved_at };
}
export async function fetchAdminPlayers({ search = '', offset = 0, limit = 25 } = {}) {
  pagination(offset, limit);
  if (typeof search !== 'string' || Array.from(search).length > 80) throw new AdminError('Từ khóa tìm kiếm quá dài.', 'INVALID_INPUT');
  const data = await rpc('oaq_admin_players', { p_search: search.normalize('NFC').trim(), p_offset: offset, p_limit: limit });
  if (!data || !Array.isArray(data.players) || data.players.length > limit || !Number.isSafeInteger(data.total) || data.total < data.players.length) throw invalid();
  return { players: data.players.map(player), total: data.total };
}
export async function saveAdminPlayer({ id, name, overrideEnabled, overrideScore, isHidden, reason, expectedRevision, requestId } = {}) {
  let normalized;
  try { normalized = normalizePlayerName(name); } catch (error) { throw new AdminError(error.message, 'INVALID_NAME'); }
  if (!UUID.test(id) || !UUID.test(requestId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || typeof overrideEnabled !== 'boolean' || typeof isHidden !== 'boolean' || !score(overrideScore)
    || typeof reason !== 'string' || !reason.trim() || Array.from(reason.trim()).length > 200 || /[\p{Cc}\p{Cf}]/u.test(reason)) throw new AdminError('Hãy kiểm tra thông tin và nhập lý do chỉnh sửa (1–200 ký tự, một dòng).', 'INVALID_INPUT');
  return player(await rpc('oaq_admin_save_player', { p_id: id, p_name: normalized, p_override_enabled: overrideEnabled,
    p_override_score: overrideEnabled ? overrideScore : null, p_is_hidden: isHidden,
    p_expected_revision: expectedRevision, p_request_id: requestId, p_reason: reason.trim() }));
}
export async function fetchAdminAudit({ playerId = null, offset = 0, limit = 25 } = {}) {
  pagination(offset, limit);
  if (playerId !== null && !UUID.test(playerId)) throw new AdminError('Mã người chơi không hợp lệ.', 'INVALID_INPUT');
  const data = await rpc('oaq_admin_audit', { p_player_id: playerId, p_offset: offset, p_limit: limit });
  if (!data || !Array.isArray(data.entries) || data.entries.length > limit || !Number.isSafeInteger(data.total) || data.total < data.entries.length) throw invalid();
  const entries = data.entries.map(value => {
    if (!value || !UUID.test(value.id) || !date(value.created_at) || typeof value.actor_email !== 'string' || typeof value.player_name !== 'string'
      || typeof value.action !== 'string' || typeof value.reason !== 'string' || !value.before || !value.after) throw invalid();
    const before = player(value.before);
    const after = player(value.after);
    if (before.id !== after.id || after.name !== value.player_name) throw invalid();
    return { id: value.id, created_at: value.created_at, actor_email: value.actor_email, player_name: value.player_name,
      action: value.action, before, after, reason: value.reason };
  });
  return { entries, total: data.total };
}
