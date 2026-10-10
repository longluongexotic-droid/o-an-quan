import {
  deleteAdminPlayer,
  fetchAdminAudit,
  fetchAdminPlayers,
  getAdminStatus,
  saveAdminPlayer,
  signInAdmin,
  signOutAdmin,
} from './admin-client.mjs?v=admin-delete-1';

const $ = (id) => document.getElementById(id);
const pageSize = 20;
const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
let authenticated = false;
let sessionEpoch = 0;
let playersOffset = 0;
let playersTotal = 0;
let playersLoading = false;
let playersRequest = 0;
let search = '';
let players = new Map();
let auditOffset = 0;
let auditTotal = 0;
let auditLoading = false;
let auditRequest = 0;
let editingPlayer = null;
let originalEdit = '';
let pendingSave = null;
let pendingDelete = null;
let deleteConfirmation = false;
let saving = false;
let deleting = false;
let editMutation = 0;
let loggingOut = false;

function status(id, message = '', tone = '') {
  const node = $(id);
  node.textContent = message;
  node.classList.toggle('error', tone === 'error');
  node.classList.toggle('success', tone === 'success');
}

function errorMessage(error) {
  const messages = {
    FORBIDDEN: 'Tài khoản này chưa được cấp quyền quản lý Bảng Vàng.',
    UNAUTHORIZED: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',
    AUTHORIZATION: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',
    INVALID_PASSWORD: 'Mật khẩu quản lý chưa đúng. Hãy thử lại.',
    INVALID_CREDENTIALS: 'Mật khẩu quản lý chưa đúng. Hãy thử lại.',
    invalid_credentials: 'Mật khẩu quản lý chưa đúng. Hãy thử lại.',
    ADMIN_CONFLICT: 'Thông tin đã được sửa ở nơi khác. Đóng cửa sổ này và làm mới danh sách trước khi chỉnh lại.',
    GAME_CONFLICT: 'Thông tin đã thay đổi. Đóng cửa sổ này và làm mới danh sách trước khi chỉnh lại.',
    NAME_TAKEN: 'Tên này đã thuộc về một người chơi khác. Hãy chọn tên khác.',
    INVALID_NAME: 'Tên người chơi cần có 1–24 ký tự.',
    PLAYER_NOT_FOUND: 'Người chơi này đã được xóa. Đóng cửa sổ và làm mới danh sách.',
    NETWORK_ERROR: 'Chưa kết nối được máy chủ. Hãy thử lại; thay đổi sẽ không bị gửi trùng.',
    NETWORK: 'Chưa kết nối được máy chủ. Hãy thử lại; thay đổi sẽ không bị gửi trùng.',
    CONFLICT: 'Thông tin đã thay đổi. Đóng cửa sổ này và làm mới danh sách trước khi chỉnh lại.',
    TIMEOUT: 'Máy chủ phản hồi chậm. Hãy thử lại để kiểm tra thay đổi.',
  };
  return messages[error?.code] || error?.message || 'Chưa thực hiện được thao tác. Hãy thử lại.';
}

function readableDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function scoreText(value) {
  return value === null || value === undefined ? 'Chưa có điểm' : `${value} điểm`;
}

function setSignedOut() {
  authenticated = false;
  sessionEpoch += 1;
  $('admin-workspace').hidden = true;
  $('admin-login').hidden = false;
  $('admin-current-email').textContent = '';
  $('admin-player-rows').replaceChildren();
  $('admin-audit-list').replaceChildren();
  players.clear();
  playersOffset = 0;
  playersTotal = 0;
  auditOffset = 0;
  auditTotal = 0;
  setPlayersLoading(false);
  auditLoading = false;
  $('admin-audit-refresh').disabled = false;
  pagination('audit', 0, 0, false);
  editingPlayer = null;
  pendingSave = null;
  pendingDelete = null;
  setEditingBusy();
  setDeleteVisible(false);
  if ($('admin-edit-dialog').open) $('admin-edit-dialog').close();
}

function handleAuthError(error) {
  if (!['AUTHORIZATION', 'UNAUTHORIZED', 'SESSION_INVALID', 'FORBIDDEN'].includes(error?.code)) return false;
  setSignedOut();
  $('admin-login-signout').hidden = false;
  status('admin-auth-status', errorMessage(error), 'error');
  status('admin-login-status', 'Nhập mật khẩu quản lý để đăng nhập lại.');
  return true;
}

function pagination(kind, offset, total, loading) {
  $(`admin-${kind}-prev`).disabled = loading || offset === 0;
  $(`admin-${kind}-next`).disabled = loading || offset + pageSize >= total;
  $(`admin-${kind}-page`).textContent = `Trang ${Math.floor(offset / pageSize) + 1} / ${Math.max(1, Math.ceil(total / pageSize))}`;
}

function setPlayersLoading(value) {
  playersLoading = value;
  $('admin-refresh').disabled = value;
  $('admin-search-form').querySelector('button').disabled = value;
  for (const button of $('admin-player-rows').querySelectorAll('button')) button.disabled = value;
  pagination('players', playersOffset, playersTotal, value);
}

function renderPlayers(rows) {
  players = new Map(rows.map((player) => [player.id, player]));
  const fragment = document.createDocumentFragment();
  for (const player of rows) {
    const row = element('tr');
    const nameCell = element('td');
    nameCell.dataset.label = 'Người chơi';
    nameCell.append(element('span', 'admin-player-name', player.name));
    const achieved = readableDate(player.achieved_at);
    if (achieved) nameCell.append(element('span', 'admin-player-time', `Đạt điểm: ${achieved}`));
    const scoreCell = element('td');
    scoreCell.dataset.label = 'Điểm Bảng Vàng';
    scoreCell.append(element('span', 'admin-score', scoreText(player.effective_score)));
    if (player.override_enabled) scoreCell.append(element('span', 'admin-player-time', `Chơi thực: ${scoreText(player.best_score)}`));
    const attemptsCell = element('td', '', `${player.attempts_used} / 3 ván`);
    attemptsCell.dataset.label = 'Số ván';
    const visibilityCell = element('td');
    visibilityCell.dataset.label = 'Bảng Vàng';
    const unranked = player.effective_score === null || player.effective_score === undefined;
    visibilityCell.append(element('span', `admin-state${player.is_hidden ? ' hidden-state' : unranked ? ' unranked-state' : ''}`, player.is_hidden ? 'Đang ẩn' : unranked ? 'Chưa xếp hạng' : 'Được xếp hạng'));
    const actionCell = element('td');
    const editButton = element('button', 'admin-secondary admin-row-edit', 'Chỉnh sửa');
    editButton.type = 'button';
    editButton.dataset.playerId = player.id;
    editButton.setAttribute('aria-label', `Chỉnh sửa người chơi ${player.name}`);
    actionCell.append(editButton);
    row.append(nameCell, scoreCell, attemptsCell, visibilityCell, actionCell);
    fragment.append(row);
  }
  $('admin-player-rows').replaceChildren(fragment);
}

async function loadPlayers() {
  if (!authenticated) return;
  const request = ++playersRequest;
  const epoch = sessionEpoch;
  setPlayersLoading(true);
  status('admin-players-status', 'Đang mở sổ ghi danh…');
  try {
    const result = await fetchAdminPlayers({ search, offset: playersOffset, limit: pageSize });
    if (request !== playersRequest || epoch !== sessionEpoch) return;
    playersTotal = result.total;
    if (playersOffset > 0 && playersOffset >= playersTotal) {
      playersOffset = Math.max(0, Math.ceil(playersTotal / pageSize) - 1) * pageSize;
      await loadPlayers();
      return;
    }
    renderPlayers(result.players);
    $('admin-player-count').textContent = `${playersTotal} người${search ? ' phù hợp' : ''}`;
    status('admin-players-status', result.players.length ? '' : search ? 'Không có người chơi phù hợp với tên này.' : 'Chưa có người chơi ghi danh.');
  } catch (error) {
    if (request === playersRequest && epoch === sessionEpoch) {
      if (handleAuthError(error)) return;
      status('admin-players-status', errorMessage(error), 'error');
      // A failed refresh must not leave old rows editable with stale revisions.
      $('admin-player-rows').replaceChildren();
      players.clear();
    }
  } finally {
    if (request === playersRequest && epoch === sessionEpoch) setPlayersLoading(false);
  }
}

function auditChanges(entry) {
  if (entry.action === 'delete') return 'Đã xóa người chơi';
  const before = entry.before || {};
  const after = entry.after || {};
  const changes = [];
  if (before.name !== after.name && after.name !== undefined) changes.push(`Tên: ${before.name || '—'} → ${after.name}`);
  if (before.override_enabled !== after.override_enabled || before.override_score !== after.override_score) {
    changes.push(after.override_enabled ? `Điểm đặt: ${scoreText(after.override_score)}` : 'Trở về điểm chơi thực');
  }
  if (before.is_hidden !== after.is_hidden && after.is_hidden !== undefined) changes.push(after.is_hidden ? 'Ẩn khỏi Bảng Vàng' : 'Hiện lại trên Bảng Vàng');
  return changes.length ? changes.join(' · ') : 'Đã cập nhật thông tin người chơi';
}

function renderAudit(entries) {
  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const item = element('li');
    const heading = element('div', 'admin-audit-title');
    heading.append(element('strong', '', entry.player_name || entry.after?.name || entry.before?.name || 'Người chơi'));
    const time = element('time', '', readableDate(entry.created_at));
    if (entry.created_at) time.dateTime = entry.created_at;
    heading.append(time);
    item.append(heading, element('p', 'admin-audit-changes', auditChanges(entry)));
    if (entry.reason) item.append(element('p', '', `Lý do: ${entry.reason}`));
    if (entry.actor_email) item.append(element('p', 'admin-audit-actor', 'Người thực hiện: Quản trị viên'));
    fragment.append(item);
  }
  $('admin-audit-list').replaceChildren(fragment);
}

async function loadAudit() {
  if (!authenticated) return;
  const request = ++auditRequest;
  const epoch = sessionEpoch;
  auditLoading = true;
  $('admin-audit-refresh').disabled = true;
  pagination('audit', auditOffset, auditTotal, true);
  status('admin-audit-status', 'Đang đọc lịch sử chỉnh sửa…');
  try {
    const result = await fetchAdminAudit({ playerId: null, offset: auditOffset, limit: pageSize });
    if (request !== auditRequest || epoch !== sessionEpoch) return;
    auditTotal = result.total;
    renderAudit(result.entries);
    status('admin-audit-status', result.entries.length ? '' : 'Chưa có lần chỉnh sửa nào.');
  } catch (error) {
    if (request === auditRequest && epoch === sessionEpoch && !handleAuthError(error)) status('admin-audit-status', errorMessage(error), 'error');
  } finally {
    if (request === auditRequest && epoch === sessionEpoch) {
      auditLoading = false;
      $('admin-audit-refresh').disabled = false;
      pagination('audit', auditOffset, auditTotal, false);
    }
  }
}

function editValues() {
  return {
    name: $('admin-edit-name').value.normalize('NFC').trim().replace(/\s+/gu, ' '),
    overrideEnabled: !$('admin-edit-use-earned').checked,
    overrideScore: $('admin-edit-score').value === '' ? null : Number($('admin-edit-score').value),
    isHidden: $('admin-edit-hidden').checked,
    reason: $('admin-edit-reason').value.normalize('NFC').trim(),
  };
}

function editSignature() {
  const values = editValues();
  // The inactive score field is only a convenience for the next manual edit.
  if (!values.overrideEnabled) values.overrideScore = null;
  return JSON.stringify(values);
}

function setDiscardVisible(visible) {
  if (visible) setDeleteVisible(false);
  $('admin-discard-panel').hidden = !visible;
  $('admin-edit-actions').hidden = visible || deleteConfirmation;
  if (visible) $('admin-edit-continue').focus();
}

function setDeleteVisible(visible) {
  deleteConfirmation = visible;
  $('admin-delete-panel').hidden = !visible;
  $('admin-edit-actions').hidden = visible || !$('admin-discard-panel').hidden;
  if (visible) {
    $('admin-delete-name').textContent = editingPlayer.name;
    $('admin-delete-cancel').focus();
  }
}

function isEditingBusy() {
  return saving || deleting;
}

function closeEdit(force = false) {
  if (isEditingBusy()) return;
  if (!force && editingPlayer && editSignature() !== originalEdit) {
    setDiscardVisible(true);
    return;
  }
  $('admin-edit-dialog').close();
  editingPlayer = null;
  pendingSave = null;
  pendingDelete = null;
  setDeleteVisible(false);
}

function openEdit(player) {
  if (!player || !authenticated || playersLoading || editingPlayer || isEditingBusy()) return;
  editingPlayer = player;
  pendingSave = null;
  pendingDelete = null;
  $('admin-edit-title').textContent = player.name;
  $('admin-edit-name').value = player.name;
  $('admin-edit-use-earned').checked = !player.override_enabled;
  $('admin-edit-score').value = player.override_enabled ? player.override_score ?? '' : player.best_score ?? '';
  $('admin-edit-score').disabled = !player.override_enabled;
  $('admin-edit-hidden').checked = player.is_hidden;
  $('admin-edit-reason').value = '';
  $('admin-edit-earned').textContent = `Điểm chơi thực: ${scoreText(player.best_score)}.`;
  $('admin-edit-attempts').textContent = `Đã dùng ${player.attempts_used}/3 ván. Số ván chơi được giữ nguyên.`;
  status('admin-edit-status');
  setDeleteVisible(false);
  setDiscardVisible(false);
  originalEdit = editSignature();
  $('admin-edit-dialog').showModal();
  $('admin-edit-name').focus();
}

function setEditingBusy(kind = null) {
  saving = kind === 'save';
  deleting = kind === 'delete';
  const busy = isEditingBusy();
  for (const field of $('admin-edit-form').querySelectorAll('input, textarea, button')) field.disabled = busy;
  $('admin-edit-score').disabled = busy || $('admin-edit-use-earned').checked;
  $('admin-edit-close').disabled = busy;
  $('admin-edit-save').textContent = saving ? 'Đang lưu…' : 'Lưu thay đổi →';
  $('admin-delete-confirm').textContent = deleting ? 'Đang xóa…' : 'Xóa vĩnh viễn';
}

$('admin-player-rows').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-player-id]');
  if (button) openEdit(players.get(button.dataset.playerId));
});

$('admin-edit-form').addEventListener('input', () => {
  if (isEditingBusy()) return;
  pendingSave = null;
  status('admin-edit-status');
});

$('admin-edit-use-earned').addEventListener('change', () => {
  $('admin-edit-score').disabled = $('admin-edit-use-earned').checked;
});

$('admin-edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!editingPlayer || isEditingBusy() || deleteConfirmation || !authenticated) return;
  if (!$('admin-edit-form').reportValidity()) return;
  const values = editValues();
  if (!values.name || Array.from(values.name).length > 24) {
    status('admin-edit-status', 'Tên người chơi cần có 1–24 ký tự.', 'error');
    $('admin-edit-name').focus();
    return;
  }
  if (values.overrideEnabled && values.overrideScore !== null && (!Number.isInteger(values.overrideScore) || values.overrideScore < 0 || values.overrideScore > 38)) {
    status('admin-edit-status', 'Điểm phải là số nguyên từ 0 đến 38, hoặc để trống.', 'error');
    $('admin-edit-score').focus();
    return;
  }
  if (!values.reason || Array.from(values.reason).length > 200) {
    status('admin-edit-status', 'Hãy ghi lý do chỉnh sửa, tối đa 200 ký tự.', 'error');
    $('admin-edit-reason').focus();
    return;
  }
  const signature = editSignature();
  if (!pendingSave || pendingSave.signature !== signature) {
    pendingSave = {
      signature,
      payload: {
        id: editingPlayer.id,
        ...values,
        overrideScore: values.overrideEnabled ? values.overrideScore : null,
        expectedRevision: editingPlayer.revision,
        requestId: crypto.randomUUID(),
      },
    };
  }
  const saveEpoch = sessionEpoch;
  const saveMutation = ++editMutation;
  setEditingBusy('save');
  status('admin-edit-status', 'Đang lưu thay đổi vào Bảng Vàng…');
  try {
    await saveAdminPlayer(pendingSave.payload);
    if (saveEpoch !== sessionEpoch) return;
    setEditingBusy();
    closeEdit(true);
    status('admin-auth-status', 'Đã lưu thay đổi. Bảng Vàng công khai sẽ nhận thông tin mới khi tải lại.', 'success');
    auditOffset = 0;
    await Promise.allSettled([loadPlayers(), loadAudit()]);
  } catch (error) {
    if (saveEpoch === sessionEpoch && !handleAuthError(error)) status('admin-edit-status', errorMessage(error), 'error');
  } finally {
    if (saveEpoch === sessionEpoch && saveMutation === editMutation) setEditingBusy();
  }
});

$('admin-edit-delete').addEventListener('click', () => {
  if (!editingPlayer || isEditingBusy() || !authenticated) return;
  status('admin-edit-status');
  setDiscardVisible(false);
  setDeleteVisible(true);
});

$('admin-delete-cancel').addEventListener('click', () => {
  if (isEditingBusy()) return;
  setDeleteVisible(false);
  status('admin-edit-status');
  $('admin-edit-delete').focus();
});

$('admin-delete-confirm').addEventListener('click', async () => {
  if (!editingPlayer || isEditingBusy() || !deleteConfirmation || !authenticated) return;
  const reasonField = $('admin-edit-reason');
  if (!reasonField.reportValidity()) return;
  const reason = reasonField.value.normalize('NFC').trim();
  if (!reason || Array.from(reason).length > 200) {
    status('admin-edit-status', 'Hãy ghi lý do xóa, tối đa 200 ký tự.', 'error');
    reasonField.focus();
    return;
  }
  const signature = JSON.stringify({ id: editingPlayer.id, revision: editingPlayer.revision, reason });
  if (!pendingDelete || pendingDelete.signature !== signature) {
    pendingDelete = {
      signature,
      payload: {
        id: editingPlayer.id,
        expectedRevision: editingPlayer.revision,
        requestId: crypto.randomUUID(),
        reason,
      },
    };
  }
  const deleteEpoch = sessionEpoch;
  const deleteMutation = ++editMutation;
  const deletedName = editingPlayer.name;
  setEditingBusy('delete');
  status('admin-edit-status', 'Đang xóa người chơi…');
  try {
    await deleteAdminPlayer(pendingDelete.payload);
    if (deleteEpoch !== sessionEpoch) return;
    setEditingBusy();
    closeEdit(true);
    status('admin-auth-status', `Đã xóa người chơi “${deletedName}”. Bảng Vàng công khai sẽ cập nhật khi tải lại.`, 'success');
    auditOffset = 0;
    await Promise.allSettled([loadPlayers(), loadAudit()]);
  } catch (error) {
    if (deleteEpoch === sessionEpoch && !handleAuthError(error)) status('admin-edit-status', errorMessage(error), 'error');
  } finally {
    if (deleteEpoch === sessionEpoch && deleteMutation === editMutation) setEditingBusy();
  }
});

$('admin-edit-close').addEventListener('click', () => closeEdit());
$('admin-edit-cancel').addEventListener('click', () => closeEdit());
$('admin-edit-discard').addEventListener('click', () => closeEdit(true));
$('admin-edit-continue').addEventListener('click', () => { setDiscardVisible(false); $('admin-edit-name').focus(); });
$('admin-edit-dialog').addEventListener('cancel', (event) => { event.preventDefault(); closeEdit(); });
$('admin-edit-dialog').addEventListener('click', (event) => {
  if (event.target !== $('admin-edit-dialog')) return;
  const bounds = $('admin-edit-dialog').getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeEdit();
});

$('admin-search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  search = $('admin-search').value.normalize('NFC').trim();
  playersOffset = 0;
  void loadPlayers();
});
$('admin-search').addEventListener('search', () => {
  if (!$('admin-search').value) { search = ''; playersOffset = 0; void loadPlayers(); }
});
$('admin-refresh').addEventListener('click', () => { void loadPlayers(); });
$('admin-audit-refresh').addEventListener('click', () => { void loadAudit(); });
$('admin-players-prev').addEventListener('click', () => { if (!playersLoading && playersOffset > 0) { playersOffset -= pageSize; void loadPlayers(); } });
$('admin-players-next').addEventListener('click', () => { if (!playersLoading && playersOffset + pageSize < playersTotal) { playersOffset += pageSize; void loadPlayers(); } });
$('admin-audit-prev').addEventListener('click', () => { if (!auditLoading && auditOffset > 0) { auditOffset -= pageSize; void loadAudit(); } });
$('admin-audit-next').addEventListener('click', () => { if (!auditLoading && auditOffset + pageSize < auditTotal) { auditOffset += pageSize; void loadAudit(); } });

$('admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!$('admin-login-form').reportValidity()) return;
  if ($('admin-login-submit').disabled) return;
  $('admin-login-submit').disabled = true;
  status('admin-login-status', 'Đang đăng nhập…');
  try {
    await signInAdmin({ password: $('admin-password').value });
    status('admin-login-status');
    await initialize();
  } catch (error) {
    status('admin-login-status', errorMessage(error), 'error');
  } finally {
    $('admin-password').value = '';
    $('admin-login-submit').disabled = false;
  }
});

async function logout() {
  if (loggingOut || isEditingBusy()) return;
  loggingOut = true;
  $('admin-logout').disabled = true;
  $('admin-login-signout').disabled = true;
  try {
    await signOutAdmin();
    status('admin-auth-status', 'Đã đăng xuất khỏi trang quản lý.');
    status('admin-login-status');
  } catch (error) {
    status('admin-auth-status', `Đã xóa phiên trên trình duyệt này. ${errorMessage(error)}`, 'error');
  } finally {
    // The client always clears the local session, including on network failure.
    setSignedOut();
    $('admin-login-signout').hidden = true;
    loggingOut = false;
    $('admin-logout').disabled = false;
    $('admin-login-signout').disabled = false;
  }
}
$('admin-logout').addEventListener('click', () => { void logout(); });
$('admin-login-signout').addEventListener('click', () => { void logout(); });

window.addEventListener('beforeunload', (event) => {
  if (editingPlayer && (isEditingBusy() || editSignature() !== originalEdit)) { event.preventDefault(); event.returnValue = ''; }
});

window.addEventListener('storage', (event) => {
  const adminSessionRemoved = event.newValue === null
    && (event.key === null || event.key.startsWith('oaq:admin:session'));
  if (!adminSessionRemoved) return;
  setSignedOut();
  $('admin-login-signout').hidden = true;
  status('admin-auth-status', 'Phiên quản lý đã được đăng xuất ở một cửa sổ khác.');
  status('admin-login-status');
});

async function initialize() {
  try {
    const admin = await getAdminStatus();
    if (!admin) { setSignedOut(); status('admin-auth-status'); return; }
    authenticated = true;
    sessionEpoch += 1;
    $('admin-current-email').textContent = 'Quản trị viên';
    $('admin-login').hidden = true;
    $('admin-workspace').hidden = false;
    status('admin-auth-status');
    await Promise.allSettled([loadPlayers(), loadAudit()]);
  } catch (error) {
    if (handleAuthError(error)) return;
    setSignedOut();
    $('admin-login-signout').hidden = true;
    status('admin-auth-status', errorMessage(error), 'error');
    status('admin-login-status', 'Nhập mật khẩu quản lý để thử đăng nhập lại.');
  }
}

// Discard credentials from legacy email links before making any requests.
const legacyFragment = new URLSearchParams(location.hash.slice(1));
if (['access_token', 'refresh_token', 'error', 'error_code'].some(key => legacyFragment.has(key))) {
  history.replaceState(null, '', location.pathname + location.search);
}
void initialize();
