import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_STATE, TURN_LIMIT, PUZZLE_PROVENANCE,
  cloneState, legalMoves, playMove, solve,
} from './engine.mjs';

const position = (board, quan = [true, true], score = 0) => ({
  board, quan, score, turns: 0, ended: false,
});
const weightedTotal = state => state.board.reduce((sum, n) => sum + n, 0) +
  state.quan.filter(Boolean).length * 10 + state.score;

test('opening provenance replays from a standard board without an invented state', () => {
  let state = position([0,5,5,5,5,5,0,5,5,5,5,5]);
  const scores = [0,0];
  for (const [index, move] of PUZZLE_PROVENANCE.opening.entries()) {
    const sideIndex = index % 2;
    state.score = scores[sideIndex];
    state.ended = false;
    assert.equal(move.side, sideIndex === 0 ? 'bottom' : 'top');
    const played = playMove(state, move.pit, move.direction, { side: move.side });
    assert.equal(played.gained, move.gained);
    assert.equal(played.cost, move.cost);
    state = played.state;
    scores[sideIndex] = state.score;
  }
  assert.deepEqual(state.board, INITIAL_STATE.board);
  assert.deepEqual(state.quan, INITIAL_STATE.quan);
  assert.deepEqual(scores, PUZZLE_PROVENANCE.historicalScores);
  assert.equal(state.board.reduce((sum,n)=>sum+n,0) + 20 + scores[0] + scores[1], 70);
  assert.equal(INITIAL_STATE.score, 0);
});

test('only occupied player pits can begin moves; callers cannot mutate the shipped position', () => {
  assert.deepEqual([...new Set(legalMoves(INITIAL_STATE).map(move => move.pit))], [11,9,8,7]);
  assert.throws(() => playMove(INITIAL_STATE, 1, 1), RangeError);
  assert.throws(() => playMove(INITIAL_STATE, 0, 1), RangeError);
  assert.throws(() => playMove(INITIAL_STATE, 10, 1), RangeError);
  assert.throws(() => playMove(INITIAL_STATE, 11, 0), RangeError);
  const copy = cloneState(INITIAL_STATE);
  copy.board[11] = 100;
  copy.quan[0] = false;
  assert.equal(INITIAL_STATE.board[11], 8);
  assert.equal(INITIAL_STATE.quan[0], true);
});

test('occupied quan with zero civilians stops relay and cannot be picked up', () => {
  const state = position([0,0,0,0,0,0,0,0,1,0,0,0]);
  const played = playMove(state, 8, -1, { trace: true });
  assert.equal(played.stopReason, 'quan');
  assert.equal(played.gained, 0);
  assert.equal(played.state.board[7], 1);
  assert.deepEqual(played.state.quan, [true,true]);
  assert.deepEqual(played.trace.map(event=>event.type), ['pickup','drop','end']);
});

test('relay scoops the NEXT ordinary pit after the final drop, not the landing pit', () => {
  const state = position([0,1,0,0,0,0,0,1,5,2,0,0]);
  const played = playMove(state, 7, 1, { trace: true });
  const pickups = played.trace.filter(event=>event.type==='pickup');
  assert.deepEqual(pickups.map(event=>event.pit), [7,9]);
  assert.equal(pickups[1].count, 2);
  assert.equal(played.state.board[8], 6);
  assert.deepEqual(played.state.board.slice(9,12), [0,1,1]);
  assert.equal(played.stopReason, 'quan');
});

test('capture chains alternate gaps and occupied pits; bare quan is worth ten', () => {
  const state = position([0,0,3,0,2,1,0,1,0,0,4,0]);
  const played = playMove(state, 7, 1, { trace: true });
  assert.deepEqual(played.captured, [
    {pit:10,civilians:4,quan:false,points:4},
    {pit:0,civilians:0,quan:true,points:10},
    {pit:2,civilians:3,quan:false,points:3},
    {pit:4,civilians:2,quan:false,points:2},
  ]);
  assert.equal(played.gained, 19);
  assert.deepEqual(played.state.quan, [false,true]);
  assert.equal(played.state.board[5], 1);
  assert.equal(played.state.score, 19);
});

test('two consecutive empty pits stop without skipping farther toward a rich pit', () => {
  const state = position([0,0,0,0,0,0,0,1,0,0,0,7]);
  const played = playMove(state, 7, 1);
  assert.equal(played.gained, 0);
  assert.equal(played.state.board[11], 7);
  assert.equal(played.stopReason, 'two-empty');
});

test('an empty own row spends exactly five captured points before sowing; no borrowing', () => {
  const board = [1,1,1,1,1,1,1,0,0,0,0,0];
  const poor = position(board.slice(), [true,true], 4);
  assert.deepEqual(legalMoves(poor), []);
  assert.throws(() => playMove(poor, 11, 1), RangeError);
  const rich = position(board.slice(), [true,true], 5);
  assert.equal(legalMoves(rich).length, 10);
  const played = playMove(rich, 11, 1, {trace:true});
  assert.equal(played.cost, 5);
  assert.equal(played.state.score, rich.score + played.gained - 5);
  assert.equal(played.trace[0].type, 'refill');
  assert.equal(played.trace[0].state.score, 0);
  assert.deepEqual(played.trace[0].state.board.slice(7), [1,1,1,1,1]);
  assert.equal(weightedTotal(played.state), weightedTotal(rich));
});

test('capturing the final quan ends immediately without awarding leftover dân', () => {
  const state = position([0,0,0,0,0,0,0,1,0,0,2,0], [true,false]);
  const played = playMove(state, 7, 1);
  assert.equal(played.gained, 12);
  assert.equal(played.state.ended, true);
  assert.equal(played.state.board[8], 1);
  assert.deepEqual(legalMoves(played.state), []);
  const terminal = solve(played.state, 2);
  assert.equal(terminal.maxAddedScore, 0);
  assert.equal(terminal.movesPlayed, 0);
  assert.equal(terminal.finishedEarly, true);
});

test('every initial move and all animation snapshots conserve weighted stones', () => {
  for (const move of legalMoves(INITIAL_STATE)) {
    const before = cloneState(INITIAL_STATE);
    const played = playMove(before, move.pit, move.direction, {trace:true});
    assert.deepEqual(before, cloneState(INITIAL_STATE));
    assert.equal(weightedTotal(played.state), weightedTotal(before));
    for (const event of played.trace) {
      assert.equal(weightedTotal(event.state) + event.hand, weightedTotal(before));
      assert.ok(event.state.board.every(n=>Number.isInteger(n)&&n>=0));
    }
    assert.deepEqual(played.trace.at(-1).state, played.state);
  }
});

test('solver equals independent full tree enumeration, with one three-turn optimum', () => {
  function enumerate(state, depth) {
    const moves = depth ? legalMoves(state) : [];
    if (!moves.length) return [{score:state.score,path:[]}];
    return moves.flatMap(move => {
      const played = playMove(state, move.pit, move.direction);
      return enumerate(played.state,depth-1).map(leaf=>({score:leaf.score,path:[move,...leaf.path]}));
    });
  }
  const leaves = enumerate(INITIAL_STATE, TURN_LIMIT);
  const maximum = Math.max(...leaves.map(leaf=>leaf.score));
  const optimal = leaves.filter(leaf=>leaf.score===maximum);
  const solution = solve(INITIAL_STATE, TURN_LIMIT);
  assert.equal(solution.maxScore, maximum);
  assert.equal(solution.maxAddedScore, 38);
  assert.equal(solution.optimalPaths, optimal.length);
  assert.equal(solution.optimalPaths, 1);
  assert.equal(solution.movesPlayed, 3);
  assert.equal(solution.finishedEarly, false);
  assert.deepEqual(solution.path.map(({pit,direction})=>({pit,direction})), [
    {pit:9,direction:-1},{pit:7,direction:1},{pit:7,direction:-1},
  ]);
  assert.deepEqual(solution.path.map(move=>move.gained), [3,16,19]);
  assert.ok(solution.path.every(move=>move.cost===0));
  const greedy = playMove(INITIAL_STATE,7,1);
  assert.equal(greedy.gained, 13);
  assert.equal(solve(greedy.state,2).maxScore, 28);
});
