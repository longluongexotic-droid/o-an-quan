import { INITIAL_STATE, TURN_LIMIT, cloneState, legalMoves, playMove, solve } from './engine.mjs';

const $ = selector => document.querySelector(selector);
const optimal = solve(INITIAL_STATE, TURN_LIMIT);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let state = cloneState(INITIAL_STATE), history = [], selected = null, direction = 1, hintPit = null;
let busy = false, skipAnimation = false, soundEnabled = false, audioContext;
const pitNumber = pit => 12 - pit;
const directionName = value => value === 1 ? 'trái' : 'phải';
const pitName = pit => pit === 0 ? 'quan trái' : pit === 6 ? 'quan phải' : pit >= 7 ? `ô ${pitNumber(pit)} phía bạn` : `ô ${pit} phía đối diện`;
const finished = () => state.turns >= TURN_LIMIT || state.ended || legalMoves(state).length === 0;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function message(text, kind = '') {
  const element = $('#game-message');element.className = `game-message ${kind}`;element.replaceChildren();
  const icon = document.createElement('span');icon.className = 'message-icon';icon.textContent = kind === 'good' ? '✓' : kind === 'hint' ? '✳' : '↖';
  const copy = document.createElement('span');copy.textContent = text;element.append(icon, copy);
}

function stoneMarkup(index, count) {
  let html = '';
  for (let i = 0; i < Math.min(count, 16); i++) {
    const seed = (index * 137 + i * 83) % 101;
    const x = 19 + (i % 4) * 21 + (seed % 9) - 4, y = 14 + Math.floor(i / 4) * 22 + (seed % 11) - 5;
    html += `<i class="pebble" style="--x:${x}%;--y:${y}%;--r:${seed * 3}deg"></i>`;
  }
  return html;
}

function renderBoard(position = state, action = null) {
  const legal = new Set(busy || finished() ? [] : legalMoves(state).map(move => move.pit));
  const fragment = document.createDocumentFragment();
  for (const index of [0, 1, 2, 3, 4, 5, 6, 11, 10, 9, 8, 7]) {
    const quan = index === 0 || index === 6, hasQuan = quan && position.quan[index === 0 ? 0 : 1], own = index >= 7, count = position.board[index];
    const pit = document.createElement('button');pit.type = 'button';pit.dataset.pit = index;
    pit.className = `pit ${quan ? `quan quan-${index === 0 ? 'left' : 'right'}` : own ? 'own' : 'top'}${count || hasQuan ? '' : ' empty'}${selected === index && !busy ? ' selected' : ''}${hintPit === index && !busy ? ' hinted' : ''}${action?.pit === index ? action.type === 'capture' ? ' capturing' : ' current-action' : ''}`;
    pit.style.gridColumn = quan ? index === 0 ? 1 : 7 : own ? 13 - index : index + 1;
    if (!quan) pit.style.gridRow = own ? 2 : 1;
    pit.disabled = !legal.has(index);
    pit.setAttribute('aria-label', `${pitName(index)}, ${count} dân${hasQuan ? ', 1 quan' : ''}${own && !legal.has(index) && !busy && !finished() ? ', ô trống' : ''}`);
    if (own) pit.setAttribute('aria-pressed', String(selected === index));
    pit.innerHTML = `${quan ? `<span class="quan-name">${index === 0 ? 'QUAN TRÁI' : 'QUAN PHẢI'}</span>` : ''}<span class="stones">${stoneMarkup(index, count)}</span>${hasQuan ? '<i class="big-pebble"></i>' : ''}<span class="pit-count">${count}${hasQuan ? ' + quan' : ''}</span>${own ? `<span class="pit-number">Ô ${pitNumber(index)}</span>` : ''}`;
    fragment.append(pit);
  }
  $('#pits').replaceChildren(fragment);
}

function renderScore(position = state) {
  $('#score').textContent = String(position.score).padStart(2, '0');$('#target-score').textContent = `${optimal.maxScore} điểm`;
  $('#score-progress').style.width = `${Math.min(100, position.score / optimal.maxScore * 100)}%`;
  const captures = history.flatMap(turn => turn.result.captured);
  const civilians = captures.reduce((total, capture) => total + capture.civilians, 0), quan = captures.filter(capture => capture.quan).length;
  const cost = history.reduce((total, turn) => total + turn.result.cost, 0);
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
  for (const [id, value] of [['#direction-left', 1], ['#direction-right', -1]]) { $(id).classList.toggle('active', direction === value);$(id).setAttribute('aria-pressed', String(direction === value));$(id).disabled = busy || done; }
  $('#play-button').disabled = busy || done || selected === null;$('#undo-button').disabled = busy || history.length === 0;$('#reset-button').disabled = busy;$('#hint-button').disabled = busy;
  $('#hint-label').textContent = done ? 'Xem kết quả' : 'Gợi ý một nước';$('#skip-button').hidden = !busy;
}

function render() { renderBoard();renderScore();renderHistory();renderControls(); }

function selectPit(pit, focus = false) {
  if (busy || finished() || !legalMoves(state).some(move => move.pit === pit)) return;
  selected = pit;hintPit = null;renderBoard();renderControls();
  const refill = state.board.every((count, i) => i < 7 || count === 0);
  message(refill ? `Phía bạn đã hết quân. Nước này dùng 5 điểm để đặt lại 5 dân, rồi đi ô ${pitNumber(pit)}.` : `Đã chọn ô ${pitNumber(pit)} có ${state.board[pit]} dân. Chọn chiều rải rồi đi nước này.`);
  if (focus) $(`[data-pit="${pit}"]`).focus({ preventScroll: true });
}

function setDirection(value) { if (busy || finished()) return;direction = value;renderControls(); }

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
  if (busy || finished() || pit === null) throw new Error('Chưa chọn ô hoặc thử thách đã kết thúc.');
  if (!legalMoves(state).some(move => move.pit === pit && move.direction === value)) throw new Error('Ô hoặc chiều rải không hợp lệ.');
  const before = cloneState(state), result = playMove(state, pit, value, { trace: true });
  busy = true;skipAnimation = reducedMotion.matches;selected = null;hintPit = null;renderControls();renderBoard();
  const duration = Math.min(190, 6200 / Math.max(1, result.trace.length));
  for (const event of result.trace) {
    if (skipAnimation) break;
    renderBoard(event.state, event);renderScore(event.state);
    if (event.type === 'pickup') message(`Bốc ${event.count} dân từ ${pitName(event.pit)}${event.relay ? ' để rải tiếp' : ''}.`);
    else if (event.type === 'drop') message(`Rải 1 dân vào ${pitName(event.pit)} · Còn ${event.hand} dân trên tay.`);
    else if (event.type === 'capture') message(`Ăn ${event.civilians} dân${event.quan ? ' và 1 quan' : ''} ở ${pitName(event.pit)}. +${event.points} điểm!`, 'good');
    else if (event.type === 'refill') message('Dùng 5 điểm đặt lại mỗi ô phía bạn 1 dân.');
    if (event.type === 'drop' || event.type === 'capture') sound(event.type);
    if (event.type !== 'end') await sleep(event.type === 'capture' ? Math.min(420, duration * 2) : duration);
  }
  state = result.state;history.push({ before, pit, direction: value, result });busy = false;render();
  $('#score').classList.remove('score-bump');void $('#score').offsetWidth;$('#score').classList.add('score-bump');
  if (finished()) { message(`Thử thách kết thúc. Bạn đạt ${state.score} / ${optimal.maxScore} điểm.`, 'good');showResult(); }
  else message(result.net > 0 ? `Nước vừa rồi ăn được ${result.gained} điểm${result.cost ? `, trừ ${result.cost} điểm đặt lại quân` : ''}. Còn ${TURN_LIMIT - state.turns} lượt — chọn ô tiếp theo.` : `Nước vừa rồi ${result.cost ? `tốn ${result.cost} điểm đặt lại quân và ` : ''}chưa ăn được quân. Còn ${TURN_LIMIT - state.turns} lượt.`, result.net > 0 ? 'good' : '');
  return { score: state.score, turn: state.turns, gained: result.gained, cost: result.cost, finished: finished(), board: state.board.slice(), quan: state.quan.slice() };
}

function showHint() {
  if (busy) return;if (finished()) { showResult();return; }
  const answer = solve(state, TURN_LIMIT - state.turns);if (!answer.bestMove) return;
  selected = answer.bestMove.pit;direction = answer.bestMove.direction;hintPit = selected;renderBoard();renderControls();
  message(`Thử ô ${pitNumber(selected)}, rải sang ${directionName(direction)}. Từ thế cờ hiện tại, điểm cuối cao nhất là ${answer.maxScore}.`, 'hint');
}

function undo() {
  if (busy || !history.length) return;
  const last = history.pop();state = cloneState(last.before);selected = null;hintPit = null;direction = 1;
  $('#result-dialog').close();render();message('Đã quay lại trước nước vừa đi. Bạn có thể thử một phương án khác.');
}

function reset() {
  if (busy) return;
  state = cloneState(INITIAL_STATE);history = [];selected = null;direction = 1;hintPit = null;skipAnimation = false;
  $('#result-dialog').close();$('#solution-path').hidden = true;$('#solution-button').hidden = false;
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

$('#pits').addEventListener('click', event => { const button = event.target.closest('[data-pit]');if (button && !button.disabled) selectPit(Number(button.dataset.pit), true); });
$('#direction-left').addEventListener('click', () => setDirection(1));$('#direction-right').addEventListener('click', () => setDirection(-1));
$('#play-button').addEventListener('click', () => { void executeMove().catch(error => message(error.message)); });
$('#hint-button').addEventListener('click', showHint);$('#undo-button').addEventListener('click', undo);$('#reset-button').addEventListener('click', reset);
$('#result-replay').addEventListener('click', reset);$('#solution-button').addEventListener('click', showSolution);$('#skip-button').addEventListener('click', () => { skipAnimation = true; });
$('#sound-button').addEventListener('click', () => { soundEnabled = !soundEnabled;updateSoundButton();if (soundEnabled) sound('drop'); });
$('#rules-button').addEventListener('click', () => $('#rules-dialog').showModal());
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
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
  register({ name: 'read_o_an_quan_position', title: 'Đọc thế cờ ô ăn quan', description: 'Read visible board, score, remaining turns and legal player moves without revealing a solution.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => ({ ...cloneState(state), remaining: Math.max(0, TURN_LIMIT - state.turns), busy, target: optimal.maxScore, legalMoves: finished() ? [] : legalMoves(state).map(move => ({ cell: pitNumber(move.pit), direction: directionName(move.direction) })) }) });
  register({ name: 'play_o_an_quan_move', title: 'Đi một nước ô ăn quan', description: 'Complete one move from player cell 1–5. Sow and capture, consume one of three turns, then return the updated score after animation.', inputSchema: { type: 'object', properties: { cell: { type: 'integer', minimum: 1, maximum: 5 }, direction: { type: 'string', enum: ['left', 'right'] } }, required: ['cell', 'direction'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async input => {
    if (!input || !Number.isInteger(input.cell) || input.cell < 1 || input.cell > 5 || !['left', 'right'].includes(input.direction) || Object.keys(input).some(key => !['cell', 'direction'].includes(key))) throw new Error('Cell must be 1–5 and direction must be left or right.');
    return executeMove(12 - input.cell, input.direction === 'left' ? 1 : -1);
  } });
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
render();
