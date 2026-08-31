// Shareable-URL payload codec: JSON -> gzip (when available) -> base64url,
// carried in the location hash as `d=<base64url>` or `du=<base64url>`.

function bytesToBase64url(u8) {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < u8.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const binary = atob(b64);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    u8[i] = binary.charCodeAt(i);
  }
  return u8;
}

async function encodeSharePayload(obj, opts) {
  const options = opts || {};
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (!options.forceUncompressed && typeof CompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return 'd=' + bytesToBase64url(new Uint8Array(buf));
  }
  return 'du=' + bytesToBase64url(bytes);
}

async function decodeSharePayload(hashStr) {
  let hash = String(hashStr);
  if (hash.startsWith('#')) hash = hash.slice(1);
  if (hash.startsWith('d=')) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This link requires a newer browser');
    }
    const bytes = base64urlToBytes(hash.slice(2));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(buf));
  }
  if (hash.startsWith('du=')) {
    const bytes = base64urlToBytes(hash.slice(3));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  throw new Error('Unrecognized share link');
}

if (typeof module !== 'undefined' && module.exports) { module.exports = { encodeSharePayload, decodeSharePayload, bytesToBase64url, base64urlToBytes }; }
