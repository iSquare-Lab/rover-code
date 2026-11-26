import { createReadStream } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Pyodide is served from this App's own files, never from a CDN: the npm package's runtime goes to pyodide/ next to
// index.html. Rover Code needs only Python itself, no extra packages.
const CORE = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
const coreDir = resolve('node_modules/pyodide');

function pyodideFiles(): Plugin {
  let outDir = 'dist';
  return {
    name: 'rover-pyodide-files',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/pyodide/', (request, response, next) => {
        const file = (request.url ?? '').split('?')[0].replace(/^\//, '');
        if (!CORE.includes(file)) return next();
        const type = file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : 'application/octet-stream';
        response.setHeader('content-type', type);
        createReadStream(join(coreDir, file)).pipe(response);
      });
    },
    async writeBundle() {
      const target = join(outDir, 'pyodide');
      await mkdir(target, { recursive: true });
      for (const file of CORE) await copyFile(join(coreDir, file), join(target, file));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [pyodideFiles()],
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
