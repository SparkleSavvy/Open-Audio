import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const root = path.resolve(__dirname, '..');

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lineRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = lineRe.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const first = value[0];
    const last = value[value.length - 1];
    if (value.length >= 2 && first === last && (first === '"' || first === "'")) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

export function renderEnv(vars: Record<string, string>): string {
  return (
    Object.entries(vars)
      .map(([k, v]) => (v.includes(' ') || /[^\w./:@-]/.test(v) ? `${k}="${v}"` : `${k}=${v}`))
      .join('\n') + '\n'
  );
}

export function envPath(): string {
  return path.join(root, '.env');
}

export function readEnv(): Record<string, string> {
  const example = fs.existsSync(path.join(root, '.env.example'))
    ? parseEnv(fs.readFileSync(path.join(root, '.env.example'), 'utf8'))
    : {};
  if (!fs.existsSync(envPath())) return { ...example };
  return { ...example, ...parseEnv(fs.readFileSync(envPath(), 'utf8')) };
}

export function writeEnv(vars: Record<string, string>) {
  fs.writeFileSync(envPath(), renderEnv(vars), 'utf8');
}

export function randomPassword(len = 16): string {
  return crypto.randomBytes(len).toString('base64url').slice(0, len);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}
