'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  encodeSharePayload,
  decodeSharePayload,
  bytesToBase64url,
  base64urlToBytes
} = require('../src/js/share.js');

test('base64url round-trips all byte values without padding chars', () => {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) bytes[i] = i;
  const encoded = bytesToBase64url(bytes);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(base64urlToBytes(encoded), bytes);
});

test('base64url handles large buffers across chunk boundaries', () => {
  const bytes = new Uint8Array(100000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
  assert.deepEqual(base64urlToBytes(bytesToBase64url(bytes)), bytes);
});

test('d= path round-trips a payload with unicode', async () => {
  const payload = {
    v: 1,
    l: 'héllo 🌍 world\nsecond line\ttabbed',
    r: '世界 ❄️ переклад\n',
    ln: 'left 名.txt',
    rn: 'right.txt',
    s: { mode: 'split', ws: false }
  };
  const hash = await encodeSharePayload(payload);
  assert.ok(hash.startsWith('d='));
  assert.ok(!hash.startsWith('du='));
  assert.deepEqual(await decodeSharePayload(hash), payload);
});

test('d= path compresses repetitive text well', async () => {
  const big = 'The quick brown fox jumps over the lazy dog. '.repeat(2300);
  assert.ok(big.length > 100000);
  const payload = { v: 1, l: big, r: big, s: {} };
  const hash = await encodeSharePayload(payload);
  assert.ok(hash.startsWith('d='));
  assert.ok(hash.length < JSON.stringify(payload).length / 5,
    'compressed hash should be much smaller than the JSON payload');
  assert.deepEqual(await decodeSharePayload(hash), payload);
});

test('du= fallback path round-trips', async () => {
  const payload = { v: 1, l: 'plain ascii', r: 'ünïcode 🎉', s: { mode: 'unified' } };
  const hash = await encodeSharePayload(payload, { forceUncompressed: true });
  assert.ok(hash.startsWith('du='));
  assert.deepEqual(await decodeSharePayload(hash), payload);
});

test('decode accepts a leading # on the hash', async () => {
  const payload = { v: 1, l: 'a', r: 'b', s: {} };
  const withGzip = await encodeSharePayload(payload);
  const withoutGzip = await encodeSharePayload(payload, { forceUncompressed: true });
  assert.deepEqual(await decodeSharePayload('#' + withGzip), payload);
  assert.deepEqual(await decodeSharePayload('#' + withoutGzip), payload);
});

test('decode rejects an unrecognized prefix', async () => {
  await assert.rejects(() => decodeSharePayload('x=abcdef'), /Unrecognized share link/);
  await assert.rejects(() => decodeSharePayload('not a share link'), /Unrecognized share link/);
});

test('decode rejects mangled base64 input', async () => {
  await assert.rejects(() => decodeSharePayload('d=!!!not*base64!!!'));
  await assert.rejects(() => decodeSharePayload('du=!!!not*base64!!!'));
});

test('decode rejects a d= payload truncated mid-stream', async () => {
  const payload = { v: 1, l: 'x'.repeat(5000), r: 'y'.repeat(5000), s: {} };
  const hash = await encodeSharePayload(payload);
  const truncated = hash.slice(0, 2 + Math.floor((hash.length - 2) / 2));
  await assert.rejects(() => decodeSharePayload(truncated));
});

test('decode rejects du= bytes that are not valid JSON', async () => {
  const bogus = 'du=' + bytesToBase64url(new TextEncoder().encode('{"unterminated'));
  await assert.rejects(() => decodeSharePayload(bogus));
});

test('d= decode without DecompressionStream reports a browser-support error', async () => {
  const payload = { v: 1, l: 'a', r: 'b', s: {} };
  const hash = await encodeSharePayload(payload);
  const original = globalThis.DecompressionStream;
  globalThis.DecompressionStream = undefined;
  try {
    await assert.rejects(() => decodeSharePayload(hash), /This link requires a newer browser/);
  } finally {
    globalThis.DecompressionStream = original;
  }
});
