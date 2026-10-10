import { INITIAL_STATE, TURN_LIMIT, cloneState, legalMoves, playMove, solve } from './engine.mjs';
import { normalizePlayerName, fetchTop10, getPlayerStatus, registerPlayer, startGame, playGameMove } from './leaderboard.mjs?v=ky-lo-2';

const $ = selector => document.querySelector(selector);
const optimal = solve(INITIAL_STATE, TURN_LIMIT);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let state = cloneState(INITIAL_STATE), history = [], selected = null, direction = 1;
let busy = false, skipAnimation = false, soundEnabled = false, audioContext;
let playerName = '', profile = null, connected = false, rankingRequest = null;
const NAME_KEY = 'oaq:player-name', START_KEY = 'oaq:pending-start:v2';
const pitNumber = pit => 12 - pit;
const directionName = value => value === 1 ? 'trái' : 'phải';
const pitName = pit => pit === 0 ? 'quan trái' : pit === 6 ? 'quan phải' : pit >= 7 ? `ô ${pitNumber(pit)} phía bạn` : `ô ${pit} phía đối diện`;
const finished = () => state.turns >= TURN_LIMIT || state.ended || legalMoves(state).length === 0;
const canPlay = () => connected && playerName && profile?.active_game?.status === 'active' && !busy && !finished();
const motionAnimations = new Set(), motionWaits = new Set();
let motionLayer;

// Timers, rather than animation.finished, keep a hidden or interrupted tab from
// leaving the controls locked. Every wait can be completed by skip/cleanup.
function motionPause(milliseconds) {
  if (skipAnimation || document.hidden) return Promise.resolve();
  return new Promise(resolve => {
    let timer;
    const finish = () => { clearTimeout(timer);motionWaits.delete(finish);resolve(); };
    motionWaits.add(finish);timer = setTimeout(finish, milliseconds);
  });
}

function clearMotion() {
  for (const finish of [...motionWaits]) finish();
  for (const animation of [...motionAnimations]) animation.cancel();
  motionAnimations.clear();motionLayer?.remove();motionLayer = null;
  document.querySelectorAll('.motion-held').forEach(stone => stone.classList.remove('motion-held'));
  document.querySelectorAll('.motion-pit-drop, .motion-pit-capture, .motion-score-hit').forEach(element => element.classList.remove('motion-pit-drop', 'motion-pit-capture', 'motion-score-hit'));
  document.querySelectorAll('.pit-ripple').forEach(ripple => ripple.remove());
  $('#score')?.classList.remove('score-bump');
}

function stopMotion() { skipAnimation = true;clearMotion(); }

function effectLayer() {
  if (!motionLayer?.isConnected) {
    motionLayer = document.createElement('div');motionLayer.className = 'motion-layer';motionLayer.setAttribute('aria-hidden', 'true');document.body.append(motionLayer);
  }
  return motionLayer;
}

function animateElement(element, frames, duration, { remove = false, delay = 0, easing = 'linear' } = {}) {
  if (skipAnimation || document.hidden || !element.animate) { if (remove) element.remove();return; }
  try {
    const animation = element.animate(frames, { duration, delay, easing, fill: 'both' });motionAnimations.add(animation);
    void animation.finished.catch(() => {}).finally(() => { motionAnimations.delete(animation);if (remove) element.remove();else animation.cancel(); });
    return animation;
  } catch { if (remove) element.remove(); }
}

function viewportPoint(x, y, margin = 18) {
  return { x: Math.max(margin, Math.min(window.innerWidth - margin, x)), y: Math.max(margin, Math.min(window.innerHeight - margin, y)) };
}

function centerOf(element) {
  const bounds = element.getBoundingClientRect();return viewportPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
}

function stoneFlight(source, start, end, duration, capture = false, delay = 0) {
  const bounds = source.getBoundingClientRect(), stone = source.cloneNode(false);
  stone.classList.remove('motion-held');stone.classList.add('flying-stone');stone.removeAttribute('data-stone');stone.setAttribute('aria-hidden', 'true');
  stone.style.width = `${Math.max(6, bounds.width)}px`;stone.style.height = `${Math.max(6, bounds.height)}px`;
  effectLayer().append(stone);
  const angle = Number.parseFloat(source.style.getPropertyValue('--r')) || (capture ? -13 : 0);
  const distance = Math.hypot(end.x - start.x, end.y - start.y), lift = Math.min(capture ? 88 : 60, Math.max(22, distance * .2));
  const origin = { x: start.x, y: capture ? start.y : Math.max(12, start.y - 12) };
  const arcTop = Math.max(12, Math.min(origin.y, end.y) - lift);
  const control = { x: origin.x + (end.x - origin.x) * (capture ? .32 : .45), y: Math.max(12, 2 * arcTop - (origin.y + end.y) / 2) };
  const frame = (x, y, rotate, scale = 1, opacity = 1) => ({ transform: `translate3d(${x}px,${y}px,0) translate(-50%,-50%) rotate(${rotate}deg) scale(${scale})`, opacity });
  // Sample a quadratic curve closely enough to keep the flight rounded even
  // across the long diagonal from a quan pit to the score card.
  const frames = Array.from({ length: 13 }, (_, index) => {
    const t = index / 12, u = 1 - t, liftScale = Math.sin(Math.PI * t);
    const x = u * u * origin.x + 2 * u * t * control.x + t * t * end.x;
    const y = u * u * origin.y + 2 * u * t * control.y + t * t * end.y;
    return {
      ...frame(x, y, angle + (capture ? 75 * t : 25 * liftScale), capture ? 1 + .08 * liftScale - .62 * t : .92 + .08 * t + .12 * liftScale, capture ? 1 - .2 * t : 1),
      offset: t * (capture ? .86 : 1),
    };
  });
  if (capture) frames.push({ ...frame(end.x, Math.max(12, end.y - 4), angle + 90, .1, 0), offset: 1 });
  animateElement(stone, frames, duration, { remove: true, delay, easing: capture ? 'cubic-bezier(.28,.02,.5,1)' : 'cubic-bezier(.27,.1,.53,1)' });
}

function pulsePit(pit, capture, duration) {
  pit.classList.add(capture ? 'motion-pit-capture' : 'motion-pit-drop');
  const ripple = document.createElement('span');ripple.className = `pit-ripple${capture ? ' capture-ripple' : ''}`;pit.append(ripple);
  animateElement(ripple, [{ transform: 'scale(.55)', opacity: .75 }, { transform: 'scale(1.18)', opacity: 0 }], duration, { remove: true, easing: 'ease-out' });
}

async function animateDrop(event, duration, pendingScore) {
  const sourcePit = $(`[data-pit="${event.from}"]`), start = sourcePit ? centerOf(sourcePit) : null;
  renderBoard(event.state, event);renderScore(event.state, pendingScore);
  const destination = $(`[data-pit="${event.pit}"]`), stones = destination.querySelectorAll('.pebble'), landing = stones[stones.length - 1];
  pulsePit(destination, false, duration);
  if (!start || !landing) { await motionPause(duration);return; }
  const end = centerOf(landing), travel = duration * .7;
  // A crowded pit displays at most sixteen stones; don't hide an old stone in
  // that case. The count still shows every civilian in the engine position.
  if (event.state.board[event.pit] <= 16) landing.classList.add('motion-held');
  stoneFlight(landing, start, end, travel);
  await motionPause(travel);
  landing.classList.remove('motion-held');
  if (skipAnimation || !landing.isConnected) return;
  const rotation = landing.style.getPropertyValue('--r');
  animateElement(landing, [
    { transform: `translate(-50%,-50%) translateY(-3px) rotate(${rotation}) scale(1.08,.9)` },
    { transform: `translate(-50%,-50%) translateY(1px) rotate(calc(${rotation} + 7deg)) scale(.94,1.04)`, offset: .5 },
    { transform: `translate(-50%,-50%) rotate(${rotation}) scale(1)` },
  ], duration * .3, { easing: 'ease-out' });
  await motionPause(duration * .3);
}

async function animateCapture(event, duration, pendingScore) {
  const capturedPit = $(`[data-pit="${event.pit}"]`);
  const sources = [...capturedPit.querySelectorAll('.pebble, .big-pebble')].map(stone => ({ stone, start: centerOf(stone) }));
  const score = $('#score'), destination = centerOf(score);
  // Snapshot physical stones before replacing the board with the AFTER state.
  for (const [index, source] of sources.entries()) {
    const spread = sources.length > 1 ? Math.min(90, duration * .18) * index / (sources.length - 1) : 0;
    stoneFlight(source.stone, source.start, destination, duration * .78, true, spread);
  }
  renderBoard(event.state, event);renderScore(event.state, pendingScore);
  pulsePit($(`[data-pit="${event.pit}"]`), true, duration);
  const card = $('.score-card');card.classList.add('motion-score-hit');
  const points = document.createElement('span');points.className = 'capture-points';points.textContent = `+${event.points}`;
  points.style.left = `${destination.x}px`;points.style.top = `${Math.max(30, destination.y - 18)}px`;effectLayer().append(points);
  animateElement(points, [{ transform: 'translate(-50%,8px) scale(.86)', opacity: 0 }, { transform: 'translate(-50%,-8px) scale(1.08)', opacity: 1, offset: .28 }, { transform: 'translate(-50%,-50px) scale(1)', opacity: 0 }], duration * .82, { remove: true, delay: duration * .18, easing: 'ease-out' });
  await motionPause(duration);
  card.classList.remove('motion-score-hit');
}

function message(text, kind = '') {
  const element = $('#game-message');element.className = `game-message ${kind}`;element.replaceChildren();
  const icon = document.createElement('span');icon.className = 'message-icon';icon.textContent = kind === 'good' ? '✓' : '↖';
  const copy = document.createElement('span');copy.textContent = text;element.append(icon, copy);
}

function stoneMarkup(index, count) {
  let html = '';
  for (let i = 0; i < Math.min(count, 16); i++) {
    const seed = (index * 137 + i * 83) % 101;
    const x = 19 + (i % 4) * 21 + (seed % 9) - 4, y = 14 + Math.floor(i / 4) * 22 + (seed % 11) - 5;
    const tone = ['chalk', 'ash', 'sand'][(index + i * 2) % 3];
    html += `<i class="pebble tone-${tone} shape-${seed % 3}" aria-hidden="true" data-stone="${i}" style="--x:${x}%;--y:${y}%;--r:${seed * 3}deg"></i>`;
  }
  return html;
}

function renderBoard(position = state, action = null) {
  const legal = new Set(canPlay() ? legalMoves(state).map(move => move.pit) : []);
  const fragment = document.createDocumentFragment();
  for (const index of [0, 1, 2, 3, 4, 5, 6, 11, 10, 9, 8, 7]) {
    const quan = index === 0 || index === 6, hasQuan = quan && position.quan[index === 0 ? 0 : 1], own = index >= 7, count = position.board[index];
    const pit = document.createElement('button');pit.type = 'button';pit.dataset.pit = index;
    pit.className = `pit ${quan ? `quan quan-${index === 0 ? 'left' : 'right'}` : own ? 'own' : 'top'}${count || hasQuan ? '' : ' empty'}${selected === index && !busy ? ' selected' : ''}${action?.pit === index ? action.type === 'capture' ? ' capturing' : ' current-action' : ''}`;
    pit.style.gridColumn = quan ? index === 0 ? 1 : 7 : own ? 13 - index : index + 1;
    if (!quan) pit.style.gridRow = own ? 2 : 1;
    pit.disabled = !legal.has(index);
    pit.setAttribute('aria-label', `${pitName(index)}, ${count} dân${hasQuan ? ', 1 quan' : ''}${own && !legal.has(index) && playerName && !busy && !finished() ? ', ô trống' : ''}`);
    if (own) pit.setAttribute('aria-pressed', String(selected === index));
    pit.innerHTML = `${quan ? `<span class="quan-name">${index === 0 ? 'QUAN TRÁI' : 'QUAN PHẢI'}</span>` : ''}<span class="stones">${stoneMarkup(index, count)}</span>${hasQuan ? '<i class="big-pebble" aria-hidden="true"></i>' : ''}<span class="pit-count">${count}${hasQuan ? ' + quan' : ''}</span>${own ? `<span class="pit-number">Ô ${pitNumber(index)}</span>` : ''}`;
    fragment.append(pit);
  }
  $('#pits').replaceChildren(fragment);
}

function renderScore(position = state, pendingScore = null) {
  $('#score').textContent = String(position.score).padStart(2, '0');$('#target-score').textContent = `${optimal.maxScore} điểm`;
  $('#score-progress').style.width = `${Math.min(100, position.score / optimal.maxScore * 100)}%`;
  const captures = [...history.flatMap(turn => turn.result.captured), ...(pendingScore?.captured ?? [])];
  const civilians = captures.reduce((total, capture) => total + capture.civilians, 0), quan = captures.filter(capture => capture.quan).length;
  const cost = history.reduce((total, turn) => total + turn.result.cost, 0) + (pendingScore?.cost ?? 0);
  $('#score-breakdown').innerHTML = `${civilians} dân <span>·</span> ${quan} quan${cost ? `<small>−${cost} điểm đặt lại quân</small>` : ''}`;
}

function renderHistory() {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < TURN_LIMIT; i++) {
    const turn = history[i], item = document.createElement('li');item.className = turn ? 'played' : 'empty-turn';
    item.innerHTML = turn
      ? `<span class="step-number">${i + 1}</span><span class="history-detail">Ô ${pitNumber(turn.pit)} <span>→ ${directionName(turn.direction)}</span><small>${turn.result.captured.length ? `${turn.result.captured.length} ô được ăn` : 'Không ăn được quân'}${turn.result.cost ? ' · đặt lại 5 dân' : ''}</small></span><span class="history-points">${turn.result.net >= 0 ? '+' : ''}${turn.result.net}</span>`
      : `<span class="step-number">${i + 1}</span><span>${finished() ? 'Kết thúc thử thách' : i === history.length ? i === 0 ? 'Chờ nước đi đầu tiên' : 'Chờ nước đi tiếp theo' : 'Chưa đến lượt'}</span>`;
    fragment.append(item);
  }
  $('#move-history').replaceChildren(fragment);$('#history-count').textContent = `${history.length}/${TURN_LIMIT}`;
}

function renderControls() {
  const done = finished();
  $('#turn-title').textContent = busy ? 'Đang rải quân' : done ? 'Đã kết thúc' : 'Lượt của bạn';
  $('#turn-counter').textContent = `${Math.min(TURN_LIMIT, state.turns + (done ? 0 : 1))} / ${TURN_LIMIT}`;
  document.querySelectorAll('.turn-dots i').forEach((dot, i) => { dot.className = i < state.turns ? 'done' : i === state.turns && !done ? 'current' : ''; });
  $('#selection-label').textContent = selected !== null ? `Ô ${pitNumber(selected)} · ${state.board[selected] || 1} DÂN · CHỌN CHIỀU` : 'CHỌN CHIỀU RẢI QUÂN';
  for (const [id, value] of [['#direction-left', 1], ['#direction-right', -1]]) { $(id).classList.toggle('active', direction === value);$(id).setAttribute('aria-pressed', String(direction === value));$(id).disabled = !canPlay(); }
  $('#play-button').disabled = !canPlay() || selected === null;
  const complete = profile?.active_game?.status === 'completed';
  $('#reset-button').hidden = !profile || profile.active_game?.status === 'active';
  $('#reset-button').disabled = busy || !connected || !profile?.attempts_left;
  $('#reset-button').textContent = !profile?.attempts_left ? 'Đã hết 3 ván' : `Chơi ván ${profile.attempts_used + 1}/3 →`;
  $('#result-replay').disabled = busy || !connected || !profile?.attempts_left;
  $('#result-replay').textContent = !profile?.attempts_left ? 'Bạn đã dùng hết 3 ván' : `Chơi ván ${profile.attempts_used + 1}/3 →`;
  $('#attempt-status').textContent = profile ? `Đã chơi ${profile.attempts_used}/3 ván · Còn ${profile.attempts_left} ván` : 'Mỗi tên được chơi tối đa 3 ván';
  $('#player-form-register').disabled = busy || !connected;
  $('#retry-connection').disabled = busy;
  $('#result-button').hidden = !complete || !done;$('#result-button').disabled = busy;$('#skip-button').hidden = !busy;
}

function render() { renderBoard();renderScore();renderHistory();renderControls(); }

function selectPit(pit, focus = false) {
  if (!canPlay() || !legalMoves(state).some(move => move.pit === pit)) return;
  selected = pit;renderBoard();renderControls();
  const refill = state.board.every((count, i) => i < 7 || count === 0);
  message(refill ? `Phía bạn đã hết quân. Nước này dùng 5 điểm để đặt lại 5 dân, rồi đi ô ${pitNumber(pit)}.` : `Đã chọn ô ${pitNumber(pit)} có ${state.board[pit]} dân. Chọn chiều rải rồi đi nước này.`);
  if (focus) $(`[data-pit="${pit}"]`).focus({ preventScroll: true });
}

function setDirection(value) { if (!canPlay()) return;direction = value;renderControls(); }

function sound(type) {
  if (!soundEnabled) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') void audioContext.resume();
    const oscillator = audioContext.createOscillator(), volume = audioContext.createGain();oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(type === 'capture' ? 740 : 350 + Math.random() * 80, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(type === 'capture' ? 1100 : 180, audioContext.currentTime + .07);
    volume.gain.setValueAtTime(.055, audioContext.currentTime);volume.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .12);
    oscillator.connect(volume);volume.connect(audioContext.destination);oscillator.start();oscillator.stop(audioContext.currentTime + .13);
  } catch { soundEnabled = false;updateSoundButton(); }
}

function updateSoundButton() {
  const button = $('#sound-button'), label = soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh';
  button.setAttribute('aria-label', label);button.setAttribute('aria-pressed', String(soundEnabled));button.title = label;
  $('#sound-wave').setAttribute('d', soundEnabled ? 'M15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14' : 'm16 9 5 6m0-6-5 6');
}

async function executeMove(pit = selected, value = direction) {
  if (!playerName) throw new Error('Nhập tên của bạn trước khi bắt đầu chơi.');
  if (!canPlay() || pit === null) throw new Error('Chưa chọn ô hoặc ván chơi chưa sẵn sàng.');
  if (!legalMoves(state).some(move => move.pit === pit && move.direction === value)) throw new Error('Ô hoặc chiều rải không hợp lệ.');
  const before = cloneState(state), expectedMoves = history.map(({ pit, direction }) => ({ pit, direction }));
  busy = true;renderControls();renderBoard();message('Đang đi nước này…');
  let updated;
  try {
    updated = await playGameMove({ gameId: profile.active_game.id, expectedMoves, move: { pit, direction: value } });
  } catch (error) {
    busy = false;connected = false;showConnectionError(error);render();
    if (error.code === 'GAME_CONFLICT') await syncGame();
    throw error;
  }
  const accepted = [...expectedMoves, { pit, direction: value }];
  if (updated.active_game?.moves.length !== accepted.length || !updated.active_game.moves.every((move, index) => move.pit === accepted[index].pit && move.direction === accepted[index].direction)) {
    busy = false;applyProfile(updated);message('Đã khôi phục nước đi mới nhất của ván này.');
    return positionResult();
  }
  const result = playMove(state, pit, value, { trace: true });
  try { validateGameState(updated.active_game, result.state); }
  catch (error) { busy = false;connected = false;showConnectionError(error);render();throw error; }
  clearMotion();busy = true;skipAnimation = reducedMotion.matches || document.hidden;selected = null;renderControls();renderBoard();
  const weight = result.trace.reduce((total, event) => total + (event.type === 'capture' ? 3 : event.type === 'pickup' ? .6 : event.type === 'end' ? 0 : 1), 0);
  const duration = Math.min(250, 7200 / Math.max(1, weight));
  // Only traced captures have reached the displayed score. The completed
  // turn enters history once, after its animation (or skip) has finished.
  const pendingScore = { captured: [], cost: 0 };
  for (const event of result.trace) {
    if (skipAnimation) break;
    if (event.type === 'capture') pendingScore.captured.push(event);
    else if (event.type === 'refill') pendingScore.cost += event.cost;
    if (event.type === 'pickup') message(`Bốc ${event.count} dân từ ${pitName(event.pit)}${event.relay ? ' để rải tiếp' : ''}.`);
    else if (event.type === 'drop') message(`Rải 1 dân vào ${pitName(event.pit)} · Còn ${event.hand} dân trên tay.`);
    else if (event.type === 'capture') message(`Ăn ${event.civilians} dân${event.quan ? ' và 1 quan' : ''} ở ${pitName(event.pit)}. +${event.points} điểm!`, 'good');
    else if (event.type === 'refill') message('Dùng 5 điểm đặt lại mỗi ô phía bạn 1 dân.');
    if (event.type === 'drop' || event.type === 'capture') sound(event.type);
    if (event.type === 'drop') await animateDrop(event, duration, pendingScore);
    else if (event.type === 'capture') await animateCapture(event, Math.min(700, duration * 3), pendingScore);
    else {
      renderBoard(event.state, event);renderScore(event.state, pendingScore);
      if (event.type !== 'end') await motionPause(event.type === 'pickup' ? Math.min(160, duration * .6) : duration);
    }
  }
  clearMotion();state = result.state;history.push({ before, pit, direction: value, result });profile = updated;busy = false;render();
  $('#score').classList.remove('score-bump');void $('#score').offsetWidth;$('#score').classList.add('score-bump');
  if (finished()) { message(`Ván chơi kết thúc. Bạn đạt ${state.score} / ${optimal.maxScore} điểm.`, 'good');showResult();void loadRanking({ fresh: true }); }
  else message(result.net > 0 ? `Nước vừa rồi ăn được ${result.gained} điểm${result.cost ? `, trừ ${result.cost} điểm đặt lại quân` : ''}. Còn ${TURN_LIMIT - state.turns} lượt — chọn ô tiếp theo.` : `Nước vừa rồi ${result.cost ? `tốn ${result.cost} điểm đặt lại quân và ` : ''}chưa ăn được quân. Còn ${TURN_LIMIT - state.turns} lượt.`, result.net > 0 ? 'good' : '');
  return { score: state.score, turn: state.turns, gained: result.gained, cost: result.cost, finished: finished(), board: state.board.slice(), quan: state.quan.slice() };
}

function showResult() {
  if (busy || !finished() || profile?.active_game?.status !== 'completed') return;
  const perfect = state.score === optimal.maxScore;
  $('#result-title').textContent = perfect ? 'Kỳ lộ vẹn toàn!' : state.score >= 28 ? 'Một thế cờ rất khá!' : 'Một ván cờ đáng nhớ.';
  $('#result-score').textContent = state.score;$('#result-target').textContent = `/ ${optimal.maxScore} điểm`;
  $('#result-copy').textContent = `${perfect ? 'Bạn đã ăn cả hai quan và đạt điểm cao nhất. ' : state.ended && state.turns < TURN_LIMIT ? 'Ván cờ kết thúc sớm. ' : ''}${profile.attempts_left ? `Bạn còn ${profile.attempts_left} ván để thử sức.` : 'Bạn đã hoàn thành cả 3 ván. Hãy xem thứ hạng của mình trên Bảng Vàng.'}`;
  $('#score-submit-status').textContent = `Đã lưu vào Bảng Vàng. Điểm tốt nhất của bạn: ${profile.best_score}.`;
  if (!$('#result-dialog').open) $('#result-dialog').showModal();
}

function saveLocal(key, value) {
  try { if (value === null) localStorage.removeItem(key);else localStorage.setItem(key, value); } catch { /* The current tab still works when storage is blocked. */ }
}

function readLocal(key) { try { return localStorage.getItem(key); } catch { return null; } }

function openNameDialog() {
  if (busy || profile || !connected) return;
  $('#player-name').value = readLocal(NAME_KEY) || '';
  $('#player-error').hidden = true;$('#player-name').removeAttribute('aria-invalid');
  if (!$('#player-dialog').open) $('#player-dialog').showModal();
}

async function enterPlayer(event) {
  event.preventDefault();
  if (busy || profile || !connected) return;
  let name;
  try {
    name = normalizePlayerName($('#player-name').value);
    busy = true;renderControls();
    const registered = await registerPlayer({ name });
    busy = false;applyProfile(registered);$('#player-dialog').close();
    await beginGame();
  } catch (error) {
    busy = false;renderControls();
    $('#player-error').textContent = error.message;$('#player-error').hidden = false;
    $('#player-name').setAttribute('aria-invalid', 'true');$('#player-name').focus();
    if (error.code === 'NAME_LOCKED') await syncGame();
    else if (!['INVALID_NAME', 'NAME_TAKEN'].includes(error.code)) {
      connected = false;$('#player-dialog').close();showConnectionError(error);renderControls();
    }
  }
}

function positionResult() {
  return { score: state.score, turn: state.turns, finished: finished(), board: state.board.slice(), quan: state.quan.slice() };
}

function validateGameState(game, position) {
  const terminal = position.ended || position.turns === TURN_LIMIT || !legalMoves(position).length;
  if (game && ((game.status === 'completed') !== terminal || (terminal && game.score !== position.score))) {
    throw new Error('Chưa xác nhận được kết quả ván chơi. Hãy kết nối lại.');
  }
}

function applyProfile(value) {
  // Rebuild only from the server's accepted moves. Reloading cannot erase a turn.
  let restored = cloneState(INITIAL_STATE);
  const turns = [];
  for (const move of value?.active_game?.moves ?? []) {
    const before = cloneState(restored), result = playMove(restored, move.pit, move.direction);
    turns.push({ before, pit: move.pit, direction: move.direction, result });restored = result.state;
  }
  validateGameState(value?.active_game, restored);
  clearMotion();profile = value;playerName = value?.name ?? '';state = restored;history = turns;selected = null;direction = 1;
  $('#player-display').textContent = playerName || 'Chưa ghi tên';
  if (playerName) saveLocal(NAME_KEY, playerName);
  $('#result-dialog').close();connected = true;
  $('#connection-status').hidden = true;$('#retry-connection').hidden = true;
  if (profile) $('#player-dialog').close();
  render();
  if (profile?.active_game?.status === 'active') message(`Ván ${profile.attempts_used}/3 · ${state.turns ? 'Đã khôi phục các nước đã đi. ' : ''}Chọn một ô có quân để tiếp tục.`);
  else if (profile?.active_game?.status === 'completed') showResult();
  else if (profile) message(`Chào ${playerName}! ${profile.attempts_left ? 'Bắt đầu ván tiếp theo khi bạn sẵn sàng.' : 'Bạn đã dùng hết 3 ván chơi.'}`);
}

function showConnectionError(error) {
  $('#result-dialog').close();
  const element = $('#connection-status');element.textContent = `${error.message} Kết nối lại để tiếp tục đúng ván đang chơi.`;element.hidden = false;
  $('#retry-connection').hidden = false;
}

async function syncGame() {
  if (busy) return;
  busy = true;connected = false;render();
  $('#connection-status').textContent = 'Đang mở sổ ghi danh…';$('#connection-status').hidden = false;
  try {
    const saved = await getPlayerStatus();
    busy = false;applyProfile(saved);
    if (!saved) openNameDialog();
    else if (readLocal(START_KEY)) {
      // The original request UUID survives a lost response, including a reload.
      await beginGame();
    }
  } catch (error) {
    busy = false;connected = false;$('#player-dialog').close();showConnectionError(error);render();
  }
}

async function beginGame() {
  if (busy || !profile || !connected) return;
  const pending = readLocal(START_KEY);
  if (!pending && (profile.active_game?.status === 'active' || !profile.attempts_left)) return;
  const requestId = pending && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(pending) ? pending : crypto.randomUUID();
  saveLocal(START_KEY, requestId);busy = true;renderControls();
  try {
    const started = await startGame({ requestId });
    saveLocal(START_KEY, null);busy = false;applyProfile(started);
  } catch (error) {
    busy = false;connected = false;showConnectionError(error);render();
    if (error.code === 'ATTEMPT_LIMIT') { saveLocal(START_KEY, null);await syncGame(); }
  }
}

function renderRanking(rows) {
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement('tr');tr.className = `rank-${row.rank}${row.is_me ? ' is-me' : ''}`;
    const rankCell = document.createElement('td'), number = document.createElement('span');number.className = 'rank-number';number.textContent = row.rank;rankCell.append(number);
    const nameCell = document.createElement('td'), player = document.createElement('span');player.className = 'rank-player-name';player.textContent = row.name;nameCell.append(player);
    if (row.rank <= 2) { const title = document.createElement('span');title.className = `rank-title rank-title-${row.rank}`;title.textContent = row.rank === 1 ? 'Trạng nguyên' : 'Thám hoa';nameCell.append(title); }
    if (row.is_me) { const tag = document.createElement('span');tag.className = 'you-tag';tag.textContent = 'Bạn';nameCell.append(tag); }
    const points = document.createElement('td');points.className = 'points-column';points.textContent = row.score;
    tr.append(rankCell, nameCell, points);fragment.append(tr);
  }
  $('#leaderboard-rows').replaceChildren(fragment);$('#leaderboard-table-wrap').hidden = !rows.length;
}

function loadRanking({ fresh = false } = {}) {
  // A completed upload must not reuse a read that began before it was saved.
  if (rankingRequest) return fresh ? rankingRequest.then(() => loadRanking()) : rankingRequest;
  const status = $('#leaderboard-status');status.className = 'leaderboard-status';status.textContent = 'Đang tải bảng xếp hạng…';status.hidden = false;
  $('#refresh-leaderboard').disabled = true;
  rankingRequest = (async () => {
    try {
      const rows = await fetchTop10();renderRanking(rows);
      status.textContent = rows.length ? '' : 'Chưa có người chơi ghi điểm. Hoàn thành thử thách để ghi tên đầu tiên.';status.hidden = !!rows.length;
      return rows;
    } catch (error) {
      status.className = 'leaderboard-status error';status.textContent = error.message;status.hidden = false;
      return null;
    } finally { $('#refresh-leaderboard').disabled = false;rankingRequest = null; }
  })();
  return rankingRequest;
}

$('#pits').addEventListener('click', event => { const button = event.target.closest('[data-pit]');if (button && !button.disabled) selectPit(Number(button.dataset.pit), true); });
$('#direction-left').addEventListener('click', () => setDirection(1));$('#direction-right').addEventListener('click', () => setDirection(-1));
$('#play-button').addEventListener('click', () => { void executeMove().catch(error => message(error.message)); });
$('#result-button').addEventListener('click', showResult);$('#reset-button').addEventListener('click', () => { void beginGame(); });
$('#result-replay').addEventListener('click', () => { void beginGame(); });$('#skip-button').addEventListener('click', stopMotion);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopMotion(); });
window.addEventListener('pagehide', stopMotion);
reducedMotion.addEventListener('change', event => { if (event.matches) stopMotion(); });
$('#sound-button').addEventListener('click', () => { soundEnabled = !soundEnabled;updateSoundButton();if (soundEnabled) sound('drop'); });
$('#player-form').addEventListener('submit', enterPlayer);
$('#player-dialog').addEventListener('cancel', event => { event.preventDefault(); });
$('#refresh-leaderboard').addEventListener('click', () => { void loadRanking(); });
$('#retry-connection').addEventListener('click', () => { void syncGame(); });
window.addEventListener('online', () => { void loadRanking();if (!busy) void syncGame(); });
window.addEventListener('offline', () => { connected = false;$('#player-dialog').close();showConnectionError(new Error('Đã mất kết nối mạng.'));render(); });
$('#rules-button').addEventListener('click', () => $('#rules-dialog').showModal());
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (dialog.id === 'player-dialog') return;
  if (event.target !== dialog) return;const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
}));
document.addEventListener('keydown', event => {
  if (busy || $('dialog[open]') || event.ctrlKey || event.metaKey || event.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  if (/^[1-5]$/.test(event.key)) { event.preventDefault();selectPit(12 - Number(event.key), true); }
  else if (event.key === 'ArrowLeft') { event.preventDefault();setDirection(1); }
  else if (event.key === 'ArrowRight') { event.preventDefault();setDirection(-1); }
  else if (event.key === 'Enter' && event.target.matches('.pit.own') && selected !== null) { event.preventDefault();void executeMove().catch(error => message(error.message)); }
});

// Browser tools share the same state and complete the same actions as the UI.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const register = tool => { try { void Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Play stays available when the registry is unsupported. */ } };
  register({ name: 'read_o_an_quan_position', title: 'Đọc thế cờ ô ăn quan', description: 'Read visible board, score, remaining turns and legal player moves without revealing a solution.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => ({ ...cloneState(state), playerName, gamesUsed: profile?.attempts_used ?? 0, gamesLeft: profile?.attempts_left ?? 3, remaining: Math.max(0, TURN_LIMIT - state.turns), busy, target: optimal.maxScore, legalMoves: canPlay() ? legalMoves(state).map(move => ({ cell: pitNumber(move.pit), direction: directionName(move.direction) })) : [] }) });
  register({ name: 'play_o_an_quan_move', title: 'Đi một nước ô ăn quan', description: 'Complete one move from player cell 1–5. Sow and capture, consume one of three turns, then return the updated score after animation.', inputSchema: { type: 'object', properties: { cell: { type: 'integer', minimum: 1, maximum: 5 }, direction: { type: 'string', enum: ['left', 'right'] } }, required: ['cell', 'direction'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async input => {
    if (!input || !Number.isInteger(input.cell) || input.cell < 1 || input.cell > 5 || !['left', 'right'].includes(input.direction) || Object.keys(input).some(key => !['cell', 'direction'].includes(key))) throw new Error('Cell must be 1–5 and direction must be left or right.');
    return executeMove(12 - input.cell, input.direction === 'left' ? 1 : -1);
  } });
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
render();void syncGame();void loadRanking();
