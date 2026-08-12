import 'dotenv/config';

function numberOr(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === '1' || value?.toLowerCase() === 'true') return true;
  if (value === '0' || value?.toLowerCase() === 'false') return false;
  return fallback;
}

const isProduction = process.env.NODE_ENV === 'production';
const port = numberOr(process.env.PORT, 4000);
const jwtSecret = process.env.JWT_SECRET || 'insecure-dev-secret-change-me';

// Fail fast in production: a weak or default JWT_SECRET would let anyone
// forge tokens, including admin tokens. Generate one with `npm run admin secret`.
if (isProduction && (jwtSecret === 'insecure-dev-secret-change-me' || jwtSecret.length < 16)) {
  throw new Error(
    'JWT_SECRET is missing or too short. Run `npm run admin secret` to generate one before starting in production.',
  );
}

export const config = {
  port,
  databasePath: process.env.DATABASE_PATH || './data/open-audio.db',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  jwtSecret,
  removalKey: process.env.REMOVAL_KEY || '',
  appUrl: process.env.APP_URL || `http://localhost:${port}`,
  isProduction,
  cookieSecure: bool(process.env.COOKIE_SECURE, isProduction),
  // Default ON in production (behind a real reverse proxy the XFF header is
  // overwritten by the LB); must be explicitly enabled in dev. Otherwise
  // per-IP rate limits collapse into one global bucket behind the proxy.
  trustProxy: bool(process.env.TRUST_PROXY, isProduction),
  enableCsp: bool(process.env.HELMET_CSP, isProduction),
  rateLimit: {
    windowMs: numberOr(process.env.RATE_LIMIT_WINDOW, 15 * 60 * 1000),
    apiMax: numberOr(process.env.RATE_LIMIT_API_MAX, 300),
    authMax: numberOr(process.env.RATE_LIMIT_AUTH_MAX, 20),
  },
  ytdlpPath: process.env.YTDLP_PATH || 'yt-dlp',
  ytdlpTimeoutMs: numberOr(process.env.YTDLP_TIMEOUT_S, 180) * 1000,
  studioImportMaxBytes: 60 * 1024 * 1024,
};
