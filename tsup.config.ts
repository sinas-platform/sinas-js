import { defineConfig } from 'tsup';
import type { Plugin } from 'esbuild';

/**
 * esbuild plugin that replaces imports with references to browser globals.
 * Needed for IIFE builds where `external` alone doesn't work —
 * esbuild would still bundle the dependency.
 */
function externalGlobalPlugin(globals: Record<string, string>): Plugin {
  return {
    name: 'external-global',
    setup(build) {
      for (const pkg of Object.keys(globals)) {
        const filter = new RegExp(`^${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
        build.onResolve({ filter }, () => ({
          path: pkg,
          namespace: 'external-global',
        }));
      }
      build.onLoad({ filter: /.*/, namespace: 'external-global' }, (args) => ({
        contents: `module.exports = globalThis["${globals[args.path]}"]`,
        loader: 'js',
      }));
    },
  };
}

export default defineConfig([
  // npm (ESM + CJS + types)
  {
    entry: {
      index: 'src/index.ts',
      client: 'src/client/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    external: ['react'],
    clean: true,
    sourcemap: true,
  },
  // iframe runtime (IIFE → window.SinasSDK)
  {
    entry: { 'sinas-sdk.umd': 'src/index.ts' },
    format: ['iife'],
    globalName: 'SinasSDK',
    outExtension: () => ({ js: '.js' }),
    esbuildPlugins: [
      externalGlobalPlugin({ 'react': 'React' }),
    ],
    sourcemap: true,
  },
]);
