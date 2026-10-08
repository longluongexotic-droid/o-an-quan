/**
 * Ô ăn quan — deterministic, three-turn solo planning challenge.
 *
 * Ring order: 0 left quan; 1..5 top left→right; 6 right quan;
 * 7..11 bottom right→left. +1 is clockwise on this drawing.
 * board contains only dân; quan[0]/quan[1] are the big stones at 0/6.
 * Fixed variant: quan = 10, no quan-non threshold, no borrowing. An
 * occupied quan pit blocks relay; an empty pit is a capture gap. A quan
 * with zero dân remains occupied. Remaining dân are not awarded at the
 * end: the challenge scores only captures, less any five-point refill.
 *
 * Reference for scattering/alternating capture/refill:
 * https://arxiv.org/html/2507.03711v1 (III, algorithms 1–2).
 * The paper's optional immature-quan/early-capture restrictions are omitted.
 */

export const TURN_LIMIT = 3;
export const QUAN_VALUE = 10;
export const PLAYER_PITS = Object.freeze([11, 10, 9, 8, 7]);
export const TOP_PITS = Object.freeze([1, 2, 3, 4, 5]);

// A genuine midgame after the four alternating moves recorded below.
// One optimal sequence; 38 net points in three turns versus at most 28
// after taking the largest immediately available capture (13 points).
export const INITIAL_STATE = Object.freeze({
  board: Object.freeze([2, 0, 9, 3, 2, 8, 3, 1, 1, 1, 0, 8]),
  quan: Object.freeze([true, true]),
  score: 0,
  turns: 0,
  ended: false,
});

export const PUZZLE_PROVENANCE = Object.freeze({
  opening: Object.freeze([
    Object.freeze({ side: 'bottom', pit: 9, direction: 1, gained: 6, cost: 0 }),
    Object.freeze({ side: 'top', pit: 4, direction: -1, gained: 6, cost: 0 }),
    Object.freeze({ side: 'bottom', pit: 7, direction: -1, gained: 0, cost: 0 }),
    Object.freeze({ side: 'top', pit: 1, direction: 1, gained: 0, cost: 0 }),
  ]),
  historicalScores: Object.freeze([6, 6]),
  optimalScore: 38,
  selectionSeed: 0x5a17c0de,
  selectionTrial: 54,
  source: 'https://arxiv.org/html/2507.03711v1',
});

export function cloneState(state) {
  return {
    board: state.board.slice(),
    quan: state.quan.slice(),
    score: state.score ?? 0,
    turns: state.turns ?? 0,
    ended: Boolean(state.ended),
  };
}

const next = (pit, direction) => (pit + direction + 12) % 12;
const isQuan = pit => pit === 0 || pit === 6;
const hasQuan = (state, pit) => isQuan(pit) && state.quan[pit === 0 ? 0 : 1];
const occupied = (state, pit) => state.board[pit] > 0 || hasQuan(state, pit);
const rowFor = side => side === 'top' ? TOP_PITS : PLAYER_PITS;

function normalDirection(direction) {
  if (direction === 1 || direction === 'cw') return 1;
  if (direction === -1 || direction === 'ccw') return -1;
  throw new RangeError('Direction must be +1/cw or -1/ccw.');
}

function validateState(state) {
  if (!Array.isArray(state.board) || state.board.length !== 12 ||
      state.board.some(n => !Number.isSafeInteger(n) || n < 0) ||
      !Array.isArray(state.quan) || state.quan.length !== 2 ||
      state.quan.some(n => typeof n !== 'boolean') ||
      !Number.isSafeInteger(state.score ?? 0) || (state.score ?? 0) < 0) {
    throw new TypeError('Invalid Ô ăn quan state.');
  }
}

/** Legal {pit,direction} moves. side='top' is for replaying opening provenance. */
export function legalMoves(state, { side = 'bottom' } = {}) {
  if (state.ended || !state.quan.some(Boolean)) return [];
  const row = rowFor(side);
  const emptyRow = row.every(pit => state.board[pit] === 0);
  if (emptyRow && state.score < 5) return [];
  return row.flatMap(pit => emptyRow || state.board[pit] > 0
    ? [{ pit, direction: 1 }, { pit, direction: -1 }]
    : []);
}

/**
 * Pure move. trace=true emits immutable-by-convention snapshots after each
 * refill/pickup/drop/capture/end; hand stores dân currently being scattered.
 * A move is one complete relay and capture chain, not one scattering lap.
 * The three-turn limit belongs to the challenge controller, not the rules.
 */
export function playMove(state, pit, direction, { trace = false, side = 'bottom' } = {}) {
  validateState(state);
  direction = normalDirection(direction);
  const row = rowFor(side);
  if (!legalMoves(state, { side }).some(move => move.pit === pit)) {
    throw new RangeError('Choose a nonempty dân pit on the playing side.');
  }
  const result = cloneState(state);
  const events = [];
  const captured = [];
  let gained = 0;
  let cost = 0;
  let hand = 0;
  let cursor = pit;
  let stopReason = 'two-empty';
  const record = (type, event = {}) => {
    if (trace) events.push({ type, pit: cursor, hand, ...event, state: cloneState(result) });
  };

  if (row.every(index => result.board[index] === 0)) {
    cost = 5;
    result.score -= cost;
    for (const index of row) result.board[index] = 1;
    record('refill', { pits: row.slice(), cost });
  }

  // A quan is never picked up. Relay always takes dân from an ordinary pit.
  let relayCount = 0;
  while (true) {
    hand = result.board[cursor];
    result.board[cursor] = 0;
    record('pickup', { count: hand, relay: relayCount > 0 });
    while (hand > 0) {
      const from = cursor;
      cursor = next(cursor, direction);
      result.board[cursor] += 1;
      hand -= 1;
      record('drop', { from });
    }
    const adjacent = next(cursor, direction);
    if (occupied(result, adjacent)) {
      if (isQuan(adjacent)) {
        stopReason = 'quan';
        break;
      }
      cursor = adjacent;
      relayCount += 1;
      // A defensive bound against malformed, astronomically large input.
      if (relayCount > 10000) throw new RangeError('Relay limit exceeded.');
      continue;
    }

    // A blank followed by an occupied pit captures the complete pit.
    let gap = adjacent;
    let target = next(gap, direction);
    while (!occupied(result, gap) && occupied(result, target)) {
      const civilians = result.board[target];
      const quan = Boolean(hasQuan(result, target));
      const points = civilians + (quan ? QUAN_VALUE : 0);
      result.board[target] = 0;
      if (quan) result.quan[target === 0 ? 0 : 1] = false;
      result.score += points;
      gained += points;
      captured.push({ pit: target, civilians, quan, points });
      cursor = target;
      record('capture', { gap, civilians, quan, points });
      // End the move immediately when the second quan is captured.
      if (!result.quan.some(Boolean)) {
        stopReason = 'all-quan';
        break;
      }
      gap = next(cursor, direction);
      target = next(gap, direction);
    }
    if (stopReason !== 'all-quan') stopReason = captured.length ? 'capture' : 'two-empty';
    break;
  }
  result.turns += 1;
  result.ended = !result.quan.some(Boolean) ||
    (row.every(index => result.board[index] === 0) && result.score < 5);
  record('end', { reason: stopReason, gained, cost, net: gained - cost });
  return {
    state: result,
    gained,
    cost,
    net: gained - cost,
    captured,
    trace: events,
    move: { pit, direction },
    stopReason,
  };
}

/** Exhaustive bounded search, memoized by complete relevant position. */
export function solve(state, remaining = TURN_LIMIT) {
  validateState(state);
  if (!Number.isSafeInteger(remaining) || remaining < 0 || remaining > 6) {
    throw new RangeError('Search depth must be between 0 and 6.');
  }
  const memo = new Map();
  let nodes = 0;
  function visit(position, depth) {
    const key = `${depth}|${position.board.join(',')}|${position.quan.map(Number).join('')}|${position.score}|${Number(position.ended)}`;
    const cached = memo.get(key);
    if (cached) return cached;
    nodes += 1;
    const moves = depth ? legalMoves(position) : [];
    if (!moves.length) {
      const terminal = { maxScore: position.score, path: [], optimalPaths: 1 };
      memo.set(key, terminal);
      return terminal;
    }
    let best = { maxScore: -Infinity, path: [], optimalPaths: 0 };
    for (const move of moves) {
      const played = playMove(position, move.pit, move.direction);
      const candidate = visit(played.state, depth - 1);
      if (candidate.maxScore > best.maxScore) {
        best = {
          maxScore: candidate.maxScore,
          path: [{ ...move, gained: played.gained, cost: played.cost, net: played.net }, ...candidate.path],
          optimalPaths: candidate.optimalPaths,
        };
      } else if (candidate.maxScore === best.maxScore) {
        best.optimalPaths += candidate.optimalPaths;
      }
    }
    memo.set(key, best);
    return best;
  }
  const best = visit(cloneState(state), remaining);
  return {
    maxScore: best.maxScore,
    maxAddedScore: best.maxScore - state.score,
    bestMove: best.path[0] ? { pit: best.path[0].pit, direction: best.path[0].direction } : null,
    path: best.path.map(move => ({ ...move })),
    optimalPaths: best.optimalPaths,
    movesPlayed: best.path.length,
    finishedEarly: best.path.length < remaining,
    nodes,
  };
}
