import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { Response } from 'express';
import {
  assertAudioSignature,
  assertImageSignature,
  bruteForceGuard,
  clearLoginFailures,
  csrfGuard,
  isSafeExternalUrl,
  rateLimit,
  registerLoginFailure,
  resolveInside,
  sniffAudio,
  sniffImage,
} from './security';

type MockReq = Parameters<typeof csrfGuard>[0];
type MockRes = Response & { headers: Record<string, string> };

function bytes(...b: number[]): Buffer {
  return Buffer.from(b);
}

function req(method: string, headers: Record<string, string | undefined> = {}, hostname = 'example.com') {
  return { method, headers, hostname } as unknown as MockReq;
}

function res(): MockRes {
  const r = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    status(code: number) {
      r.statusCode = code;
      return r;
    },
    json() {
      return r;
    },
    setHeader(k: string, v: string) {
      r.headers[k] = v;
      return r;
    },
  };
  return r as unknown as MockRes;
}

// ---------------------------------------------------------------------------
// Magic-byte sniffing
// ---------------------------------------------------------------------------

test('sniffAudio recognizes supported containers', () => {
  assert.equal(sniffAudio(bytes(0x49, 0x44, 0x33, 0x04)), 'mp3'); // "ID3"
  assert.equal(sniffAudio(bytes(0x66, 0x4c, 0x61, 0x43)), 'flac'); // "fLaC"
  assert.equal(sniffAudio(bytes(0x4f, 0x67, 0x67, 0x53)), 'ogg'); // "OggS"
  assert.equal(sniffAudio(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45)), 'wav'); // "RIFF...WAVE"
  assert.equal(sniffAudio(bytes(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70)), 'm4a'); // "ftyp"
  assert.equal(sniffAudio(bytes(0xff, 0xfb, 0x90, 0x00)), 'mp3'); // MPEG sync
  assert.equal(sniffAudio(bytes(0xff, 0xf1, 0x50, 0x80)), 'aac'); // ADTS sync
  assert.equal(sniffAudio(bytes(0x1a, 0x45, 0xdf, 0xa3)), 'webm'); // EBML
});

test('sniffAudio rejects non-audio content', () => {
  assert.equal(sniffAudio(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(sniffAudio(Buffer.from('GIF89a')), null);
  assert.equal(sniffAudio(Buffer.from('')), null);
  assert.equal(sniffAudio(bytes(0x50, 0x4b, 0x03, 0x04)), null); // zip
});

test('assertAudioSignature gates on sniff result', () => {
  assert.equal(assertAudioSignature(Buffer.from('ID3xxxx')), true);
  assert.equal(assertAudioSignature(Buffer.from('<!DOCTYPE html>')), false);
});

test('sniffImage recognizes jpeg/png/webp/gif', () => {
  assert.equal(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
  assert.equal(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png');
  assert.equal(sniffImage(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)), 'image/webp');
  assert.equal(sniffImage(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), 'image/gif');
  assert.equal(sniffImage(Buffer.from('PNG')), null);
});

test('assertImageSignature requires image mime and real image bytes', () => {
  const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  assert.equal(assertImageSignature(png, 'image/png'), true);
  assert.equal(assertImageSignature(png, 'image/jpeg'), true); // any image/* mime is fine if bytes are a real image
  assert.equal(assertImageSignature(png, 'application/octet-stream'), false);
  assert.equal(assertImageSignature(Buffer.from('not an image'), 'image/png'), false);
});

// ---------------------------------------------------------------------------
// Path containment
// ---------------------------------------------------------------------------

test('resolveInside stays within the root', () => {
  const root = path.resolve('/data/uploads');
  assert.equal(resolveInside(root, 'audio/abc.mp3'), path.resolve(root, 'audio/abc.mp3'));
  assert.equal(resolveInside(root, './audio/abc.mp3'), path.resolve(root, 'audio/abc.mp3'));
});

test('resolveInside rejects traversal', () => {
  const root = path.resolve('/data/uploads');
  assert.equal(resolveInside(root, '../secrets.env'), null);
  assert.equal(resolveInside(root, 'a/../../etc/passwd'), null);
  assert.equal(resolveInside(root, '..'), null);
  assert.equal(resolveInside(root, '.'), null);
  assert.equal(resolveInside(root, '/etc/passwd'), null);
});

test('resolveInside rejects prefix-escape attempts', () => {
  // /data/uploads-evil must not pass just because it starts with /data/uploads
  const root = path.resolve('/data/uploads');
  assert.equal(resolveInside(root, '../uploads-evil/x'), null);
});

// ---------------------------------------------------------------------------
// CSRF guard
// ---------------------------------------------------------------------------

test('csrfGuard passes safe methods without checking origin', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    let nextCalled = false;
    csrfGuard(req(method, { origin: 'https://evil.com' }), res(), () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true, `${method} should pass`);
  }
});

test('csrfGuard passes when origin matches host', () => {
  let called = false;
  csrfGuard(req('POST', { origin: 'https://example.com' }, 'example.com'), res(), () => {
    called = true;
  });
  assert.equal(called, true);
});

test('csrfGuard rejects cross-origin state-changing requests', () => {
  const r = res();
  let called = false;
  csrfGuard(req('POST', { origin: 'https://evil.com' }, 'example.com'), r, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(r.statusCode, 403);
});

test('csrfGuard rejects malformed origins', () => {
  const r = res();
  csrfGuard(req('POST', { origin: 'not a url' }, 'example.com'), r, () => {});
  assert.equal(r.statusCode, 403);
});

test('csrfGuard passes request with no origin header (CLI/curl)', () => {
  let called = false;
  csrfGuard(req('POST', {}), res(), () => {
    called = true;
  });
  assert.equal(called, true);
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

test('rateLimit allows requests under the limit', () => {
  const limiter = rateLimit({ max: 2, keyFn: () => 'k1' });
  let count = 0;
  for (let i = 0; i < 2; i++) {
    limiter(req('GET'), res(), () => count++);
  }
  assert.equal(count, 2);
});

test('rateLimit blocks over the limit with Retry-After', () => {
  const limiter = rateLimit({ max: 1, windowMs: 60_000, keyFn: () => 'k2' });
  const r = res();
  limiter(req('GET'), res(), () => {});
  limiter(req('GET'), r, () => {});
  assert.equal(r.statusCode, 429);
  assert.ok(Number(r.headers['Retry-After']) >= 1);
});

test('rateLimit buckets are per-key', () => {
  const limiter = rateLimit({ max: 1, keyFn: (q) => String((q as any).id) });
  let a = 0;
  let b = 0;
  limiter({ ...req('GET'), id: 'a' } as unknown as MockReq, res(), () => a++);
  limiter({ ...req('GET'), id: 'b' } as unknown as MockReq, res(), () => b++);
  assert.equal(a, 1);
  assert.equal(b, 1);
});

// ---------------------------------------------------------------------------
// Brute-force protection
// ---------------------------------------------------------------------------

test('registerLoginFailure escalates lockout after threshold', () => {
  clearLoginFailures('bf');
  const results = [];
  for (let i = 0; i < 5; i++) results.push(registerLoginFailure('bf'));
  assert.equal(results[4], 30_000); // first lock step
  assert.equal(registerLoginFailure('bf'), 60_000); // escalates
  clearLoginFailures('bf');
  assert.ok(registerLoginFailure('bf') <= 0); // cleared state → no lock
  clearLoginFailures('bf');
});

test('bruteForceGuard returns 429 while locked', () => {
  clearLoginFailures('bf2');
  for (let i = 0; i < 5; i++) registerLoginFailure('bf2');
  const r = res();
  const guard = bruteForceGuard(() => 'bf2');
  let called = false;
  guard(req('POST'), r, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(r.statusCode, 429);
  assert.ok(Number(r.headers['Retry-After']) >= 1);
  clearLoginFailures('bf2');
});

test('bruteForceGuard passes when unlocked', () => {
  clearLoginFailures('bf3');
  const guard = bruteForceGuard(() => 'bf3');
  let called = false;
  guard(req('POST'), res(), () => {
    called = true;
  });
  assert.equal(called, true);
});

// ---------------------------------------------------------------------------
// SSRF guard (pure branches, no network)
// ---------------------------------------------------------------------------

test('isSafeExternalUrl rejects non-http(s) schemes and malformed urls', async () => {
  assert.equal(await isSafeExternalUrl('file:///etc/passwd'), false);
  assert.equal(await isSafeExternalUrl('ftp://example.com/x.mp3'), false);
  assert.equal(await isSafeExternalUrl('not a url'), false);
});

test('isSafeExternalUrl rejects localhost and loopback', async () => {
  assert.equal(await isSafeExternalUrl('http://localhost/x.mp3'), false);
  assert.equal(await isSafeExternalUrl('http://foo.localhost/x.mp3'), false);
  assert.equal(await isSafeExternalUrl('http://127.0.0.1/x.mp3'), false);
  assert.equal(await isSafeExternalUrl('http://0.0.0.0/x.mp3'), false);
});

test('isSafeExternalUrl rejects private and reserved ranges', async () => {
  assert.equal(await isSafeExternalUrl('http://10.0.0.5/x.mp3'), false);
  assert.equal(await isSafeExternalUrl('http://192.168.1.1/x.mp3'), false);
  assert.equal(await isSafeExternalUrl('http://172.16.0.1/x.mp3'), false);
  assert.equal(await isSafeExternalUrl('http://169.254.0.1/x.mp3'), false);
  assert.equal(await isSafeExternalUrl('http://[::1]/x.mp3'), false);
  assert.equal(await isSafeExternalUrl('http://[fd00::1]/x.mp3'), false);
  assert.equal(await isSafeExternalUrl('http://[fe80::1]/x.mp3'), false);
  assert.equal(await isSafeExternalUrl('http://203.0.113.1/x.mp3'), false); // TEST-NET-3
});

test('isSafeExternalUrl accepts a public IP literal', async () => {
  assert.equal(await isSafeExternalUrl('http://8.8.8.8/x.mp3'), true);
  assert.equal(await isSafeExternalUrl('http://[2606:4700:4700::1111]/x.mp3'), true);
});
