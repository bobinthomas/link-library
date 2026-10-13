import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

await mkdir('.test-build', { recursive: true });
await build({ entryPoints: ['tests/collection.test.ts'], outfile: '.test-build/collection.test.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const result = spawnSync(process.execPath, ['--test', '.test-build/collection.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
