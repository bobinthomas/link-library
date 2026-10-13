import { build } from 'esbuild';

await build({
  entryPoints: ['src/background/index.ts'],
  outfile: 'dist/background.js',
  bundle: true,
  format: 'esm',
  target: 'chrome120',
});
