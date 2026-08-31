// ── JSON mode: normalize (sort keys, pretty-print) then reuse the line diff ──

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep); // array order is semantic — keep it
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

// Returns { ok: true, normalized } or { ok: false, error }
function normalizeJsonInput(text) {
  if (text.trim() === '') return { ok: true, normalized: '' };
  try {
    const parsed = JSON.parse(text);
    return { ok: true, normalized: JSON.stringify(sortKeysDeep(parsed), null, 2) + '\n' };
  } catch (e) {
    return { ok: false, error: jsonErrorMessage(e, text) };
  }
}

function jsonErrorMessage(e, text) {
  let msg = String(e && e.message || 'Invalid JSON');
  // Add a line/column hint when the engine reports a character position.
  const m = msg.match(/position (\d+)/);
  if (m) {
    const pos = Number(m[1]);
    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    if (!/line \d+/.test(msg)) msg += ' (line ' + line + ', column ' + col + ')';
  }
  return msg;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sortKeysDeep, normalizeJsonInput, jsonErrorMessage };
}
