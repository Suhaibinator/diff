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

// Key-source text for a line under ignore-comments. Untouched lines keep
// their exact text (indentation stays significant); a line stripping emptied
// becomes '', and a trailing removed comment doesn't leave phantom
// whitespace behind.
function commentKeySource(raw, src) {
  if (src === raw) return raw;
  if (/^\s*$/.test(src)) return '';
  return src.replace(/\s+$/, '');
}

// Full line-level diff with normalization options.
// opts: { ignoreWhitespace: 'none'|'trim'|'all', ignoreCase: bool, maxD?: number,
//         detectMoves?: bool, aKeySource?: string[], bKeySource?: string[] }
// aKeySource/bKeySource: per-line comment-stripped text (from stripComments);
// keys are built from them while the original lines are what's displayed.
function computeDiff(aText, bText, opts) {
  opts = opts || {};
  const sa = splitLines(aText);
  const sb = splitLines(bText);
  const oldLines = sa.lines;
  const newLines = sb.lines;
  const aSrc = (opts.aKeySource && opts.aKeySource.length === oldLines.length &&
                opts.bKeySource && opts.bKeySource.length === newLines.length)
    ? opts.aKeySource : null;
  const bSrc = aSrc ? opts.bKeySource : null;
  const plain = !aSrc && opts.ignoreWhitespace !== 'trim' && opts.ignoreWhitespace !== 'all' && !opts.ignoreCase;
  const aKeys = aSrc ? oldLines.map((l, i) => normKey(commentKeySource(l, aSrc[i]), opts))
    : (plain ? oldLines : oldLines.map(l => normKey(l, opts)));
  const bKeys = bSrc ? newLines.map((l, i) => normKey(commentKeySource(l, bSrc[i]), opts))
    : (plain ? newLines : newLines.map(l => normKey(l, opts)));
  // Ignorable = stripping emptied a non-blank line (a pure comment line).
  // Raw blank lines are never ignorable, so blank-line edits stay changes.
  const aDrop = aSrc ? oldLines.map((l, i) => aSrc[i] !== l && commentKeySource(l, aSrc[i]) === '') : null;
  const bDrop = bSrc ? newLines.map((l, i) => bSrc[i] !== l && commentKeySource(l, bSrc[i]) === '') : null;

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

  // Under 'all', the joined-key comparison (on stripped keys when a key
  // source is present) subsumes the comment-only sequence rule.
  let finalOps = ops;
  if (opts.ignoreWhitespace === 'all') finalOps = mergeWhitespaceOnlyRuns(ops, aKeys, bKeys);
  else if (aSrc) finalOps = mergeCommentOnlyRuns(ops, aKeys, bKeys, aDrop, bDrop);
  if (opts.detectMoves) detectMoves(finalOps, aKeys, bKeys);

  return { oldLines, newLines, oldEol: sa.eol, newEol: sb.eol, ops: finalOps, truncated };
}

// Under ignore-comments, a change run whose non-ignorable lines match 1:1 in
// order is comment-only churn. Sequence comparison (not concatenation) keeps
// code rewrapping a real diff under 'none'/'trim'. Kept lines pair two-sided,
// comment lines pair comment-with-comment, and surplus comment lines become
// one-sided equal ops. All-or-nothing per run: a run mixing a real code edit
// with comment churn stays fully visible.
function mergeCommentOnlyRuns(ops, aKeys, bKeys, aDrop, bDrop) {
  const out = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') { out.push(ops[i]); i++; continue; }
    let j = i;
    while (j < ops.length && ops[j].type !== 'equal') j++;
    const run = ops.slice(i, j);
    const dels = run.filter(o => o.type === 'delete');
    const ins = run.filter(o => o.type === 'insert');
    const oldSeq = dels.filter(o => !aDrop[o.oldIdx]);
    const newSeq = ins.filter(o => !bDrop[o.newIdx]);
    let match = oldSeq.length === newSeq.length;
    for (let k = 0; match && k < oldSeq.length; k++) {
      if (aKeys[oldSeq[k].oldIdx] !== bKeys[newSeq[k].newIdx]) match = false;
    }
    if (match) {
      let di = 0;
      let ni = 0;
      while (di < dels.length || ni < ins.length) {
        const dIgn = di < dels.length && aDrop[dels[di].oldIdx];
        const nIgn = ni < ins.length && bDrop[ins[ni].newIdx];
        if (dIgn && nIgn) {
          out.push({ type: 'equal', oldIdx: dels[di++].oldIdx, newIdx: ins[ni++].newIdx });
        } else if (dIgn) {
          out.push({ type: 'equal', oldIdx: dels[di++].oldIdx });
        } else if (nIgn) {
          out.push({ type: 'equal', newIdx: ins[ni++].newIdx });
        } else {
          out.push({ type: 'equal', oldIdx: dels[di++].oldIdx, newIdx: ins[ni++].newIdx });
        }
      }
    } else {
      for (const o of run) out.push(o);
    }
    i = j;
  }
  return out;
}

const MOVE_TRIVIAL_MIN = 3;

// Trivial lines (blanks, braces, lone punctuation) can't anchor a move on
// their own — they only join a block when adjacent lines match too.
function moveTrivialKey(key) {
  const t = key.replace(/\s+/g, '');
  return t.length < MOVE_TRIVIAL_MIN || !/[A-Za-z0-9]/.test(t);
}

// Tag delete/insert pairs that are really relocations. A line anchors a move
// when its key appears exactly once among deletes and once among inserts;
// each anchor then grows up and down by consecutive line numbers on both
// sides, sweeping adjacent matching lines (trivial ones included) into one
// block. Ops keep their type — they gain moveId (shared per block) plus
// moveTo (on deletes) / moveFrom (on inserts) pointing at the partner line.
function detectMoves(ops, aKeys, bKeys) {
  const delOps = [];
  const insOps = [];
  for (const op of ops) {
    if (op.type === 'delete') delOps.push(op);
    else if (op.type === 'insert') insOps.push(op);
  }
  if (delOps.length === 0 || insOps.length === 0) return;

  const delByKey = new Map();
  const insByKey = new Map();
  const delByOld = new Map();
  const insByNew = new Map();
  for (const op of delOps) {
    const k = aKeys[op.oldIdx];
    if (!delByKey.has(k)) delByKey.set(k, []);
    delByKey.get(k).push(op);
    delByOld.set(op.oldIdx, op);
  }
  for (const op of insOps) {
    const k = bKeys[op.newIdx];
    if (!insByKey.has(k)) insByKey.set(k, []);
    insByKey.get(k).push(op);
    insByNew.set(op.newIdx, op);
  }

  const anchors = [];
  for (const [key, dels] of delByKey) {
    if (dels.length !== 1) continue;
    const ins = insByKey.get(key);
    if (!ins || ins.length !== 1) continue;
    if (moveTrivialKey(key)) continue;
    anchors.push([dels[0], ins[0]]);
  }
  anchors.sort((p, q) => p[0].oldIdx - q[0].oldIdx);

  let nextMoveId = 0;
  const pairMove = (d, ins, id) => {
    d.moveId = id; d.moveTo = ins.newIdx;
    ins.moveId = id; ins.moveFrom = d.oldIdx;
  };
  for (const [d0, i0] of anchors) {
    if (d0.moveId != null || i0.moveId != null) continue;
    const id = nextMoveId++;
    pairMove(d0, i0, id);
    for (let o = d0.oldIdx - 1, n = i0.newIdx - 1; ; o--, n--) {
      const d = delByOld.get(o);
      const ins = insByNew.get(n);
      if (!d || !ins || d.moveId != null || ins.moveId != null) break;
      if (aKeys[o] !== bKeys[n]) break;
      pairMove(d, ins, id);
    }
    for (let o = d0.oldIdx + 1, n = i0.newIdx + 1; ; o++, n++) {
      const d = delByOld.get(o);
      const ins = insByNew.get(n);
      if (!d || !ins || d.moveId != null || ins.moveId != null) break;
      if (aKeys[o] !== bKeys[n]) break;
      pairMove(d, ins, id);
    }
  }
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
  module.exports = { splitLines, normKey, myersDiff, computeDiff, inlineDiffRanges, esc, DIFF_MAX_D, detectMoves, moveTrivialKey, commentKeySource, mergeCommentOnlyRuns };
}
