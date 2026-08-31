// ── Diff engine (pure — no DOM) ──

const DIFF_MAX_D = 3000;       // Myers depth cap for line diffs
const INLINE_MAX_CHARS = 3000; // skip inline marks beyond this line length
const INLINE_MAX_D = 1500;     // Myers depth cap for inline token diffs

function splitLines(text) {
  if (text === '') return { lines: [], eol: true };
  const eol = text.endsWith('\n');
  const body = eol ? text.slice(0, -1) : text;
  return { lines: body.split('\n'), eol };
}

function normKey(line, opts) {
  let key = line;
  if (opts.ignoreWhitespace === 'trim') key = key.trim();
  else if (opts.ignoreWhitespace === 'all') key = key.replace(/\s+/g, '');
  if (opts.ignoreCase) key = key.toLowerCase();
  return key;
}

// Myers O(ND) diff over arrays of comparable values.
// Returns ordered ops [{type:'equal',oldIdx,newIdx}|{type:'delete',oldIdx}|{type:'insert',newIdx}],
// or null when the edit distance exceeds maxD (caller falls back to block replacement).
function myersDiff(a, b, maxD) {
  const N = a.length;
  const M = b.length;
  const total = N + M;
  if (total === 0) return [];
  const cap = maxD == null ? total : Math.min(maxD, total);
  const off = cap;
  const v = new Int32Array(2 * cap + 1);
  const trace = [];

  for (let d = 0; d <= cap; d++) {
    // Snapshot only the k-range this depth can read (|k| <= d).
    trace.push(v.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) {
        x = v[off + k + 1];
      } else {
        x = v[off + k - 1] + 1;
      }
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= N && y >= M) return myersBacktrack(trace, a, b);
    }
  }
  return null;
}

function myersBacktrack(trace, a, b) {
  let x = a.length;
  let y = b.length;
  const ops = [];

  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d]; // snapshot covering k in [-d, d], indexed by k + d
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && v[k - 1 + d] < v[k + 1 + d])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[prevK + d];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', oldIdx: x - 1, newIdx: y - 1 });
      x--; y--;
    }

    if (x === prevX) {
      ops.push({ type: 'insert', newIdx: y - 1 });
      y--;
    } else {
      ops.push({ type: 'delete', oldIdx: x - 1 });
      x--;
    }
  }

  // d === 0: whatever remains is the common leading snake.
  while (x > 0 && y > 0) {
    ops.push({ type: 'equal', oldIdx: x - 1, newIdx: y - 1 });
    x--; y--;
  }

  ops.reverse();
  return ops;
}

// Full line-level diff with normalization options.
// opts: { ignoreWhitespace: 'none'|'trim'|'all', ignoreCase: bool, maxD?: number }
function computeDiff(aText, bText, opts) {
  opts = opts || {};
  const sa = splitLines(aText);
  const sb = splitLines(bText);
  const oldLines = sa.lines;
  const newLines = sb.lines;
  const plain = opts.ignoreWhitespace !== 'trim' && opts.ignoreWhitespace !== 'all' && !opts.ignoreCase;
  const aKeys = plain ? oldLines : oldLines.map(l => normKey(l, opts));
  const bKeys = plain ? newLines : newLines.map(l => normKey(l, opts));

  // Trim common prefix/suffix so Myers only sees the changed middle.
  let pre = 0;
  const minLen = Math.min(aKeys.length, bKeys.length);
  while (pre < minLen && aKeys[pre] === bKeys[pre]) pre++;
  let suf = 0;
  while (suf < minLen - pre && aKeys[aKeys.length - 1 - suf] === bKeys[bKeys.length - 1 - suf]) suf++;

  const midA = aKeys.slice(pre, aKeys.length - suf);
  const midB = bKeys.slice(pre, bKeys.length - suf);
  let midOps = myersDiff(midA, midB, opts.maxD == null ? DIFF_MAX_D : opts.maxD);
  let truncated = false;
  if (midOps === null) {
    truncated = true;
    midOps = [];
    for (let i = 0; i < midA.length; i++) midOps.push({ type: 'delete', oldIdx: i });
    for (let j = 0; j < midB.length; j++) midOps.push({ type: 'insert', newIdx: j });
  }

  const ops = [];
  for (let i = 0; i < pre; i++) ops.push({ type: 'equal', oldIdx: i, newIdx: i });
  for (const op of midOps) {
    if (op.type === 'equal') ops.push({ type: 'equal', oldIdx: op.oldIdx + pre, newIdx: op.newIdx + pre });
    else if (op.type === 'delete') ops.push({ type: 'delete', oldIdx: op.oldIdx + pre });
    else ops.push({ type: 'insert', newIdx: op.newIdx + pre });
  }
  for (let s = suf; s > 0; s--) {
    ops.push({ type: 'equal', oldIdx: aKeys.length - s, newIdx: bKeys.length - s });
  }

  const finalOps = opts.ignoreWhitespace === 'all'
    ? mergeWhitespaceOnlyRuns(ops, aKeys, bKeys)
    : ops;

  return { oldLines, newLines, oldEol: sa.eol, newEol: sb.eol, ops: finalOps, truncated };
}

// Under ignoreWhitespace 'all', a newline is whitespace too: a change run that
// only redistributes content across line boundaries ("}\nelse {" vs "} else {")
// or adds/removes blank lines is not a real change. Detect such runs by
// concatenating each side's normalized keys; when they match, replace the run
// with equal ops. Lines pair up 1:1 in order; the longer side's leftovers
// become one-sided equal ops carrying only oldIdx or only newIdx.
function mergeWhitespaceOnlyRuns(ops, aKeys, bKeys) {
  const out = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') { out.push(ops[i]); i++; continue; }
    let j = i;
    while (j < ops.length && ops[j].type !== 'equal') j++;
    const run = ops.slice(i, j);
    const dels = run.filter(o => o.type === 'delete');
    const ins = run.filter(o => o.type === 'insert');
    let oldJoined = '';
    for (const o of dels) oldJoined += aKeys[o.oldIdx];
    let newJoined = '';
    for (const o of ins) newJoined += bKeys[o.newIdx];
    if (oldJoined === newJoined) {
      const n = Math.max(dels.length, ins.length);
      for (let k = 0; k < n; k++) {
        const op = { type: 'equal' };
        if (k < dels.length) op.oldIdx = dels[k].oldIdx;
        if (k < ins.length) op.newIdx = ins[k].newIdx;
        out.push(op);
      }
    } else {
      for (const o of run) out.push(o);
    }
    i = j;
  }
  return out;
}

// Character-offset ranges of the differing parts of a paired old/new line.
// granularity: 'line' (no inline marks) | 'word' | 'char'
// Returns { oldRanges: [{start,end}], newRanges: [{start,end}] } with adjacent ranges merged.
function inlineDiffRanges(oldStr, newStr, granularity) {
  const empty = { oldRanges: [], newRanges: [] };
  if (granularity === 'line' || oldStr === newStr) return empty;
  if (oldStr.length > INLINE_MAX_CHARS || newStr.length > INLINE_MAX_CHARS) return empty;

  const oldTokens = granularity === 'char' ? Array.from(oldStr) : (oldStr.match(/\S+|\s+/g) || []);
  const newTokens = granularity === 'char' ? Array.from(newStr) : (newStr.match(/\S+|\s+/g) || []);
  const ops = myersDiff(oldTokens, newTokens, INLINE_MAX_D);
  if (ops === null) {
    // Too different — mark whole lines.
    return {
      oldRanges: oldStr ? [{ start: 0, end: oldStr.length }] : [],
      newRanges: newStr ? [{ start: 0, end: newStr.length }] : [],
    };
  }

  const oldRanges = [];
  const newRanges = [];
  let oPos = 0;
  let nPos = 0;
  for (const op of ops) {
    if (op.type === 'equal') {
      oPos += oldTokens[op.oldIdx].length;
      nPos += newTokens[op.newIdx].length;
    } else if (op.type === 'delete') {
      const len = oldTokens[op.oldIdx].length;
      pushRange(oldRanges, oPos, oPos + len);
      oPos += len;
    } else {
      const len = newTokens[op.newIdx].length;
      pushRange(newRanges, nPos, nPos + len);
      nPos += len;
    }
  }
  return { oldRanges, newRanges };
}

function pushRange(ranges, start, end) {
  const last = ranges[ranges.length - 1];
  if (last && last.end === start) last.end = end;
  else ranges.push({ start, end });
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { splitLines, normKey, myersDiff, computeDiff, inlineDiffRanges, esc, DIFF_MAX_D };
}
