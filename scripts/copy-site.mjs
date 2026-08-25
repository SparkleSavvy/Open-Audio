import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const src = join(root, 'site');
const dest = join(root, 'dist', 'site');

if (!existsSync(src)) {
  console.error('copy-site: source folder "site/" not found');
  process.exit(1);
}

cpSync(src, dest, { recursive: true });

let count = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else count++;
  }
})(dest);

console.log(`copy-site: ${count} files -> dist/site`);
