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
    throw new LeaderboardError('Trò chơi đang chờ kết nối máy chủ. Cần kết nối trực tuyến trước khi chơi.', 'NOT_CONFIGURED');
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
    throw new LeaderboardError('Không thể khôi phục phiên chơi trên trình duyệt này. Chưa thể tiếp tục ván chơi.', 'SESSION_INVALID');
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
    return new LeaderboardError('Phiên chơi đã hết hiệu lực. Dữ liệu đã lưu vẫn còn trên máy chủ; chưa thể tiếp tục ván chơi.', 'SESSION_EXPIRED');
  }
  if (context === 'signup' && (data?.code === 'anonymous_provider_disabled' || data?.error_code === 'anonymous_provider_disabled')) {
    return new LeaderboardError('Máy chủ chưa bật đăng nhập khách. Chưa thể bắt đầu ván chơi.', 'AUTH_DISABLED');
  }
  const gameErrors = {
    NAME_LOCKED: 'Tên của bạn đã được chốt và không thể thay đổi.',
    NAME_TAKEN: 'Tên này đã có người dùng. Hãy chọn tên khác.',
    ATTEMPT_LIMIT: 'Bạn đã dùng đủ 3 lần chơi. Điểm tốt nhất của bạn đã được giữ lại.',
    GAME_CONFLICT: 'Ván chơi đã thay đổi ở cửa sổ khác. Hãy tải lại ván để tiếp tục.',
    NAME_REQUIRED: 'Bạn cần đăng ký tên trước khi bắt đầu chơi.',
    INVALID_MOVE: 'Nước đi này không hợp lệ. Hãy đồng bộ lại ván chơi rồi thử lại.',
  };
  if (data?.code === 'P0001' && Object.hasOwn(gameErrors, data.message)) {
    return new LeaderboardError(gameErrors[data.message], data.message);
  }
  if (data?.code === '22023') {
    if (context === 'register') return new LeaderboardError('Tên đăng ký không hợp lệ. Hãy nhập tên từ 1 đến 24 ký tự.', 'INVALID_NAME');
    return new LeaderboardError('Không thể xác nhận yêu cầu này. Hãy đồng bộ lại ván chơi rồi thử lại.', 'INVALID_GAME');
  }
  if (status === 401 || status === 403) return new LeaderboardError('Chưa thể xác thực quyền truy cập bảng xếp hạng. Vui lòng thử lại.', 'AUTHORIZATION');
  if (status === 404 || data?.code === 'PGRST202') return new LeaderboardError('Máy chủ trò chơi chưa sẵn sàng. Cần kết nối trực tuyến trước khi chơi.', 'NOT_READY');
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
    if (timedOut) throw new LeaderboardError('Kết nối quá chậm. Vui lòng thử lại để đồng bộ ván chơi.', 'TIMEOUT');
    if (signal?.aborted) throw aborted();
    if (error instanceof LeaderboardError) throw error;
    throw new LeaderboardError('Cần kết nối mạng để chơi. Vui lòng thử lại khi có mạng.', 'NETWORK');
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
  return new LeaderboardError('Dữ liệu trò chơi không hợp lệ. Vui lòng đồng bộ lại rồi thử lại.', 'INVALID_RESPONSE');
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

export async function fetchTop10({ signal } = {}) {
  const config = configuration();
  const session = await identity(config, { signal });
  const data = await rpc(config, 'oaq_top10', {}, session, signal, 'read');
  if (!Array.isArray(data) || data.length > 10) throw responseError();
  return data.map((row, index) => {
    let name;
    try { name = normalizePlayerName(row?.name); } catch { throw responseError(); }
    if (row.rank !== index + 1 || !validScore(row.score) || typeof row.is_me !== 'boolean'
      || typeof row.achieved_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(row.achieved_at)
      || !Number.isFinite(Date.parse(row.achieved_at))) throw responseError();
    return { rank: row.rank, name, score: row.score, achieved_at: row.achieved_at, is_me: row.is_me };
  });
}

const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function validMove(move) {
  return move && typeof move === 'object' && Number.isInteger(move.pit)
    && move.pit >= 7 && move.pit <= 11 && (move.direction === 1 || move.direction === -1);
}

function cleanMoves(moves) {
  return moves.map(({ pit, direction }) => ({ pit, direction }));
}

function profileFromResponse(data, { nullable = false } = {}) {
  if (data === null && nullable) return null;
  let name;
  try { name = normalizePlayerName(data?.name); } catch { throw responseError(); }
  if (!Number.isInteger(data.attempts_used) || data.attempts_used < 0 || data.attempts_used > 3
    || data.attempts_left !== 3 - data.attempts_used || (data.best_score !== null && !validScore(data.best_score))) throw responseError();
  let game = null;
  if (data.active_game !== null) {
    if (data.attempts_used === 0) throw responseError();
    const value = data.active_game;
    if (!value || typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)
      || !Array.isArray(value.moves) || value.moves.length > 3 || value.moves.some(move => !validMove(move))
      || (value.status !== 'active' && value.status !== 'completed')
      || (value.score !== null && !validScore(value.score))) throw responseError();
    if (value.status === 'completed' && (value.moves.length < 2 || !validScore(value.score)
      || !validScore(data.best_score) || data.best_score < value.score)) throw responseError();
    if (value.status === 'active' && (value.moves.length >= 3 || value.score !== null)) throw responseError();
    game = { id: value.id, moves: cleanMoves(value.moves), status: value.status, score: value.score };
  }
  return { name, attempts_used: data.attempts_used, attempts_left: data.attempts_left, best_score: data.best_score, active_game: game };
}

async function playerRpc(name, body, { signal, context = 'status', nullable = false } = {}) {
  const config = configuration();
  const session = await identity(config, { create: true, signal });
  const data = await rpc(config, name, body, session, signal, context);
  return profileFromResponse(data, { nullable });
}

export async function getPlayerStatus({ signal } = {}) {
  return playerRpc('oaq_player_status', {}, { signal, nullable: true });
}

export async function registerPlayer({ name, signal } = {}) {
  return playerRpc('oaq_register_player', { p_name: normalizePlayerName(name) }, { signal, context: 'register' });
}

export async function startGame({ requestId, signal } = {}) {
  if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
    throw new LeaderboardError('Mã yêu cầu bắt đầu ván không hợp lệ. Vui lòng thử lại.', 'INVALID_GAME');
  }
  return playerRpc('oaq_start_game', { p_request_id: requestId }, { signal, context: 'start' });
}

export async function playGameMove({ gameId, expectedMoves, move, signal } = {}) {
  if (typeof gameId !== 'string' || !UUID_PATTERN.test(gameId)) {
    throw new LeaderboardError('Mã ván chơi không hợp lệ. Vui lòng đồng bộ lại ván chơi.', 'INVALID_GAME');
  }
  if (!Array.isArray(expectedMoves) || expectedMoves.length > 2 || expectedMoves.some(value => !validMove(value)) || !validMove(move)) {
    throw new LeaderboardError('Nước đi không hợp lệ. Vui lòng đồng bộ lại ván chơi rồi thử lại.', 'INVALID_MOVE');
  }
  return playerRpc('oaq_play_move', {
    p_game_id: gameId,
    p_expected_moves: cleanMoves(expectedMoves),
    p_move: { pit: move.pit, direction: move.direction },
  }, { signal, context: 'move' });
}
