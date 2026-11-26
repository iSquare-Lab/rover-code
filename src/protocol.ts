// Messages between the page and the Python worker.
export type ToWorker = { type: 'init'; indexURL: string } | { type: 'run'; id: number; maps: string[][]; code: string };

// One rover event: kind, x, y, facing, samples left, line of code, note.
export type Event = [string, number, number, string, number, number, string | null];

export type Run = {
  ok: boolean;
  message: string;
  line: number;
  kind: 'done' | 'short' | 'stop' | 'error' | 'syntax';
  actions: number;
  trace: Event[];
  output: [number, string][];
};

export type FromWorker =
  | { type: 'ready' }
  | { type: 'fatal'; message: string }
  | { type: 'result'; id: number; runs: Run[] }
  | { type: 'failed'; id: number; message: string };
