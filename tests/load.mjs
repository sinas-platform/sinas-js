// Loads a TypeScript module for node:test: bundled with esbuild (React and
// everything else included, so a harness shares one React instance) and
// imported from memory.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export async function load(relPath) {
  const entry = fileURLToPath(new URL(relPath, import.meta.url));
  const { outputFiles } = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"test"' },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}
