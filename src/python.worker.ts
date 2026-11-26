// Python runs here, off the page's main thread, so the page stays responsive and a stuck program can be stopped by
// ending this worker. Pyodide comes from this App's own pyodide/ folder (see vite.config.ts).
import type { PyodideAPI } from 'pyodide';
import roverSource from './rover.py?raw';
import type { FromWorker, ToWorker } from './protocol.ts';

let python: Promise<PyodideAPI> | null = null;

const post = (message: FromWorker) => (self as unknown as Worker).postMessage(message);

async function start(indexURL: string): Promise<PyodideAPI> {
  const { loadPyodide } = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as typeof import('pyodide');
  // packageBaseUrl set explicitly: without it Pyodide would fall back to its CDN (jsDelivr) for packages.
  const pyodide = await loadPyodide({ indexURL, packageBaseUrl: indexURL, stdout: () => {}, stderr: () => {} });
  pyodide.runPython(roverSource);
  post({ type: 'ready' });
  return pyodide;
}

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === 'init') {
    python = start(message.indexURL);
    python.catch((error: unknown) => post({ type: 'fatal', message: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (!python) return;
  let pyodide: PyodideAPI;
  try {
    pyodide = await python;
  } catch {
    return;
  }
  const run = pyodide.globals.get('run_level');
  try {
    post({ type: 'result', id: message.id, runs: JSON.parse(run(JSON.stringify(message.maps), message.code)) });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    post({ type: 'failed', id: message.id, message: text.trim().split('\n').pop() ?? text });
  } finally {
    run.destroy();
  }
};
