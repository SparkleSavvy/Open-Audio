// Container entrypoint for Sparkle Audio.
//
// 1. Runs `npm run setup` non-interactively. In a container, all configuration
//    (JWT_SECRET, REMOVAL_KEY, owner credentials, paths) is expected to come
//    from the environment — setup.ts picks those up and only mints secrets when
//    they are absent. The owner account is created/updated idempotently.
// 2. Starts the server (`npm start` → tsx server/index.ts) and forwards
//    SIGTERM/SIGINT so the process shuts down gracefully (closes the DB).

import { spawn } from 'node:child_process';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`process killed by ${signal}`));
      else resolve(code ?? 0);
    });
  });
}

async function main() {
  console.log('[entrypoint] running setup…');
  const setupCode = await run('npm', ['run', 'setup']);
  if (setupCode !== 0) {
    console.error(`[entrypoint] setup failed with code ${setupCode}`);
    process.exit(setupCode);
  }

  console.log('[entrypoint] starting server…');
  const server = spawn('npm', ['start'], { stdio: 'inherit', env: process.env });

  const forward = (sig) => {
    if (server.exitCode === null) server.kill(sig);
  };
  process.on('SIGTERM', () => forward('SIGTERM'));
  process.on('SIGINT', () => forward('SIGINT'));

  server.on('exit', (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[entrypoint]', err);
  process.exit(1);
});
