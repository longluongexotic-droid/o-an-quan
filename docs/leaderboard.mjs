import { SUPABASE_CONFIG } from './leaderboard-config.mjs';

const REQUEST_TIMEOUT = 12000;
const REFRESH_MARGIN = 60;
let memorySession = null;
let storageUnavailable = false;
let authRequest = null;

export class LeaderboardError extends Error {
  constructor(message, code = 'UNAVAILABLE') {
    super(message);
    this.name = 'LeaderboardError';
    this.code = code;
  }
}

export function normalizePlayerName(value) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new LeaderboardError('Tên không được chứa ký tự điều khiển hoặc ký tự ẩn.', 'INVALID_NAME');
  }
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || Array.from(name).length > 24) {
    throw new LeaderboardError('Nhập tên từ 1 đến 24 ký tự.', 'INVALID_NAME');
  }
  return name;
}

function configuration() {
  const url = SUPABASE_CONFIG.url?.trim().replace(/\/+$/, '');
  const publicKey = SUPABASE_CONFIG.publicKey?.trim();
  if (!url || !publicKey) {
    throw new LeaderboardError('Bảng xếp hạng đang chờ kết nối. Bạn vẫn có thể chơi.', 'NOT_CONFIGURED');
  }
  let parsed;
  try { parsed = new URL(url); } catch { /* Report a useful configuration error below. */ }
  let secret = publicKey.startsWith('sb_secret_');
  if (publicKey.split('.').length === 3) {
    try {
      const payload = publicKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      secret ||= JSON.parse(atob(payload)).role === 'service_role';
    } catch { /* The API will reject an invalid public key. */ }
  }
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || secret) {
    throw new LeaderboardError('Kết nối bảng xếp hạng chưa được cấu hình đúng.', 'CONFIGURATION');
  }
  return { url, publicKey, storageKey: `oaq:leaderboard:session:${parsed.host}` };
}

export function isLeaderboardConfigured() {
  try { configuration(); return true; } catch { return false; }
}

function validSession(value) {
  return value && typeof value === 'object'
    && typeof value.access_token === 'string' && value.access_token.length > 0 && value.access_token.length < 16384
    && typeof value.refresh_token === 'string' && value.refresh_token.length > 0 && value.refresh_token.length < 16384
    && typeof value.user_id === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value.user_id)
    && Number.isFinite(value.expires_at) && value.expires_at > 0;
}

function storedSession(config) {
  if (storageUnavailable) return memorySession;
  let raw;
  try { raw = globalThis.localStorage?.getItem(config.storageKey); }
  catch { storageUnavailable = true; return memorySession; }
  if (!raw) return memorySession;
  let value;
  try { value = JSON.parse(raw); } catch { /* Preserve an existing identity instead of replacing it. */ }
  if (!validSession(value)) {
    throw new LeaderboardError('Không thể khôi phục phiên lưu điểm trên trình duyệt này. Lượt chơi vẫn được giữ trên màn hình.', 'SESSION_INVALID');
  }
  memorySession = value;
  return value;
}

function saveSession(config, value) {
  memorySession = value;
  if (storageUnavailable) return;
  try { globalThis.localStorage?.setItem(config.storageKey, JSON.stringify(value)); }
  catch { storageUnavailable = true; }
}

function sessionFromResponse(data, previous) {
  const expiresAt = Number.isFinite(data?.expires_at) ? data.expires_at
    : Number.isFinite(data?.expires_in) ? Math.floor(Date.now() / 1000) + data.expires_in : NaN;
  const value = {
    access_token: data?.access_token,
    refresh_token: data?.refresh_token,
    expires_at: expiresAt,
    user_id: data?.user?.id,
  };
  if (!validSession(value) || (previous && previous.user_id !== value.user_id)) {
    throw new LeaderboardError('Máy chủ trả về phiên lưu điểm không hợp lệ. Vui lòng thử lại.', 'INVALID_RESPONSE');
  }
  return value;
}

function aborted() {
  return new LeaderboardError('Đã dừng kết nối bảng xếp hạng.', 'ABORTED');
}

function apiError(status, data, context) {
  if (status === 429) return new LeaderboardError('Đã gửi quá nhiều yêu cầu. Vui lòng chờ một lát rồi thử lại.', 'RATE_LIMIT');
  if (context === 'refresh' && (status === 400 || status === 401 || status === 403)) {
    return new LeaderboardError('Phiên lưu điểm đã hết hiệu lực. Điểm đã lưu vẫn còn trên bảng xếp hạng; lượt này chưa gửi được.', 'SESSION_EXPIRED');
  }
  if (context === 'signup' && (data?.code === 'anonymous_provider_disabled' || data?.error_code === 'anonymous_provider_disabled')) {
    return new LeaderboardError('Dịch vụ lưu điểm chưa bật đăng nhập khách. Bạn vẫn có thể chơi.', 'AUTH_DISABLED');
  }
  if (context === 'submit' && data?.code === '22023') {
    return new LeaderboardError('Không thể xác nhận lượt chơi này. Hãy chơi lại rồi gửi kết quả.', 'INVALID_GAME');
  }
  if (status === 401 || status === 403) return new LeaderboardError('Chưa thể xác thực quyền truy cập bảng xếp hạng. Vui lòng thử lại.', 'AUTHORIZATION');
  if (status === 404 || data?.code === 'PGRST202') return new LeaderboardError('Dịch vụ bảng xếp hạng chưa sẵn sàng. Bạn vẫn có thể chơi.', 'NOT_READY');
  return new LeaderboardError('Chưa kết nối được bảng xếp hạng. Vui lòng thử lại sau.', 'SERVER');
}

async function request(config, path, body, { token, signal, context = 'read' } = {}) {
  if (signal?.aborted) throw aborted();
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT);
  try {
    const headers = { apikey: config.publicKey, 'Content-Type': 'application/json' };
    // Publishable keys belong only in apikey; Authorization must contain a user JWT.
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${config.url}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    let data;
    try { data = await response.json(); }
    catch {
      if (!response.ok) throw apiError(response.status, null, context);
      throw new LeaderboardError('Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại.', 'INVALID_RESPONSE');
    }
    if (!response.ok) throw apiError(response.status, data, context);
    return data;
  } catch (error) {
    if (timedOut) throw new LeaderboardError('Kết nối quá chậm. Vui lòng thử lại; điểm trên màn hình vẫn được giữ.', 'TIMEOUT');
    if (signal?.aborted) throw aborted();
    if (error instanceof LeaderboardError) throw error;
    throw new LeaderboardError('Không có kết nối mạng. Vui lòng thử lại khi có mạng.', 'NETWORK');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

async function identity(config, { create = false, forceRefresh = false, signal } = {}) {
  if (signal?.aborted) throw aborted();
  if (authRequest) {
    await authRequest;
    if (signal?.aborted) throw aborted();
    // Re-read storage after another caller has created/refreshed the same identity.
    const saved = storedSession(config);
    if (saved && saved.expires_at > Date.now() / 1000 + REFRESH_MARGIN) return saved;
  }
  const update = async () => {
    if (signal?.aborted) throw aborted();
    const previous = storedSession(config);
    if (previous && !forceRefresh && previous.expires_at > Date.now() / 1000 + REFRESH_MARGIN) return previous;
    if (!previous && !create) return null;
    const data = previous
      ? await request(config, '/auth/v1/token?grant_type=refresh_token', { refresh_token: previous.refresh_token }, { signal, context: 'refresh' })
      : await request(config, '/auth/v1/signup', { data: {} }, { signal, context: 'signup' });
    const session = sessionFromResponse(data, previous);
    saveSession(config, session);
    return session;
  };
  // A browser-wide lock prevents two tabs from creating two people or racing
  // rotating refresh tokens. With blocked storage, this tab keeps its session.
  authRequest = withIdentityLock(config.storageKey, update, signal);
  try { return await authRequest; }
  catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw aborted();
    throw error;
  } finally { authRequest = null; }
}

async function withIdentityLock(key, update, signal) {
  if (!globalThis.navigator?.locks?.request) return update();
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT);
  try {
    return await globalThis.navigator.locks.request(key, { mode: 'exclusive', signal: controller.signal }, () => {
      clearTimeout(timer);
      return update();
    });
  } catch (error) {
    if (timedOut) throw new LeaderboardError('Một cửa sổ khác đang kết nối bảng xếp hạng. Vui lòng thử lại sau.', 'TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

function validScore(score) {
  return Number.isInteger(score) && score >= 0 && score <= 38;
}

function responseError() {
  return new LeaderboardError('Dữ liệu bảng xếp hạng không hợp lệ. Vui lòng thử lại.', 'INVALID_RESPONSE');
}

async function rpc(config, name, body, session, signal, context) {
  try {
    return await request(config, `/rest/v1/rpc/${name}`, body, { token: session?.access_token, signal, context });
  } catch (error) {
    if (session && error?.code === 'AUTHORIZATION') {
      const refreshed = await identity(config, { forceRefresh: true, signal });
      return request(config, `/rest/v1/rpc/${name}`, body, { token: refreshed.access_token, signal, context });
    }
    throw error;
  }
}

export async function fetchTop20({ signal } = {}) {
  const config = configuration();
  const session = await identity(config, { signal });
  const data = await rpc(config, 'oaq_top20', {}, session, signal, 'read');
  if (!Array.isArray(data) || data.length > 20) throw responseError();
  return data.map((row, index) => {
    let name;
    try { name = normalizePlayerName(row?.name); } catch { throw responseError(); }
    if (row.rank !== index + 1 || !validScore(row.score) || typeof row.is_me !== 'boolean'
      || typeof row.achieved_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(row.achieved_at)
      || !Number.isFinite(Date.parse(row.achieved_at))) throw responseError();
    return { rank: row.rank, name, score: row.score, achieved_at: row.achieved_at, is_me: row.is_me };
  });
}

export async function submitScore({ name, moves, signal } = {}) {
  const cleanName = normalizePlayerName(name);
  if (!Array.isArray(moves) || !moves.length || moves.length > 3 || moves.some(move => !move
    || !Number.isInteger(move.pit) || move.pit < 7 || move.pit > 11 || (move.direction !== 1 && move.direction !== -1))) {
    throw new LeaderboardError('Lượt chơi không hợp lệ. Hãy hoàn thành ván chơi trước khi gửi điểm.', 'INVALID_GAME');
  }
  const config = configuration();
  const session = await identity(config, { create: true, signal });
  const data = await rpc(config, 'oaq_submit_score', {
    p_name: cleanName,
    p_moves: moves.map(({ pit, direction }) => ({ pit, direction })),
  }, session, signal, 'submit');
  if (!validScore(data?.score) || !validScore(data?.best_score) || data.best_score < data.score
    || typeof data?.improved !== 'boolean' || (data.improved && data.best_score !== data.score)) throw responseError();
  return { score: data.score, best_score: data.best_score, improved: data.improved };
}
