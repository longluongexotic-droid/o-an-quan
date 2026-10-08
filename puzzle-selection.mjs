// Reproducible search used to choose the one shipped position.
// Run with `node puzzle-selection.mjs`; it does not write any files.
import { playMove, legalMoves, solve } from './engine.mjs';

let seed = 0x5a17c0de;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const fresh = () => ({ board: [0,5,5,5,5,5,0,5,5,5,5,5], quan: [true,true], score:0, turns:0, ended:false });
const trials = Number(process.argv[2]) || 3500;
const seen = new Set();
let best = null;
for (let trial = 0; trial < trials; trial += 1) {
  let state = fresh();
  const opening = [];
  const historicalScores = [0, 0];
  const length = [4,6,8][trial % 3];
  for (let step = 0; step < length; step += 1) {
    const side = step % 2 === 0 ? 'bottom' : 'top';
    // Each player has their own captured bank while the historical game alternates.
    state.score = historicalScores[step % 2];
    state.ended = !state.quan.some(Boolean);
    const moves = legalMoves(state, {side});
    if (!moves.length) break;
    const move = moves[Math.floor(random() * moves.length)];
    const played = playMove(state, move.pit, move.direction, {side});
    state = played.state;
    historicalScores[step % 2] = state.score;
    opening.push({side,...move,gained:played.gained,cost:played.cost});
  }
  if (opening.length !== length || !state.quan.every(Boolean)) continue;
  state = {...state,score:0,turns:0,ended:false};
  const hash = state.board.join(',');
  if (seen.has(hash)) continue;
  seen.add(hash);
  const boardTotal = state.board.reduce((sum,n)=>sum+n,0);
  const zeros = state.board.filter(n=>n===0).length;
  if (boardTotal < 25 || boardTotal > 43 || zeros < 2 || Math.max(...state.board) > 12) continue;
  const solution = solve(state,3);
  if (solution.optimalPaths !== 1 || solution.finishedEarly || solution.path.some(move=>move.cost>0) ||
      solution.maxScore < 20 || solution.path[0].gained > 7) continue;
  const choices = legalMoves(state).map(move => {
    const played = playMove(state,move.pit,move.direction);
    return {...move,gained:played.gained,eventCount:playMove(state,move.pit,move.direction,{trace:true}).trace.length,
      final:solve(played.state,2).maxScore};
  });
  const greedyGain = Math.max(...choices.map(move=>move.gained));
  const greedyFinal = Math.max(...choices.filter(move=>move.gained===greedyGain).map(move=>move.final));
  const gap = solution.maxScore-greedyFinal;
  if (gap < 5) continue;
  let replay = state;
  const bestTraceLengths = solution.path.map(move => {
    const played = playMove(replay,move.pit,move.direction,{trace:true});
    replay = played.state;
    return played.trace.length;
  });
  const rating = gap*5 + zeros*2 + new Set(state.board).size*2 - Math.max(...state.board) +
    (solution.path.every(move=>move.gained>0)?8:0) - bestTraceLengths.reduce((sum,n)=>sum+Math.max(0,n-35),0)*0.25;
  const candidate = {trial,rating,state,opening,historicalScores,solution,greedyGain,greedyFinal,choices,bestTraceLengths};
  if (!best || candidate.rating > best.rating) {
    best = candidate;
    console.log(JSON.stringify(candidate));
  }
}
console.log('FINAL '+JSON.stringify(best));
