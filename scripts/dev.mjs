import { spawn } from 'child_process';
import { createServer } from 'vite';

const vite = await createServer({ server: { port: 5173 } });
await vite.listen();

console.log('vite dev server on http://localhost:5173');

const electronBuild = spawn('node', ['scripts/build-electron.mjs', '--watch'], {
  stdio: 'inherit',
  shell: true,
});

await new Promise(r => setTimeout(r, 2000));

const electron = spawn('electron', ['.'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NODE_ENV: 'development' },
});

electron.on('exit', () => {
  electronBuild.kill();
  vite.close();
  process.exit();
});
