// Prints each mission's par from its reference solution, and fails loudly if one does not land.
import { readFileSync } from 'node:fs';
import { loadPyodide } from 'pyodide';
import { LEVELS, programLines } from '../src/levels.ts';
import { SOLUTIONS } from '../tests/solutions.ts';

const py = await loadPyodide({ indexURL: new URL('../node_modules/pyodide/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
py.runPython(readFileSync(new URL('../src/rover.py', import.meta.url), 'utf8'));
const run = py.globals.get('run_level');
for (const level of LEVELS) {
  const runs = JSON.parse(run(JSON.stringify(level.maps), SOLUTIONS[level.id]));
  const bad = runs.filter((r: { ok: boolean }) => !r.ok);
  const actions = runs.reduce((s: number, r: { actions: number }) => s + r.actions, 0);
  console.log(`${level.id}: { actions: ${actions}, lines: ${programLines(SOLUTIONS[level.id])} }${bad.length ? '  FAILS: ' + bad.map((r: { message: string }) => r.message).join('; ') : ''}`);
}
