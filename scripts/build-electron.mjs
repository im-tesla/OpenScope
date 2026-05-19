import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const opts = {
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  outdir: 'dist-electron',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  bundle: true,
  external: ['electron', 'serialport'],
  sourcemap: true,
};

if (isWatch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log('watching electron/...');
} else {
  await esbuild.build(opts);
  console.log('electron build done');
}
