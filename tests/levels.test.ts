// Runs src/rover.py in the real Pyodide (from node_modules), the same code the page runs in its worker.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPyodide, type PyodideAPI } from 'pyodide';
import { LEVELS, programLines, stars } from '../src/levels.ts';
import { SOLUTIONS } from './solutions.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
let pyodide: PyodideAPI;

type Run = { ok: boolean; message: string; line: number; kind: string; actions: number; trace: unknown[][]; output: [number, string][] };

function run(maps: string[][], code: string): Run[] {
  const fn = pyodide.globals.get('run_level');
  try {
    return JSON.parse(fn(JSON.stringify(maps), code));
  } finally {
    fn.destroy();
  }
}

beforeAll(async () => {
  pyodide = await loadPyodide({ indexURL: `${root}node_modules/pyodide/` });
  pyodide.runPython(readFileSync(`${root}src/rover.py`, 'utf8'));
}, 120_000);

describe('every mission', () => {
  for (const level of LEVELS) {
    it(`${level.title}: the reference solution lands on every map, at par`, () => {
      const code = SOLUTIONS[level.id];
      expect(code, 'a reference solution').toBeTruthy();
      const runs = run(level.maps, code);
      for (const [i, r] of runs.entries()) expect(r.ok, `map ${i + 1}: ${r.message} (line ${r.line})`).toBe(true);
      const actions = runs.reduce((sum, r) => sum + r.actions, 0);
      expect({ actions, lines: programLines(code) }).toEqual(level.par);
      expect(stars(level, actions, programLines(code))).toBe(3);
    });
  }

  it('maps are rectangular, with one rover and one lander each', () => {
    for (const level of LEVELS) {
      for (const map of level.maps) {
        expect(new Set(map.map((r) => r.length)).size, level.id).toBe(1);
        const text = map.join('');
        expect(text.match(/[<>^v]/g)?.length, level.id).toBe(1);
        expect(text.match(/L/g)?.length, level.id).toBe(1);
      }
    }
  });

  it('multi-map missions cannot be solved by counting steps for the first map', () => {
    for (const level of LEVELS.filter((l) => l.maps.length > 1)) {
      const first = run([level.maps[0]], SOLUTIONS[level.id]);
      expect(first[0].ok).toBe(true);
      // The first map's exact moves, replayed as a fixed program, fail on another map.
      const moves = (first[0].trace as [string, number, number, string][])
        .filter((t) => ['move', 'turn', 'pick'].includes(t[0]))
        .map((t, i, all) => {
          if (t[0] === 'pick') return 'pick()';
          if (t[0] === 'move') return 'move()';
          const before = i === 0 ? first[0].trace[0][3] : all[i - 1][3];
          return 'NESW'.indexOf(t[3]) === ('NESW'.indexOf(before as string) + 1) % 4 ? 'turn_right()' : 'turn_left()';
        });
      const fixed = run(level.maps, moves.join('\n'));
      expect(fixed.some((r) => !r.ok), level.id).toBe(true);
    }
  });
});

describe('the rover', () => {
  it('stops at rocks, craters and the edge, with the line that did it', () => {
    expect(run([['>#L']], 'move()')[0]).toMatchObject({ ok: false, message: 'The rover hit a rock.', line: 1 });
    expect(run([['>oL']], '\nmove()')[0]).toMatchObject({ ok: false, message: 'The rover drove into a crater.', line: 2 });
    expect(run([['L<']], 'turn_left()\nmove()')[0]).toMatchObject({ ok: false, message: 'The rover would drive off the map.', line: 2 });
    expect(run([['>.L']], 'pick()')[0]).toMatchObject({ ok: false, message: 'There is no sample here to pick up.' });
  });

  it('reports Python errors on the right line, with Python’s suggestion', () => {
    const typo = run([['>L']], 'mvoe()')[0];
    expect(typo).toMatchObject({ ok: false, line: 1, kind: 'error' });
    expect(typo.message).toMatch(/NameError: name 'mvoe' is not defined/);
    expect(run([['>L']], 'for i in range(3)\n    move()')[0]).toMatchObject({ ok: false, line: 1, kind: 'syntax' });
  });

  it('ends runaway programs', () => {
    expect(run([['>.L']], 'while True:\n    turn_left()')[0].message).toMatch(/2000 moves/);
    expect(run([['>.L']], 'while True:\n    pass')[0].message).toMatch(/very long time/);
  });

  it('says what is missing when the program ends early, and keeps what it printed', () => {
    const r = run([['>*.L']], 'print("going", 1)\nmove()\npick()')[0];
    expect(r).toMatchObject({ ok: false, message: 'Every sample is on board, but the rover is not on the lander.' });
    expect(r.output).toEqual([[1, 'going 1']]);
    expect(run([['>*.L']], 'move()\nmove()\nmove()')[0].message).toBe('1 sample still to collect.');
  });

  it('senses what is ahead and underneath', () => {
    const r = run([['>*#'], ['>L']], 'print(ahead(), here(), samples_left(), facing())')[0];
    expect(r.output[0][1]).toBe('sample clear 1 E');
  });

  it('cannot be fooled by catching a crash or an arrival', () => {
    const crater = run([['>o.L']], 'try:\n    move()\nexcept Exception:\n    pass\nmove()\nmove()')[0];
    expect(crater).toMatchObject({ ok: false, message: 'The rover drove into a crater.', line: 2, kind: 'stop' });
    const rock = run([['>#L']], 'try:\n    move()\nexcept:\n    pass\nturn_left()')[0];
    expect(rock).toMatchObject({ ok: false, message: 'The rover hit a rock.', line: 2 });
    const limit = run([['>.L']], 'while True:\n    try:\n        turn_left()\n    except:\n        pass')[0];
    expect(limit).toMatchObject({ ok: false, kind: 'stop' });
    expect(limit.message).toMatch(/2000 moves/);
    const landed = run([['>L']], 'try:\n    move()\nexcept:\n    pass\nmove()')[0];
    expect(landed).toMatchObject({ ok: true, kind: 'done', actions: 1 });
  });

  it('ends the program as soon as the rover lands', () => {
    const r = run([['>L']], 'move()\nprint("after")')[0];
    expect(r).toMatchObject({ ok: true, actions: 1 });
    expect(r.output).toEqual([]);
  });

  it('points at the line for limits, input and recursion', () => {
    const loop = run([['>.L']], '\nwhile True:\n    pass')[0];
    expect(loop.kind).toBe('stop');
    expect([2, 3]).toContain(loop.line);
    expect(run([['>.L']], 'move()\nx = input()')[0]).toMatchObject({ kind: 'stop', line: 2, message: expect.stringMatching(/can't ask for input/) });
    const recursion = run([['>.L']], 'def go():\n    go()\ngo()')[0];
    expect(recursion).toMatchObject({ kind: 'error', message: 'RecursionError: a function kept calling itself.' });
    expect([2, 3]).toContain(recursion.line);
  });

  it('prints like Python, and caps a flood of output', () => {
    expect(run([['>L']], 'print("a", "b", sep=None, end=None)\nprint(1, 2, sep="-")')[0].output).toEqual([
      [1, 'a b'],
      [2, '1-2'],
    ]);
    const flood = run([['>.L']], 'for i in range(500):\n    print(i)')[0].output;
    expect(flood).toHaveLength(201);
    expect(flood[200][1]).toMatch(/rest is not shown/);
  });
});

describe('scoring', () => {
  const level = LEVELS[0];
  it('gives one star for landing, one for the action par and one for the line par', () => {
    expect(stars(level, level.par.actions, level.par.lines)).toBe(3);
    expect(stars(level, level.par.actions + 1, level.par.lines)).toBe(2);
    expect(stars(level, level.par.actions, level.par.lines + 1)).toBe(2);
    expect(stars(level, level.par.actions + 1, level.par.lines + 1)).toBe(1);
  });

  it('counts only lines that do something', () => {
    expect(programLines('# plan\nmove()\n\n   \n    # turn\nturn_left()  # left\n')).toBe(2);
  });
});
