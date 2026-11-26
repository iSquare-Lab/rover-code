// Draws a map and the rover on a canvas. Colours come from CSS variables, so both themes match the page.
export type Palette = { ground: string; groundDot: string; rock: string; rockEdge: string; crater: string; craterRim: string; sample: string; lander: string; landerLit: string; rover: string; roverDark: string; trail: string; danger: string };

export function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const v = (n: string) => css.getPropertyValue(n).trim();
  return {
    ground: v('--map-ground'),
    groundDot: v('--map-dot'),
    rock: v('--map-rock'),
    rockEdge: v('--map-rock-edge'),
    crater: v('--map-crater'),
    craterRim: v('--map-crater-rim'),
    sample: v('--map-sample'),
    lander: v('--map-lander'),
    landerLit: v('--accent'),
    rover: v('--map-rover'),
    roverDark: v('--map-rover-dark'),
    trail: v('--map-trail'),
    danger: v('--danger'),
  };
}

export type Pose = { x: number; y: number; angle: number };

export type Scene = {
  rows: string[];
  // Samples already picked up, as "x,y".
  picked: Set<string>;
  pose: Pose;
  trail: [number, number][];
  crashed: boolean;
  // 0..1: a short flash when something happens (pick, crash, landing).
  flash: number;
  landed: boolean;
};

const ANGLE: Record<string, number> = { N: -Math.PI / 2, E: 0, S: Math.PI / 2, W: Math.PI };
export const angleOf = (facing: string) => ANGLE[facing] ?? 0;

// A stable pseudo-random number per cell, for the texture of rocks and craters.
function noise(x: number, y: number, k: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

export function draw(ctx: CanvasRenderingContext2D, width: number, height: number, scene: Scene, p: Palette): void {
  const cols = scene.rows[0].length, rows = scene.rows.length;
  const cell = Math.min(width / cols, height / rows);
  const ox = (width - cell * cols) / 2, oy = (height - cell * rows) / 2;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = p.ground;
  ctx.fillRect(ox, oy, cell * cols, cell * rows);
  const cx = (x: number) => ox + (x + 0.5) * cell, cy = (y: number) => oy + (y + 0.5) * cell;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = scene.rows[y][x];
      if (ch === '#') {
        // A rock: an irregular boulder filling most of the cell.
        ctx.fillStyle = p.rock;
        ctx.strokeStyle = p.rockEdge;
        ctx.lineWidth = Math.max(1, cell * 0.04);
        ctx.beginPath();
        const points = 7;
        for (let i = 0; i <= points; i++) {
          const a = (i / points) * Math.PI * 2;
          const r = cell * (0.42 + 0.08 * noise(x, y, i % points));
          const px = cx(x) + Math.cos(a) * r, py = cy(y) + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.fill();
        ctx.stroke();
        continue;
      }
      // Faint dots on open ground, so squares are easy to count.
      ctx.fillStyle = p.groundDot;
      ctx.beginPath();
      ctx.arc(cx(x), cy(y), Math.max(1, cell * 0.035), 0, Math.PI * 2);
      ctx.fill();
      if (ch === 'o') {
        ctx.fillStyle = p.craterRim;
        ctx.beginPath();
        ctx.ellipse(cx(x), cy(y), cell * 0.4, cell * 0.36, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.crater;
        ctx.beginPath();
        ctx.ellipse(cx(x), cy(y) + cell * 0.03, cell * 0.3, cell * 0.26, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (ch === '*' && !scene.picked.has(`${x},${y}`)) {
        // A sample: a small crystal.
        const s = cell * 0.2;
        ctx.fillStyle = p.sample;
        ctx.beginPath();
        ctx.moveTo(cx(x), cy(y) - s * 1.3);
        ctx.lineTo(cx(x) + s, cy(y));
        ctx.lineTo(cx(x), cy(y) + s * 1.3);
        ctx.lineTo(cx(x) - s, cy(y));
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgb(255 255 255 / 0.45)';
        ctx.beginPath();
        ctx.moveTo(cx(x), cy(y) - s * 1.3);
        ctx.lineTo(cx(x) + s * 0.45, cy(y) - s * 0.2);
        ctx.lineTo(cx(x), cy(y));
        ctx.closePath();
        ctx.fill();
      } else if (ch === 'L') {
        // The lander: a pad with legs and a light that turns on when the rover is home.
        const s = cell * 0.36;
        ctx.strokeStyle = p.lander;
        ctx.lineWidth = Math.max(1.5, cell * 0.06);
        ctx.beginPath();
        ctx.arc(cx(x), cy(y), s, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx(x) - s * 0.5, cy(y));
        ctx.lineTo(cx(x) + s * 0.5, cy(y));
        ctx.moveTo(cx(x), cy(y) - s * 0.5);
        ctx.lineTo(cx(x), cy(y) + s * 0.5);
        ctx.stroke();
        ctx.fillStyle = scene.landed ? p.landerLit : p.lander;
        ctx.beginPath();
        ctx.arc(cx(x), cy(y), s * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // The tracks the rover left.
  if (scene.trail.length > 1) {
    ctx.strokeStyle = p.trail;
    ctx.lineWidth = Math.max(1.5, cell * 0.08);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    scene.trail.forEach(([tx, ty], i) => (i ? ctx.lineTo(cx(tx), cy(ty)) : ctx.moveTo(cx(tx), cy(ty))));
    ctx.stroke();
  }

  // The rover: a body, six wheels and a mast pointing the way it faces.
  const { pose } = scene;
  ctx.save();
  ctx.translate(cx(pose.x), cy(pose.y));
  ctx.rotate(pose.angle);
  const r = cell * 0.3;
  ctx.fillStyle = p.roverDark;
  for (const wx of [-0.7, 0, 0.7]) {
    for (const wy of [-1, 1]) {
      ctx.beginPath();
      ctx.roundRect(r * wx - r * 0.22, r * wy * 0.82 - r * 0.16, r * 0.44, r * 0.32, r * 0.08);
      ctx.fill();
    }
  }
  ctx.fillStyle = scene.crashed ? p.danger : p.rover;
  ctx.beginPath();
  ctx.roundRect(-r * 0.95, -r * 0.62, r * 1.9, r * 1.24, r * 0.3);
  ctx.fill();
  ctx.fillStyle = p.roverDark;
  ctx.beginPath();
  ctx.moveTo(r * 1.05, 0);
  ctx.lineTo(r * 0.45, -r * 0.42);
  ctx.lineTo(r * 0.45, r * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-r * 0.25, 0, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (scene.flash > 0) {
    ctx.strokeStyle = scene.crashed ? p.danger : p.landerLit;
    ctx.globalAlpha = scene.flash;
    ctx.lineWidth = Math.max(2, cell * 0.08);
    ctx.beginPath();
    ctx.arc(cx(pose.x), cy(pose.y), cell * (0.5 + (1 - scene.flash) * 0.4), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
