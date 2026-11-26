// The missions. A map is a list of rows: "." ground, "#" rock, "o" crater, "*" sample, "L" the lander, and the rover
// as ">", "<", "^" or "v" (the way it faces). A mission with several maps is passed only when the same program
// succeeds on every one of them, so it has to look around instead of counting steps.

export type Level = {
  id: string;
  chapter: number;
  title: string;
  // What this mission teaches, in a few sentences. `code` spans are shown as code.
  brief: string;
  maps: string[][];
  starter: string;
  // Fewest actions (moves, turns, picks; all maps together) and shortest program (lines that are not blank or
  // comments), both from the reference solutions in tests/levels.test.ts.
  par: { actions: number; lines: number };
  // Functions introduced here, shown in the reference.
  introduces?: string[];
};

export const CHAPTERS = ['First drive', 'Loops', 'Sensors', 'Functions'];

// A small seeded random generator (mulberry32), so generated maps are the same for everyone.
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A perfect maze (one path between any two cells) of `cols` × `rows` rooms, walled with rock. The rover starts in the
// top-left room facing east; the lander is in the bottom-right room. With `samples`, that many dead ends get a sample.
export function maze(cols: number, rows: number, seed: number, samples = 0): string[] {
  const rand = random(seed);
  const w = cols * 2 + 1, h = rows * 2 + 1;
  const grid = Array.from({ length: h }, () => Array<string>(w).fill('#'));
  const seen = new Set<number>();
  const stack: [number, number][] = [[0, 0]];
  seen.add(0);
  grid[1][1] = '.';
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const options = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).filter(([dx, dy]) => {
      const nx = cx + dx, ny = cy + dy;
      return nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen.has(ny * cols + nx);
    });
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [dx, dy] = options[Math.floor(rand() * options.length)];
    const nx = cx + dx, ny = cy + dy;
    grid[cy * 2 + 1 + dy][cx * 2 + 1 + dx] = '.';
    grid[ny * 2 + 1][nx * 2 + 1] = '.';
    seen.add(ny * cols + nx);
    stack.push([nx, ny]);
  }
  if (samples) {
    const ends: [number, number][] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if ((x === 0 && y === 0) || (x === cols - 1 && y === rows - 1)) continue;
        const gx = x * 2 + 1, gy = y * 2 + 1;
        const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => grid[gy + dy][gx + dx] !== '#').length;
        if (open === 1) ends.push([gx, gy]);
      }
    }
    for (let i = 0; i < samples && ends.length; i++) {
      const [gx, gy] = ends.splice(Math.floor(rand() * ends.length), 1)[0];
      grid[gy][gx] = '*';
    }
  }
  grid[1][1] = '>';
  grid[h - 2][w - 2] = 'L';
  return grid.map((r) => r.join(''));
}

// A walled field of `width` × `height` ground with `count` samples in random places (never under the rover or on the
// lander). The rover starts top-left facing east; the lander is at the end of the last row.
export function field(width: number, height: number, count: number, seed: number): string[] {
  const rand = random(seed);
  const grid = Array.from({ length: height + 2 }, (_, y) =>
    Array.from({ length: width + 2 }, (_, x): string => (x === 0 || y === 0 || x === width + 1 || y === height + 1 ? '#' : '.')),
  );
  const endX = height % 2 === 1 ? width : 1;
  let placed = 0;
  while (placed < count) {
    const x = 1 + Math.floor(rand() * width), y = 1 + Math.floor(rand() * height);
    if ((x === 1 && y === 1) || (x === endX && y === height) || grid[y][x] === '*') continue;
    grid[y][x] = '*';
    placed++;
  }
  grid[1][1] = '>';
  grid[height][endX] = 'L';
  return grid.map((r) => r.join(''));
}

export const LEVELS: Level[] = [
  {
    id: 'touchdown',
    chapter: 0,
    title: 'Touchdown',
    brief: 'Your rover has landed far from base. Each `move()` drives it one square forward. Drive it onto the lander.',
    maps: [['........', '.>....L.', '........']],
    starter: '# Drive the rover onto the lander.\nmove()\n',
    par: { actions: 5, lines: 5 },
    introduces: ['move'],
  },
  {
    id: 'bend',
    chapter: 0,
    title: 'Round the bend',
    brief: '`turn_left()` and `turn_right()` turn the rover on the spot, a quarter turn each. Follow the trench to the lander.',
    maps: [['#######', '#>...##', '####.##', '####.##', '####L##']],
    starter: 'move()\nmove()\nmove()\n',
    par: { actions: 7, lines: 7 },
    introduces: ['turn_left', 'turn_right'],
  },
  {
    id: 'first-sample',
    chapter: 0,
    title: 'First sample',
    brief: 'Base wants rock samples. Stop on the sample and call `pick()` to take it on board. The lander only counts once every sample is on board.',
    maps: [['.........', '.>..*...L', '.........']],
    starter: '',
    par: { actions: 8, lines: 8 },
    introduces: ['pick'],
  },
  {
    id: 'rock-garden',
    chapter: 0,
    title: 'Rock garden',
    brief: 'Weave between the rocks, pick up the sample and reach the lander. Hitting a rock ends the run: the replay shows which line did it.',
    maps: [['..........', '.>..#.....', '....#..#..', '...*...#.L']],
    starter: '',
    par: { actions: 20, lines: 20 },
  },
  {
    id: 'long-haul',
    chapter: 1,
    title: 'Long haul',
    brief:
      'Fifteen squares is a lot of `move()` lines. A loop repeats lines for you:\n`for step in range(15):`\n`    move()`\nThe indented lines are the ones that repeat. For the third star, make the program two lines long.',
    maps: [['>..............L']],
    starter: 'for step in range(3):\n    move()\n',
    par: { actions: 15, lines: 2 },
  },
  {
    id: 'staircase',
    chapter: 1,
    title: 'Staircase',
    brief: 'A loop can repeat several lines. Find the pattern in the steps, write it once, and repeat it.',
    maps: [['>.#####', '#..####', '##..###', '###..##', '####..#', '#####.L']],
    starter: 'for step in range(5):\n    move()\n',
    par: { actions: 21, lines: 6 },
  },
  {
    id: 'sample-row',
    chapter: 1,
    title: 'Sample row',
    brief: 'Five samples, evenly spaced. Repeat a move-move-pick pattern, then finish the drive.',
    maps: [['>.*.*.*.*.*.L']],
    starter: '',
    par: { actions: 17, lines: 6 },
  },
  {
    id: 'square',
    chapter: 1,
    title: 'Crater rim',
    brief: 'Drive around the rim and pick up the samples at three corners. A loop inside a loop is fine: indent it one more step.',
    maps: [['#######', '#>...*#', '#L###.#', '#.###.#', '#.###.#', '#*...*#', '#######']],
    starter: 'for side in range(3):\n    pass  # your lines here\n',
    par: { actions: 21, lines: 7 },
  },
  {
    id: 'unknown-distance',
    chapter: 2,
    title: 'How far?',
    brief:
      'This mission runs your program on three maps, and the lander is at a different distance on each. `ahead()` tells you what is in front of the rover: "clear", "rock", "crater", "sample", "lander" or "edge". Keep moving `while` the lander is not ahead, then drive onto it.',
    maps: [['>...L'], ['>........L'], ['>.............L']],
    starter: 'while ahead() != "lander":\n    pass  # what should repeat?\n',
    par: { actions: 27, lines: 3 },
    introduces: ['ahead'],
  },
  {
    id: 'trench',
    chapter: 2,
    title: 'Follow the trench',
    brief:
      'Three winding trenches. `here()` tells you what is under the rover. Until you are on the lander: when rock is ahead, try turning left; if that is rock too, turn the other way. Then move.',
    maps: [
      ['#########', '#>....###', '#####.###', '#####...#', '#######.#', '#######L#', '#########'],
      ['##########', '#v########', '#.########', '#....#####', '####.#####', '####....L#', '##########'],
      ['#######', '#L....#', '#####.#', '#.....#', '#.#####', '#....<#', '#######'],
    ],
    starter: 'while here() != "lander":\n    if ahead() == "rock":\n        turn_left()\n    move()\n',
    par: { actions: 57, lines: 7 },
    introduces: ['here'],
  },
  {
    id: 'scatter',
    chapter: 2,
    title: 'Scattered samples',
    brief: 'Samples lie in different places on each map. After each move, check `here()` and pick up what you find.',
    maps: [['>.*..**.*.L'], ['>*...*....*L'], ['>..*.*.*.*.*L']],
    starter: '',
    par: { actions: 45, lines: 4 },
  },
  {
    id: 'craters',
    chapter: 2,
    title: 'Crater field',
    brief:
      'Driving into a crater ends the mission. When a crater is ahead, go round it through the row above, which is always clear. `if`, `else` and a few turns will do.',
    maps: [
      ['...........', '>..o...o..L', '###########'],
      ['............', '>o..o..o...L', '############'],
      ['............', '>....o.o...L', '############'],
    ],
    starter: 'while here() != "lander":\n    if ahead() == "crater":\n        pass  # go round it\n    else:\n        move()\n',
    par: { actions: 74, lines: 12 },
  },
  {
    id: 'about-turn',
    chapter: 3,
    title: 'About turn',
    brief:
      'You will turn around twice. Give it a name with `def`, then call it like any other function:\n`def turn_around():`\n`    turn_left()`\n`    turn_left()`',
    maps: [['*...L..>...*']],
    starter: 'def turn_around():\n    turn_left()\n    turn_left()\n\n',
    par: { actions: 25, lines: 13 },
  },
  {
    id: 'maze',
    chapter: 3,
    title: 'The labyrinth',
    brief:
      'Three canyon mazes. A rover that always keeps the rock on its right finds the way out of any of them: at each square, turn right, then turn left while rock is ahead, then move.',
    maps: [maze(5, 4, 11), maze(6, 4, 23), maze(6, 5, 37)],
    starter: 'while here() != "lander":\n    # keep the rock on your right\n    move()\n',
    par: { actions: 202, lines: 5 },
  },
  {
    id: 'sweep',
    chapter: 3,
    title: 'Sweep the field',
    brief:
      'Samples are scattered across a walled field, differently on each map. Sweep it row by row, like mowing a lawn. Write a function for one row and you are halfway there.',
    maps: [field(7, 5, 6, 5), field(7, 5, 6, 8), field(7, 5, 6, 13)],
    starter: 'def collect():\n    if here() == "sample":\n        pick()\n\n',
    par: { actions: 144, lines: 20 },
  },
  {
    id: 'lost-samples',
    chapter: 3,
    title: 'Lost in the canyons',
    brief:
      'The last mission: samples lie in dead ends of three mazes. Keep the rock on your right, pick up what you find, and land once `samples_left()` is 0. The rock-on-the-right rule visits every corner of these mazes.',
    maps: [maze(6, 5, 41, 3), maze(7, 5, 53, 4), maze(7, 6, 67, 5)],
    starter: '',
    par: { actions: 955, lines: 7 },
    introduces: ['samples_left'],
  },
];

// Lines that count towards a program's length: not blank, not only a comment.
export function programLines(code: string): number {
  return code.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')).length;
}

export function stars(level: Level, actions: number, lines: number): number {
  return 1 + (actions <= level.par.actions ? 1 : 0) + (lines <= level.par.lines ? 1 : 0);
}
