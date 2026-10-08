import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { INITIAL_STATE, TURN_LIMIT, cloneState, legalMoves, playMove } from '../engine.mjs';

export const LEVEL_ID = 'ba-nuoc-v1';
export const MIGRATION_URL = new URL('../supabase/migrations/202610090001_leaderboard.sql', import.meta.url);
const START = '-- BEGIN GENERATED TERMINAL PATHS';
const END = '-- END GENERATED TERMINAL PATHS';

/** Only completed paths belong to the server allowlist, including early endings. */
export function completedPaths() {
  const rows = [];
  function visit(state, moves) {
    const legal = legalMoves(state);
    if (moves.length === TURN_LIMIT || state.ended || legal.length === 0) {
      rows.push({ moves, score: state.score });
      return;
    }
    for (const move of legal) {
      visit(playMove(state, move.pit, move.direction).state, [...moves, move]);
    }
  }
  visit(cloneState(INITIAL_STATE), []);
  return rows;
}

export function seedSql() {
  const rows = completedPaths();
  const values = rows.map(({ moves, score }) =>
    "  ('" + LEVEL_ID + "', '" + JSON.stringify(moves) + "'::jsonb, " + score + ')');
  return START + '\n' +
    '-- Generated from engine.mjs: ' + rows.length + ' complete paths; do not edit manually.\n' +
    'insert into oaq_private.valid_paths (level_id, moves, score) values\n' +
    values.join(',\n') + '\n' +
    'on conflict (level_id, moves) do update set score = excluded.score;\n' + END;
}

export function withGeneratedSeed(migration) {
  const start = migration.indexOf(START);
  const end = migration.indexOf(END);
  if (start < 0 || end < start || migration.indexOf(START, start + START.length) !== -1) {
    throw new Error('Migration must contain exactly one generated terminal-path block.');
  }
  return migration.slice(0, start) + seedSql() + migration.slice(end + END.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const migration = await readFile(MIGRATION_URL, 'utf8');
  const generated = withGeneratedSeed(migration);
  if (process.argv.includes('--write')) {
    await writeFile(MIGRATION_URL, generated);
    console.log('Wrote ' + completedPaths().length + ' completed paths to the migration.');
  } else if (generated !== migration) {
    console.error('Terminal-path seed is out of date. Run node scripts/generate-leaderboard-paths.mjs --write.');
    process.exitCode = 1;
  } else {
    console.log('Verified ' + completedPaths().length + ' completed paths against engine.mjs.');
  }
}
