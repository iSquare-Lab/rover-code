// Saved progress, kept in this browser only: the mission on screen, each mission's program and its best stars.
// Stored data can be old, edited by hand or broken, so everything read back is checked and anything unknown is
// dropped.

export type Progress = { current: string; code: Record<string, string>; stars: Record<string, number> };

export const PROGRESS_KEY = 'rover-code:progress';
export const MAX_STARS = 3;

export function emptyProgress(firstId: string): Progress {
  return { current: firstId, code: {}, stars: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// `ids` are the missions that exist; the first is where a new player starts.
export function parseProgress(raw: string | null, ids: readonly string[]): Progress {
  const progress = emptyProgress(ids[0]);
  let saved: unknown;
  try {
    saved = JSON.parse(raw ?? 'null');
  } catch {
    return progress;
  }
  if (!isRecord(saved)) return progress;
  const known = new Set(ids);
  if (typeof saved.current === 'string' && known.has(saved.current)) progress.current = saved.current;
  if (isRecord(saved.code)) {
    for (const [id, code] of Object.entries(saved.code)) if (known.has(id) && typeof code === 'string') progress.code[id] = code;
  }
  if (isRecord(saved.stars)) {
    for (const [id, count] of Object.entries(saved.stars)) {
      if (known.has(id) && Number.isInteger(count) && (count as number) >= 0 && (count as number) <= MAX_STARS) progress.stars[id] = count as number;
    }
  }
  return progress;
}

export function totalStars(progress: Progress): number {
  return Object.values(progress.stars).reduce((sum, count) => sum + count, 0);
}
