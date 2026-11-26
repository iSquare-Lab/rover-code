import '@fontsource-variable/sora';
import '@fontsource-variable/jetbrains-mono';
import './style.css';
import { createEditor } from './editor.ts';
import { CHAPTERS, LEVELS, programLines, stars, type Level } from './levels.ts';
import type { Event, FromWorker, Run, ToWorker } from './protocol.ts';
import { angleOf, draw, readPalette, type Palette, type Scene } from './render.ts';

// ── Saved progress (this browser only) ───────────────────────────────────────────────────────────────────────────

type Progress = { current: string; code: Record<string, string>; stars: Record<string, number> };
const KEY = 'rover-code:progress';
function loadProgress(): Progress {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Progress | null;
    if (saved && typeof saved === 'object') return { current: saved.current ?? LEVELS[0].id, code: saved.code ?? {}, stars: saved.stars ?? {} };
  } catch {
    /* fall through */
  }
  return { current: LEVELS[0].id, code: {}, stars: {} };
}
const progress = loadProgress();
let saveTimer = 0;
function saveProgress(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(progress));
    } catch {
      /* storage full or off: progress is not kept */
    }
  }, 300);
}

// ── Page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('map');
const ctx = canvas.getContext('2d')!;
const runButton = $<HTMLButtonElement>('run-btn');
const runLabel = $('run-label');
const log = $('log');
const result = $('result');
const skipButton = $<HTMLButtonElement>('skip-btn');

let level: Level = LEVELS.find((l) => l.id === progress.current) ?? LEVELS[0];
let palette: Palette = readPalette(document.documentElement);
let shownMap = 0;
let scene: Scene = sceneFor(level.maps[0]);

const editor = createEditor(
  $('editor'),
  progress.code[level.id] ?? level.starter,
  (code) => {
    progress.code[level.id] = code;
    saveProgress();
    editor.mark(0, 0);
  },
  () => run(),
  'Python program for the rover',
);

function sceneFor(rows: string[]): Scene {
  let pose = { x: 0, y: 0, angle: 0 };
  rows.forEach((row, y) => {
    const x = row.search(/[<>^v]/);
    if (x >= 0) pose = { x, y, angle: angleOf({ '^': 'N', '>': 'E', v: 'S', '<': 'W' }[row[x]]!) };
  });
  return { rows, picked: new Set(), pose, trail: [[pose.x, pose.y]], crashed: false, flash: 0, landed: false };
}

// Describes a map in words for screen readers: its size and where things are.
function describeMap(rows: string[]): string {
  const count = (ch: string) => rows.join('').split(ch).length - 1;
  const rover = rows.findIndex((r) => /[<>^v]/.test(r));
  const lander = rows.findIndex((r) => r.includes('L'));
  return `Map ${rows[0].length} by ${rows.length} squares. Rover at row ${rover + 1}, column ${rows[rover].search(/[<>^v]/) + 1}. Lander at row ${lander + 1}, column ${rows[lander].indexOf('L') + 1}. ${count('*')} samples, ${count('#')} rocks, ${count('o')} craters.`;
}

function showLevel(next: Level): void {
  stopPlayback();
  level = next;
  progress.current = level.id;
  saveProgress();
  editor.setCode(progress.code[level.id] ?? level.starter);
  editor.mark(0, 0);
  $('chapter').textContent = `Chapter ${level.chapter + 1} · ${CHAPTERS[level.chapter]} · Mission ${LEVELS.indexOf(level) + 1} of ${LEVELS.length}`;
  $('mission-title').textContent = level.title;
  $('brief').innerHTML = level.brief
    .split('\n')
    .map((line) => `<p>${escapeHtml(line).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`)
    .join('');
  $('par').textContent = `★ land · ★ in ${level.par.actions} actions or fewer · ★ in ${level.par.lines} lines or fewer`;
  log.replaceChildren();
  result.hidden = true;
  renderTabs(null);
  selectMap(0);
  updateStars();
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function renderTabs(runs: Run[] | null): void {
  const tabs = $('map-tabs');
  tabs.replaceChildren();
  tabs.hidden = level.maps.length < 2;
  level.maps.forEach((_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === shownMap));
    const state = runs ? (runs[i]?.ok ? ' ✓' : ' ✗') : '';
    b.textContent = `Map ${i + 1}${state}`;
    if (runs) b.classList.add(runs[i]?.ok ? 'ok' : 'bad');
    b.addEventListener('click', () => {
      stopPlayback();
      selectMap(i);
      if (lastRuns) play([i], lastRuns);
    });
    tabs.append(b);
  });
}

function selectMap(i: number): void {
  shownMap = i;
  scene = sceneFor(level.maps[i]);
  // The frame takes the map's shape, within limits, so a long thin map does not float in an empty box.
  const rows = level.maps[i];
  $('map-frame').style.aspectRatio = String(Math.min(3.2, Math.max(1.1, rows[0].length / rows.length)));
  canvas.setAttribute('aria-label', describeMap(level.maps[i]));
  for (const [j, b] of [...$('map-tabs').children].entries()) b.setAttribute('aria-selected', String(j === i));
}

function updateStars(): void {
  const total = Object.values(progress.stars).reduce((s, v) => s + v, 0);
  $('star-total').textContent = `★ ${total} / ${LEVELS.length * 3}`;
  $('star-total').setAttribute('aria-label', `${total} of ${LEVELS.length * 3} stars`);
}

// ── Python ───────────────────────────────────────────────────────────────────────────────────────────────────────

let worker: Worker;
let ready = false;
let pending: { id: number; resolve: (runs: Run[]) => void; reject: (message: string) => void; timer: number } | null = null;
let nextId = 1;

function startWorker(): void {
  ready = false;
  runButton.disabled = true;
  runLabel.textContent = 'Starting Python…';
  worker = new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    if (message.type === 'ready') {
      ready = true;
      runButton.disabled = false;
      runLabel.textContent = 'Run';
    } else if (message.type === 'fatal') {
      runLabel.textContent = 'Python could not start';
      showResult('bad', 'Python could not start in this browser.', `Reload the page to try again. (${message.message})`);
    } else if (pending && message.id === pending.id) {
      clearTimeout(pending.timer);
      const p = pending;
      pending = null;
      if (message.type === 'result') p.resolve(message.runs);
      else p.reject(message.message);
    }
  };
  worker.postMessage({ type: 'init', indexURL: new URL('pyodide/', document.baseURI).href } satisfies ToWorker);
}

// Runs the program on every map. A program stuck outside the rover's functions is stopped after a few seconds by
// replacing the worker.
function execute(code: string): Promise<Run[]> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = window.setTimeout(() => {
      pending = null;
      worker.terminate();
      startWorker();
      reject('Your program ran for too long and was stopped. Is a loop missing a way out?');
    }, 8000);
    pending = { id, resolve, reject, timer };
    worker.postMessage({ type: 'run', id, maps: level.maps, code } satisfies ToWorker);
  });
}

let lastRuns: Run[] | null = null;

async function run(): Promise<void> {
  if (!ready || runButton.disabled) return;
  stopPlayback();
  const code = editor.code();
  runButton.disabled = true;
  runLabel.textContent = 'Running…';
  log.replaceChildren();
  result.hidden = true;
  editor.mark(0, 0);
  try {
    const runs = await execute(code);
    lastRuns = runs;
    renderTabs(runs);
    // Replay the maps in order, stopping at the first one that fails.
    const firstBad = runs.findIndex((r) => !r.ok);
    const order = firstBad < 0 ? runs.map((_, i) => i) : [...runs.keys()].slice(0, firstBad + 1);
    await play(order, runs);
    finish(runs, code);
  } catch (message) {
    showResult('bad', 'The program was stopped.', String(message));
  } finally {
    if (ready) {
      runButton.disabled = false;
      runLabel.textContent = 'Run';
    }
  }
}

function finish(runs: Run[], code: string): void {
  const bad = runs.findIndex((r) => !r.ok);
  if (bad >= 0) {
    const r = runs[bad];
    const where = r.line ? ` (line ${r.line})` : '';
    const map = runs.length > 1 ? `Map ${bad + 1}: ` : '';
    const title = r.kind === 'error' || r.kind === 'syntax' ? 'Python found a problem' : r.kind === 'short' ? 'Not there yet' : 'Mission failed';
    showResult('bad', title, `${map}${r.message}${where}`);
    editor.mark(0, r.line);
    return;
  }
  const actions = runs.reduce((s, r) => s + r.actions, 0);
  const lines = programLines(code);
  const got = stars(level, actions, lines);
  const before = progress.stars[level.id] ?? 0;
  progress.stars[level.id] = Math.max(before, got);
  saveProgress();
  updateStars();
  const parts = [
    `${actions} action${actions === 1 ? '' : 's'} (par ${level.par.actions})${actions <= level.par.actions ? ' ★' : ''}`,
    `${lines} line${lines === 1 ? '' : 's'} (par ${level.par.lines})${lines <= level.par.lines ? ' ★' : ''}`,
  ];
  const next = LEVELS[LEVELS.indexOf(level) + 1];
  showResult('ok', `Landed! ${'★'.repeat(got)}${'☆'.repeat(3 - got)}`, `${runs.length > 1 ? `All ${runs.length} maps. ` : ''}${parts.join(' · ')}.`, next);
}

function showResult(tone: 'ok' | 'bad', title: string, text: string, next?: Level): void {
  result.className = `result ${tone}`;
  result.hidden = false;
  result.replaceChildren();
  const h = document.createElement('p');
  h.className = 'result-title';
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  result.append(h, p);
  if (next) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'primary-btn';
    b.textContent = `Next: ${next.title}`;
    b.addEventListener('click', () => showLevel(next));
    result.append(b);
  } else if (tone === 'ok') {
    const p2 = document.createElement('p');
    p2.textContent = 'That was the last mission. Go back for any stars you missed, or try a shorter program.';
    result.append(p2);
  }
  result.setAttribute('role', tone === 'bad' ? 'alert' : 'status');
}

// ── Replay ───────────────────────────────────────────────────────────────────────────────────────────────────────

const SPEEDS = [520, 300, 160, 70, 25];
let playing: { cancel: () => void; skip: () => void } | null = null;

function stopPlayback(): void {
  playing?.cancel();
  playing = null;
  skipButton.disabled = true;
}

function logLine(text: string, tone: 'print' | 'info' | 'bad' = 'info', line = 0): void {
  const li = document.createElement('li');
  li.className = tone;
  if (line) {
    const span = document.createElement('span');
    span.className = 'log-line';
    span.textContent = `line ${line}`;
    li.append(span);
  }
  li.append(document.createTextNode(text));
  log.append(li);
  log.scrollTop = log.scrollHeight;
}

async function play(order: number[], runs: Run[]): Promise<void> {
  let cancelled = false, skipping = false;
  playing = { cancel: () => (cancelled = true), skip: () => (skipping = true) };
  skipButton.disabled = false;
  for (const index of order) {
    if (cancelled) return;
    selectMap(index);
    if (order.length > 1 || level.maps.length > 1) logLine(`Map ${index + 1}`, 'info');
    const events = runs[index].trace;
    for (const event of events) {
      if (cancelled) return;
      apply(event);
      if (!skipping) {
        const speed = SPEEDS[Number(($('speed') as HTMLInputElement).value) - 1];
        await animate(event, event[0] === 'look' || event[0] === 'print' ? speed * 0.35 : speed, () => cancelled || skipping);
      } else if (event[0] !== 'crash') {
        scene.pose = { x: event[1], y: event[2], angle: angleOf(event[3]) };
      }
    }
    editor.mark(0, 0);
    if (!runs[index].ok) break;
  }
  playing = null;
  skipButton.disabled = true;
}

function apply(event: Event): void {
  const [kind, x, y, , , line, note] = event;
  editor.mark(line);
  if (kind === 'move' || kind === 'crater' || kind === 'crash') {
    if (kind !== 'crash') scene.trail.push([x, y]);
  }
  if (kind === 'pick') {
    scene.picked.add(`${x},${y}`);
    scene.flash = 1;
  }
  if (kind === 'crash' || kind === 'crater' || kind === 'miss') {
    scene.crashed = true;
    scene.flash = 1;
    logLine(note ?? 'Stopped.', 'bad', line);
  }
  if (kind === 'print') logLine(note ?? '', 'print', line);
  if (kind === 'move' && scene.rows[y]?.[x] === 'L' && event[4] === 0) {
    scene.landed = true;
    scene.flash = 1;
  }
}

// Moves the drawn rover towards the event's pose over `ms`, unless stopped.
function animate(event: Event, ms: number, stop: () => boolean): Promise<void> {
  const from = { ...scene.pose };
  const to = { x: event[1], y: event[2], angle: angleOf(event[3]) };
  // Turn the short way round.
  let delta = to.angle - from.angle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  // A crash nudges forward and back.
  const bump = event[0] === 'crash';
  const start = performance.now();
  return new Promise((resolve) => {
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      if (bump) {
        const push = Math.sin(t * Math.PI) * 0.25;
        scene.pose = { x: from.x + Math.cos(from.angle) * push, y: from.y + Math.sin(from.angle) * push, angle: from.angle };
      } else scene.pose = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, angle: from.angle + delta * e };
      if (t >= 1 || stop()) {
        scene.pose = bump ? from : { ...to };
        resolve();
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// ── Drawing ──────────────────────────────────────────────────────────────────────────────────────────────────────

let size = { w: 0, h: 0 };
function resize(): void {
  const frame = $('map-frame').getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  size = { w: frame.width, h: frame.height };
  canvas.width = Math.round(frame.width * dpr);
  canvas.height = Math.round(frame.height * dpr);
  canvas.style.width = `${frame.width}px`;
  canvas.style.height = `${frame.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe($('map-frame'));

function frame(): void {
  if (scene.flash > 0) scene.flash = Math.max(0, scene.flash - 0.03);
  if (size.w) draw(ctx, size.w, size.h, scene, palette);
  requestAnimationFrame(frame);
}

// ── Controls ─────────────────────────────────────────────────────────────────────────────────────────────────────

runButton.addEventListener('click', () => void run());
skipButton.addEventListener('click', () => playing?.skip());
$('reset-code').addEventListener('click', () => {
  if (editor.code() !== level.starter && !window.confirm('Replace your program with the mission’s starting code?')) return;
  editor.setCode(level.starter);
  editor.view.focus();
});

const missionsDialog = $<HTMLDialogElement>('missions-dialog');
const referenceDialog = $<HTMLDialogElement>('reference-dialog');
$('missions-btn').addEventListener('click', () => {
  renderMissionList();
  missionsDialog.showModal();
});
$('missions-close').addEventListener('click', () => missionsDialog.close());
$('reference-btn').addEventListener('click', () => referenceDialog.showModal());
$('reference-close').addEventListener('click', () => referenceDialog.close());
for (const d of [missionsDialog, referenceDialog]) d.addEventListener('click', (e) => e.target === d && d.close());

function renderMissionList(): void {
  const list = $('mission-list');
  list.replaceChildren();
  CHAPTERS.forEach((name, chapter) => {
    const h = document.createElement('h3');
    h.textContent = `${chapter + 1}. ${name}`;
    const ol = document.createElement('ol');
    ol.className = 'missions';
    for (const l of LEVELS.filter((x) => x.chapter === chapter)) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const got = progress.stars[l.id] ?? 0;
      b.innerHTML = `<span>${LEVELS.indexOf(l) + 1}. ${escapeHtml(l.title)}</span><span class="mission-stars" aria-label="${got} of 3 stars">${'★'.repeat(got)}${'☆'.repeat(3 - got)}</span>`;
      if (l === level) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => {
        missionsDialog.close();
        showLevel(l);
      });
      li.append(b);
      ol.append(li);
    }
    list.append(h, ol);
  });
}

const THEME_KEY = 'rover-code:theme';
function themeButton(): void {
  const dark = isDark();
  const b = $('theme-btn');
  b.textContent = dark ? '☀' : '☾';
  b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}
function isDark(): boolean {
  const set = document.documentElement.getAttribute('data-theme');
  return set ? set === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
}
$('theme-btn').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
  palette = readPalette(document.documentElement);
  themeButton();
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  palette = readPalette(document.documentElement);
  themeButton();
});

themeButton();
showLevel(level);
startWorker();
requestAnimationFrame(frame);
