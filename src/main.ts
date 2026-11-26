import '@fontsource-variable/sora';
import '@fontsource-variable/jetbrains-mono';
import './style.css';
import { createEditor } from './editor.ts';
import { CHAPTERS, LEVELS, programLines, stars, type Level } from './levels.ts';
import { MAX_STARS, parseProgress, PROGRESS_KEY, totalStars } from './progress.ts';
import type { Event, FromWorker, Run, ToWorker } from './protocol.ts';
import { angleOf, draw, readPalette, type Palette, type Scene } from './render.ts';

// A program still running after this long is stuck outside the rover's functions (for example `while True: pass`
// after the line limit was caught), so its worker is replaced.
const RUN_TIMEOUT_MS = 8000;
// Typing is saved this long after the last key, and at once when the page is hidden or closed.
const SAVE_DELAY_MS = 300;
// How much a pick, crash or landing flash fades each frame (it starts at 1).
const FLASH_FADE = 0.03;
// Replay speed: milliseconds per rover action for each step of the speed slider, slowest first.
const SPEEDS = [520, 300, 160, 70, 25];
// Looking around and printing take this share of an action's time in the replay.
const LOOK_SHARE = 0.35;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ── Saved progress (this browser only) ───────────────────────────────────────────────────────────────────────────

function readStorage(): string | null {
  try {
    return localStorage.getItem(PROGRESS_KEY);
  } catch {
    return null;
  }
}
const progress = parseProgress(
  readStorage(),
  LEVELS.map((l) => l.id),
);
let saveTimer = 0;
function writeProgress(): void {
  clearTimeout(saveTimer);
  saveTimer = 0;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* storage full or off: progress is not kept */
  }
}
function saveProgress(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(writeProgress, SAVE_DELAY_MS);
}
function flushProgress(): void {
  if (saveTimer) writeProgress();
}
window.addEventListener('pagehide', flushProgress);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushProgress());

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
    // Only the player's own programs are kept, so a mission they never changed gets an improved starter later.
    if (code === level.starter) delete progress.code[level.id];
    else progress.code[level.id] = code;
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
  lastRuns = null;
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
  hideResult();
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
    b.setAttribute('aria-pressed', String(i === shownMap));
    b.textContent = `Map ${i + 1}`;
    if (runs) {
      const ok = runs[i]?.ok;
      b.classList.add(ok ? 'ok' : 'bad');
      b.append(glyphs(ok ? ' ✓' : ' ✗', ok ? ', landed' : ', failed'));
    }
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
  for (const [j, b] of [...$('map-tabs').children].entries()) b.setAttribute('aria-pressed', String(j === i));
}

// Symbols for the eye, words for screen readers: `shown` is hidden from assistive tech and `spoken` is read instead.
function glyphs(shown: string, spoken: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const visible = document.createElement('span');
  visible.setAttribute('aria-hidden', 'true');
  visible.textContent = shown;
  const hidden = document.createElement('span');
  hidden.className = 'visually-hidden';
  hidden.textContent = spoken;
  fragment.append(visible, hidden);
  return fragment;
}

function starText(got: number): string {
  return '★'.repeat(got) + '☆'.repeat(MAX_STARS - got);
}

function updateStars(): void {
  const total = totalStars(progress);
  const max = LEVELS.length * MAX_STARS;
  $('star-total').replaceChildren(glyphs(`★ ${total} / ${max}`, `${total} of ${max} stars`));
}

// ── Python ───────────────────────────────────────────────────────────────────────────────────────────────────────

let worker: Worker;
let ready = false;
let pending: { id: number; resolve: (runs: Run[]) => void; reject: (message: string) => void; timer: number } | null = null;
let nextId = 1;

function startWorker(): void {
  ready = false;
  runButton.disabled = true;
  runButton.setAttribute('aria-busy', 'true');
  runLabel.textContent = 'Starting Python…';
  worker = new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' });
  const failed = (detail: string) => {
    ready = false;
    runButton.disabled = true;
    runButton.removeAttribute('aria-busy');
    runLabel.textContent = 'Python could not start';
    showResult('bad', 'Python could not start in this browser.', `Reload the page to try again. (${detail})`);
  };
  worker.addEventListener('error', (event) => {
    event.preventDefault();
    failed(event.message || 'The Python worker did not load.');
  });
  worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    if (message.type === 'ready') {
      ready = true;
      runButton.disabled = false;
      runButton.removeAttribute('aria-busy');
      runLabel.textContent = 'Run';
    } else if (message.type === 'fatal') {
      failed(message.message);
    } else if (pending && message.id === pending.id) {
      clearTimeout(pending.timer);
      const p = pending;
      pending = null;
      if (message.type === 'result') p.resolve(message.runs);
      else p.reject(message.message);
    }
  });
  worker.postMessage({ type: 'init', indexURL: new URL('pyodide/', document.baseURI).href } satisfies ToWorker);
}

// Runs the program on every map. A program stuck outside the rover's functions is stopped after RUN_TIMEOUT_MS by
// replacing the worker.
function execute(maps: string[][], code: string): Promise<Run[]> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = window.setTimeout(() => {
      pending = null;
      worker.terminate();
      startWorker();
      reject('Your program ran for too long and was stopped. Is a loop missing a way out?');
    }, RUN_TIMEOUT_MS);
    pending = { id, resolve, reject, timer };
    worker.postMessage({ type: 'run', id, maps, code } satisfies ToWorker);
  });
}

let lastRuns: Run[] | null = null;

async function run(): Promise<void> {
  if (!ready || runButton.disabled) return;
  stopPlayback();
  // The player may open another mission while this one runs; its results then belong to nothing on screen.
  const runLevel = level;
  const code = editor.code();
  runButton.disabled = true;
  runLabel.textContent = 'Running…';
  log.replaceChildren();
  hideResult();
  editor.mark(0, 0);
  try {
    const runs = await execute(runLevel.maps, code);
    if (level !== runLevel) return;
    lastRuns = runs;
    renderTabs(runs);
    showMap();
    // Replay the maps in order, stopping at the first one that fails.
    const firstBad = runs.findIndex((r) => !r.ok);
    const order = firstBad < 0 ? runs.map((_, i) => i) : [...runs.keys()].slice(0, firstBad + 1);
    await play(order, runs);
    if (level !== runLevel) return;
    finish(runs, code);
  } catch (message) {
    if (level === runLevel) showResult('bad', 'The program was stopped.', String(message));
  } finally {
    if (ready) {
      runButton.disabled = false;
      runLabel.textContent = 'Run';
    }
  }
}

// On a narrow screen the map sits above the editor, out of sight while the player types: bring it into view for the
// replay.
function showMap(): void {
  const card = $('map-frame').getBoundingClientRect();
  if (card.top >= 0 && card.bottom <= window.innerHeight) return;
  $('map-frame').scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
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
  showResult('ok', `Landed! ${starText(got)}`, `${runs.length > 1 ? `All ${runs.length} maps. ` : ''}${parts.join(' · ')}.`, next, `Landed with ${got} of ${MAX_STARS} stars.`);
}

// The result box is for the eye; the permanent live region next to it tells screen readers what happened.
const announcer = $('announce');

function hideResult(): void {
  result.hidden = true;
  announcer.textContent = '';
}

function showResult(tone: 'ok' | 'bad', title: string, text: string, next?: Level, spokenTitle = title): void {
  result.className = `result ${tone}`;
  result.hidden = false;
  result.replaceChildren();
  const h = document.createElement('p');
  h.className = 'result-title';
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  result.append(h, p);
  announcer.textContent = `${spokenTitle} ${text}`;
  if (next) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'primary-btn';
    b.textContent = `Next: ${next.title}`;
    b.addEventListener('click', () => {
      showLevel(next);
      // The button is gone with the old result, so focus moves to the new mission's title.
      $('mission-title').focus();
    });
    result.append(b);
  } else if (tone === 'ok') {
    const p2 = document.createElement('p');
    p2.textContent = 'That was the last mission. Go back for any stars you missed, or try a shorter program.';
    result.append(p2);
  }
}

// ── Replay ───────────────────────────────────────────────────────────────────────────────────────────────────────

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
        await animate(event, event[0] === 'look' || event[0] === 'print' ? speed * LOOK_SHARE : speed, () => cancelled || skipping);
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
  if (kind === 'move' || kind === 'crater') scene.trail.push([x, y]);
  if (kind === 'pick') {
    scene.picked.add(`${x},${y}`);
    flash();
  }
  if (kind === 'crash' || kind === 'crater' || kind === 'miss') {
    scene.crashed = true;
    flash();
    logLine(note ?? 'Stopped.', 'bad', line);
  }
  if (kind === 'print') logLine(note ?? '', 'print', line);
  if (kind === 'move' && scene.rows[y]?.[x] === 'L' && event[4] === 0) {
    scene.landed = true;
    flash();
  }
}

// A short ring round the rover when something happens, left out for players who ask for reduced motion.
function flash(): void {
  if (!reducedMotion.matches) scene.flash = 1;
}

// Moves the drawn rover towards the event's pose over `ms`, unless stopped. With reduced motion the rover jumps to
// the new pose and waits there instead.
function animate(event: Event, ms: number, stop: () => boolean): Promise<void> {
  if (reducedMotion.matches) {
    if (event[0] !== 'crash') scene.pose = { x: event[1], y: event[2], angle: angleOf(event[3]) };
    return new Promise((resolve) => {
      const start = performance.now();
      const wait = (now: number) => (now - start >= ms || stop() ? resolve() : requestAnimationFrame(wait));
      requestAnimationFrame(wait);
    });
  }
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
  const box = $('map-frame').getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  size = { w: box.width, h: box.height };
  canvas.width = Math.round(box.width * dpr);
  canvas.height = Math.round(box.height * dpr);
  canvas.style.width = `${box.width}px`;
  canvas.style.height = `${box.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe($('map-frame'));

function frame(): void {
  if (scene.flash > 0) scene.flash = Math.max(0, scene.flash - FLASH_FADE);
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
      b.innerHTML = `<span>${LEVELS.indexOf(l) + 1}. ${escapeHtml(l.title)}</span><span class="mission-stars"><span aria-hidden="true">${starText(got)}</span><span class="visually-hidden">, ${got} of ${MAX_STARS} stars</span></span>`;
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
