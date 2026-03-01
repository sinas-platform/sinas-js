import { defineConfig } from 'tsup';

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
    external: ['react'],
    sourcemap: true,
  },
]);
