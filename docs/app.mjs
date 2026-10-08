import { INITIAL_STATE, TURN_LIMIT, cloneState, legalMoves, playMove, solve } from './engine.mjs';
import { normalizePlayerName, fetchTop20, submitScore } from './leaderboard.mjs';

const $ = selector => document.querySelector(selector);
const optimal = solve(INITIAL_STATE, TURN_LIMIT);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let state = cloneState(INITIAL_STATE), history = [], selected = null, direction = 1;
let busy = false, skipAnimation = false, soundEnabled = false, audioContext;
let playerName = '', rankingRequest = null, submitRequest = null, pendingRun = null;
const NAME_KEY = 'oaq:player-name', OUTBOX_KEY = 'oaq:score-outbox:v1';
const pitNumber = pit => 12 - pit;
const directionName = value => value === 1 ? 'trái' : 'phải';
const pitName = pit => pit === 0 ? 'quan trái' : pit === 6 ? 'quan phải' : pit >= 7 ? `ô ${pitNumber(pit)} phía bạn` : `ô ${pit} phía đối diện`;
const finished = () => state.turns >= TURN_LIMIT || state.ended || legalMoves(state).length === 0;
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
  const legal = new Set(!playerName || busy || finished() ? [] : legalMoves(state).map(move => move.pit));
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
  for (const [id, value] of [['#direction-left', 1], ['#direction-right', -1]]) { $(id).classList.toggle('active', direction === value);$(id).setAttribute('aria-pressed', String(direction === value));$(id).disabled = !playerName || busy || done; }
  $('#play-button').disabled = !playerName || busy || done || selected === null;$('#undo-button').disabled = busy || history.length === 0;$('#reset-button').disabled = !playerName || busy;
  $('#change-name-button').disabled = busy;
  $('#result-button').hidden = !done;$('#result-button').disabled = busy;$('#skip-button').hidden = !busy;
}

function render() { renderBoard();renderScore();renderHistory();renderControls(); }

function selectPit(pit, focus = false) {
  if (!playerName || busy || finished() || !legalMoves(state).some(move => move.pit === pit)) return;
  selected = pit;renderBoard();renderControls();
  const refill = state.board.every((count, i) => i < 7 || count === 0);
  message(refill ? `Phía bạn đã hết quân. Nước này dùng 5 điểm để đặt lại 5 dân, rồi đi ô ${pitNumber(pit)}.` : `Đã chọn ô ${pitNumber(pit)} có ${state.board[pit]} dân. Chọn chiều rải rồi đi nước này.`);
  if (focus) $(`[data-pit="${pit}"]`).focus({ preventScroll: true });
}

function setDirection(value) { if (!playerName || busy || finished()) return;direction = value;renderControls(); }

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
  if (busy || finished() || pit === null) throw new Error('Chưa chọn ô hoặc thử thách đã kết thúc.');
  if (!legalMoves(state).some(move => move.pit === pit && move.direction === value)) throw new Error('Ô hoặc chiều rải không hợp lệ.');
  const before = cloneState(state), result = playMove(state, pit, value, { trace: true });
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
  clearMotion();state = result.state;history.push({ before, pit, direction: value, result });busy = false;render();
  $('#score').classList.remove('score-bump');void $('#score').offsetWidth;$('#score').classList.add('score-bump');
  if (finished()) { message(`Thử thách kết thúc. Bạn đạt ${state.score} / ${optimal.maxScore} điểm.`, 'good');showResult();queueScore(); }
  else message(result.net > 0 ? `Nước vừa rồi ăn được ${result.gained} điểm${result.cost ? `, trừ ${result.cost} điểm đặt lại quân` : ''}. Còn ${TURN_LIMIT - state.turns} lượt — chọn ô tiếp theo.` : `Nước vừa rồi ${result.cost ? `tốn ${result.cost} điểm đặt lại quân và ` : ''}chưa ăn được quân. Còn ${TURN_LIMIT - state.turns} lượt.`, result.net > 0 ? 'good' : '');
  return { score: state.score, turn: state.turns, gained: result.gained, cost: result.cost, finished: finished(), board: state.board.slice(), quan: state.quan.slice() };
}

function undo() {
  if (busy || !history.length) return;
  clearMotion();
  const last = history.pop();state = cloneState(last.before);selected = null;direction = 1;
  $('#result-dialog').close();setSubmitStatus('');render();message('Đã quay lại trước nước vừa đi. Bạn có thể thử một phương án khác.');
}

function reset() {
  if (busy) return;
  clearMotion();
  state = cloneState(INITIAL_STATE);history = [];selected = null;direction = 1;skipAnimation = false;
  $('#result-dialog').close();$('#solution-path').hidden = true;$('#solution-button').hidden = false;setSubmitStatus('');
  render();message('Chọn một ô có quân ở hàng phía bạn để bắt đầu.');
}

function showResult() {
  if (busy || !finished()) return;
  const perfect = state.score === optimal.maxScore;
  $('#result-title').textContent = perfect ? 'Ba nước đi, trọn vẹn.' : state.score >= 28 ? 'Một thế cờ rất khá!' : 'Vẫn còn một nước đi hay.';
  $('#result-score').textContent = state.score;$('#result-target').textContent = `/ ${optimal.maxScore} điểm`;
  $('#result-copy').textContent = perfect ? 'Bạn đã tìm được chuỗi nước đi tối ưu và ăn cả hai quan. Một lời giải đẹp!' : `${state.ended && state.turns < TURN_LIMIT ? 'Ván cờ kết thúc sớm. ' : ''}Bạn còn cách mục tiêu tối ưu ${optimal.maxScore - state.score} điểm. Thử một chiều rải khác, hoặc hoàn tác để tìm lại cơ hội.`;
  $('#solution-path').hidden = true;$('#solution-button').hidden = false;
  if (!$('#result-dialog').open) $('#result-dialog').showModal();
}

function showSolution() {
  $('#solution-path').innerHTML = optimal.path.map((move, i) => `<div class="solution-step"><span>${i + 1}. Ô ${pitNumber(move.pit)} · Sang ${directionName(move.direction)}</span><strong>+${move.net} điểm</strong></div>`).join('');
  $('#solution-path').hidden = false;$('#solution-button').hidden = true;
}

function saveLocal(key, value) {
  try { if (value === null) localStorage.removeItem(key);else localStorage.setItem(key, value); } catch { /* The current tab still works when storage is blocked. */ }
}

function readLocal(key) { try { return localStorage.getItem(key); } catch { return null; } }

function openNameDialog() {
  if (busy) return;
  $('#player-name').value = playerName || readLocal(NAME_KEY) || '';
  $('#player-error').hidden = true;$('#player-name').removeAttribute('aria-invalid');
  $('#cancel-name-button').hidden = !playerName;
  if (!$('#player-dialog').open) $('#player-dialog').showModal();
}

function enterPlayer(event) {
  event.preventDefault();
  try {
    const name = normalizePlayerName($('#player-name').value);
    playerName = name;saveLocal(NAME_KEY, name);
    $('#player-display').textContent = name;$('#change-name-button').replaceChildren(document.createTextNode('Đổi tên ✎'));
    $('#player-dialog').close();render();
    if (!state.turns) message(`Chào ${name}! Chọn một ô có quân ở hàng phía bạn để bắt đầu.`);
    if (pendingRun) {
      if (pendingRun.name !== name) {
        pendingRun = { ...pendingRun, name };saveLocal(OUTBOX_KEY, JSON.stringify(pendingRun));
      }
      void submitPendingScore();
    }
  } catch (error) {
    $('#player-error').textContent = error.message;$('#player-error').hidden = false;
    $('#player-name').setAttribute('aria-invalid', 'true');$('#player-name').focus();
  }
}

function renderRanking(rows) {
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement('tr');tr.className = `rank-${row.rank}${row.is_me ? ' is-me' : ''}`;
    const rankCell = document.createElement('td'), number = document.createElement('span');number.className = 'rank-number';number.textContent = row.rank;rankCell.append(number);
    const nameCell = document.createElement('td');nameCell.textContent = row.name;
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
      const rows = await fetchTop20();renderRanking(rows);
      status.textContent = rows.length ? '' : 'Chưa có người chơi ghi điểm. Hoàn thành thử thách để ghi tên đầu tiên.';status.hidden = !!rows.length;
      return rows;
    } catch (error) {
      status.className = 'leaderboard-status error';status.textContent = error.message;status.hidden = false;
      return null;
    } finally { $('#refresh-leaderboard').disabled = false;rankingRequest = null; }
  })();
  return rankingRequest;
}

function setSubmitStatus(text, error = false) {
  $('#score-submit-status').textContent = text;$('#score-submit-status').className = `score-submit-status${error ? ' error' : ''}`;
  $('#retry-score-button').hidden = !error || !pendingRun;$('#retry-score-button').disabled = !!submitRequest;
}

function queueScore() {
  const run = { name: playerName, moves: history.map(({ pit, direction }) => ({ pit, direction })), score: state.score };
  // Keep the strongest completed proof if a previous upload is still waiting.
  pendingRun = pendingRun && pendingRun.score > run.score ? { ...pendingRun, name: run.name } : run;
  saveLocal(OUTBOX_KEY, JSON.stringify(pendingRun));void submitPendingScore();
}

function restorePendingScore() {
  try {
    const run = JSON.parse(readLocal(OUTBOX_KEY));
    if (!run || !Array.isArray(run.moves) || !run.moves.length || run.moves.length > TURN_LIMIT) return;
    run.name = normalizePlayerName(run.name);
    let checked = cloneState(INITIAL_STATE);
    for (const move of run.moves) checked = playMove(checked, move.pit, move.direction).state;
    if (!checked.ended && checked.turns < TURN_LIMIT && legalMoves(checked).length) return;
    pendingRun = { name: run.name, moves: run.moves.map(({ pit, direction }) => ({ pit, direction })), score: checked.score };
  } catch { saveLocal(OUTBOX_KEY, null); }
}

function submitPendingScore() {
  if (!pendingRun) return Promise.resolve();
  if (submitRequest) return submitRequest;
  const submitted = pendingRun;
  setSubmitStatus('Đang ghi điểm vào sổ vàng…');$('#retry-score-button').disabled = true;
  submitRequest = (async () => {
    try {
      const result = await submitScore({ name: submitted.name, moves: submitted.moves });
      if (pendingRun === submitted) {
        pendingRun = null;
        // Another tab may have persisted a newer proof during this upload.
        if (readLocal(OUTBOX_KEY) === JSON.stringify(submitted)) saveLocal(OUTBOX_KEY, null);
      }
      setSubmitStatus(result.improved ? `Đã ghi điểm! Điểm tốt nhất của bạn: ${result.best_score}.` : `Đã lưu ván chơi. Điểm tốt nhất của bạn vẫn là ${result.best_score}.`);
      await loadRanking({ fresh: true });
    } catch (error) { setSubmitStatus(`${error.message} Điểm đang chờ gửi.`, true); }
    finally {
      submitRequest = null;$('#retry-score-button').disabled = false;
      // A stronger run may have finished while this request was in flight.
      if (pendingRun && pendingRun !== submitted) void submitPendingScore();
    }
  })();
  return submitRequest;
}

$('#pits').addEventListener('click', event => { const button = event.target.closest('[data-pit]');if (button && !button.disabled) selectPit(Number(button.dataset.pit), true); });
$('#direction-left').addEventListener('click', () => setDirection(1));$('#direction-right').addEventListener('click', () => setDirection(-1));
$('#play-button').addEventListener('click', () => { void executeMove().catch(error => message(error.message)); });
$('#result-button').addEventListener('click', showResult);$('#undo-button').addEventListener('click', undo);$('#reset-button').addEventListener('click', reset);
$('#result-replay').addEventListener('click', reset);$('#solution-button').addEventListener('click', showSolution);$('#skip-button').addEventListener('click', stopMotion);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopMotion(); });
window.addEventListener('pagehide', stopMotion);
reducedMotion.addEventListener('change', event => { if (event.matches) stopMotion(); });
$('#sound-button').addEventListener('click', () => { soundEnabled = !soundEnabled;updateSoundButton();if (soundEnabled) sound('drop'); });
$('#player-form').addEventListener('submit', enterPlayer);
$('#player-dialog').addEventListener('cancel', event => { if (!playerName) event.preventDefault(); });
$('#cancel-name-button').addEventListener('click', () => $('#player-dialog').close());
$('#change-name-button').addEventListener('click', openNameDialog);
$('#refresh-leaderboard').addEventListener('click', () => { void loadRanking(); });
$('#retry-score-button').addEventListener('click', () => { void submitPendingScore(); });
window.addEventListener('online', () => { void loadRanking();if (playerName && pendingRun) void submitPendingScore(); });
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
  register({ name: 'read_o_an_quan_position', title: 'Đọc thế cờ ô ăn quan', description: 'Read visible board, score, remaining turns and legal player moves without revealing a solution.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => ({ ...cloneState(state), playerName, remaining: Math.max(0, TURN_LIMIT - state.turns), busy, target: optimal.maxScore, legalMoves: !playerName || finished() ? [] : legalMoves(state).map(move => ({ cell: pitNumber(move.pit), direction: directionName(move.direction) })) }) });
  register({ name: 'play_o_an_quan_move', title: 'Đi một nước ô ăn quan', description: 'Complete one move from player cell 1–5. Sow and capture, consume one of three turns, then return the updated score after animation.', inputSchema: { type: 'object', properties: { cell: { type: 'integer', minimum: 1, maximum: 5 }, direction: { type: 'string', enum: ['left', 'right'] } }, required: ['cell', 'direction'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async input => {
    if (!input || !Number.isInteger(input.cell) || input.cell < 1 || input.cell > 5 || !['left', 'right'].includes(input.direction) || Object.keys(input).some(key => !['cell', 'direction'].includes(key))) throw new Error('Cell must be 1–5 and direction must be left or right.');
    return executeMove(12 - input.cell, input.direction === 'left' ? 1 : -1);
  } });
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
render();restorePendingScore();openNameDialog();void loadRanking();
