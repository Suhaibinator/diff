'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  splitLines, normKey, myersDiff, computeDiff, inlineDiffRanges, esc,
} = require('../src/js/diff-core.js');
const { sortKeysDeep, normalizeJsonInput } = require('../src/js/json-mode.js');

function applyOps(diff) {
  // Reconstruct the new text from ops as a correctness check.
  const out = [];
  for (const op of diff.ops) {
    if (op.type === 'equal') out.push(diff.oldLines[op.oldIdx]);
    else if (op.type === 'insert') out.push(diff.newLines[op.newIdx]);
  }
  return out;
}

function opCounts(ops) {
  const c = { equal: 0, insert: 0, delete: 0 };
  for (const op of ops) c[op.type]++;
  return c;
}

test('splitLines drops the phantom trailing empty line', () => {
  assert.deepEqual(splitLines(''), { lines: [], eol: true });
  assert.deepEqual(splitLines('a'), { lines: ['a'], eol: false });
  assert.deepEqual(splitLines('a\n'), { lines: ['a'], eol: true });
  assert.deepEqual(splitLines('a\n\n'), { lines: ['a', ''], eol: true });
  assert.deepEqual(splitLines('a\nb'), { lines: ['a', 'b'], eol: false });
});

test('identical inputs produce only equal ops', () => {
  const d = computeDiff('a\nb\nc\n', 'a\nb\nc\n', {});
  assert.deepEqual(opCounts(d.ops), { equal: 3, insert: 0, delete: 0 });
  assert.equal(d.truncated, false);
});

test('empty vs content', () => {
  const d = computeDiff('', 'x\ny\n', {});
  assert.deepEqual(opCounts(d.ops), { equal: 0, insert: 2, delete: 0 });
  const d2 = computeDiff('x\ny\n', '', {});
  assert.deepEqual(opCounts(d2.ops), { equal: 0, insert: 0, delete: 2 });
});

test('interleaved edit reconstructs the new text', () => {
  const oldT = 'one\ntwo\nthree\nfour\nfive\n';
  const newT = 'one\n2\nthree\nfive\nsix\n';
  const d = computeDiff(oldT, newT, {});
  assert.deepEqual(applyOps(d), ['one', '2', 'three', 'five', 'six']);
  // ops must reference every old line exactly once via equal/delete
  const oldRefs = d.ops.filter(o => o.type !== 'insert').map(o => o.oldIdx).sort((a, b) => a - b);
  assert.deepEqual(oldRefs, [0, 1, 2, 3, 4]);
});

test('prefix/suffix trimming preserves correct indices', () => {
  const oldLines = [];
  const newLines = [];
  for (let i = 0; i < 500; i++) { oldLines.push('common ' + i); newLines.push('common ' + i); }
  oldLines.push('OLD MIDDLE');
  newLines.push('NEW MIDDLE');
  for (let i = 0; i < 500; i++) { oldLines.push('tail ' + i); newLines.push('tail ' + i); }
  const d = computeDiff(oldLines.join('\n') + '\n', newLines.join('\n') + '\n', {});
  assert.deepEqual(applyOps(d), newLines);
  const del = d.ops.find(o => o.type === 'delete');
  const ins = d.ops.find(o => o.type === 'insert');
  assert.equal(d.oldLines[del.oldIdx], 'OLD MIDDLE');
  assert.equal(d.newLines[ins.newIdx], 'NEW MIDDLE');
});

test('whitespace and case normalization options', () => {
  assert.equal(normKey('  a b  ', { ignoreWhitespace: 'trim' }), 'a b');
  assert.equal(normKey('  a b  ', { ignoreWhitespace: 'all' }), 'ab');
  assert.equal(normKey('AbC', { ignoreCase: true }), 'abc');

  const d1 = computeDiff('  hello  \n', 'hello\n', { ignoreWhitespace: 'trim' });
  assert.deepEqual(opCounts(d1.ops), { equal: 1, insert: 0, delete: 0 });
  const d2 = computeDiff('a b c\n', 'abc\n', { ignoreWhitespace: 'all' });
  assert.deepEqual(opCounts(d2.ops), { equal: 1, insert: 0, delete: 0 });
  const d3 = computeDiff('HELLO\n', 'hello\n', { ignoreCase: true });
  assert.deepEqual(opCounts(d3.ops), { equal: 1, insert: 0, delete: 0 });
  const d4 = computeDiff('HELLO\n', 'hello\n', {});
  assert.deepEqual(opCounts(d4.ops), { equal: 0, insert: 1, delete: 1 });
});

test('ignore-all-whitespace treats line joins/splits as unchanged', () => {
  // "}\nelse {" vs "} else {" only moves a newline — whitespace under 'all'.
  const oldT = 'if (x) {\n  a();\n}\nelse {\n  b();\n}\n';
  const newT = 'if (x) {\n  a();\n} else {\n  b();\n}\n';
  const d = computeDiff(oldT, newT, { ignoreWhitespace: 'all' });
  assert.deepEqual(opCounts(d.ops).insert, 0);
  assert.deepEqual(opCounts(d.ops).delete, 0);
  // The extra old line becomes a one-sided equal op.
  const oneSided = d.ops.filter(o => o.type === 'equal' && (o.oldIdx == null || o.newIdx == null));
  assert.equal(oneSided.length, 1);
  assert.equal(d.oldLines[oneSided[0].oldIdx], 'else {');

  // Without the option the same change still shows as a real diff.
  const plain = computeDiff(oldT, newT, {});
  assert.ok(plain.ops.some(o => o.type !== 'equal'));
  const trimmed = computeDiff(oldT, newT, { ignoreWhitespace: 'trim' });
  assert.ok(trimmed.ops.some(o => o.type !== 'equal'));
});

test('ignore-all-whitespace treats added/removed blank lines as unchanged', () => {
  const d = computeDiff('a\n\n\nb\n', 'a\nb\n', { ignoreWhitespace: 'all' });
  assert.deepEqual(opCounts(d.ops).insert, 0);
  assert.deepEqual(opCounts(d.ops).delete, 0);
});

test('ignore-all-whitespace still reports real changes next to rewrapping', () => {
  // Content changes (b -> B) inside a run that also rewraps lines.
  const d = computeDiff('a b\nc\n', 'a\nB c\n', { ignoreWhitespace: 'all' });
  assert.ok(d.ops.some(o => o.type !== 'equal'));
});

test('maxD cap falls back to block replacement and flags truncated', () => {
  const a = Array.from({ length: 50 }, (_, i) => 'a' + i).join('\n');
  const b = Array.from({ length: 50 }, (_, i) => 'b' + i).join('\n');
  const d = computeDiff(a, b, { maxD: 10 });
  assert.equal(d.truncated, true);
  assert.deepEqual(opCounts(d.ops), { equal: 0, insert: 50, delete: 50 });
  assert.deepEqual(applyOps(d), b.split('\n'));
});

test('myersDiff returns null when capped, ops otherwise', () => {
  assert.equal(myersDiff(['a'], ['b'], 1), null); // needs d=2
  assert.notEqual(myersDiff(['a'], ['b'], 2), null);
  assert.deepEqual(myersDiff([], [], 5), []);
});

test('inlineDiffRanges word granularity offsets', () => {
  const r = inlineDiffRanges('the quick fox', 'the slow fox', 'word');
  assert.deepEqual(r.oldRanges, [{ start: 4, end: 9 }]);   // 'quick'
  assert.deepEqual(r.newRanges, [{ start: 4, end: 8 }]);   // 'slow'
});

test('inlineDiffRanges char granularity merges adjacent ranges', () => {
  const r = inlineDiffRanges('abcdef', 'abXYef', 'char');
  assert.deepEqual(r.oldRanges, [{ start: 2, end: 4 }]);   // 'cd'
  assert.deepEqual(r.newRanges, [{ start: 2, end: 4 }]);   // 'XY'
});

test('inlineDiffRanges handles code points and edge cases', () => {
  assert.deepEqual(inlineDiffRanges('same', 'same', 'word'), { oldRanges: [], newRanges: [] });
  assert.deepEqual(inlineDiffRanges('a', 'b', 'line'), { oldRanges: [], newRanges: [] });
  const r = inlineDiffRanges('x 😀 y', 'x 😎 y', 'char');
  // Surrogate pairs: ranges must cover the full 2-unit emoji
  assert.deepEqual(r.oldRanges, [{ start: 2, end: 4 }]);
  assert.deepEqual(r.newRanges, [{ start: 2, end: 4 }]);
  // Ranges must slice the raw string cleanly
  assert.equal('x 😀 y'.slice(2, 4), '😀');
});

test('inlineDiffRanges skips very long lines', () => {
  const long = 'x'.repeat(4000);
  assert.deepEqual(inlineDiffRanges(long, long + 'y', 'char'), { oldRanges: [], newRanges: [] });
});

test('esc escapes HTML', () => {
  assert.equal(esc('<a & "b">'), '&lt;a &amp; "b"&gt;');
});

test('sortKeysDeep sorts object keys recursively, preserves arrays', () => {
  const input = { b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } };
  const out = sortKeysDeep(input);
  assert.deepEqual(Object.keys(out), ['a', 'b']);
  assert.deepEqual(Object.keys(out.a), ['c', 'd']);
  assert.deepEqual(out.a.d[0], 3); // array order untouched
  assert.deepEqual(Object.keys(out.a.d[1]), ['y', 'z']);
});

test('normalizeJsonInput: key order and whitespace become irrelevant', () => {
  const a = normalizeJsonInput('{"b":1,"a":2}');
  const b = normalizeJsonInput('{ "a": 2, "b": 1 }');
  assert.equal(a.ok, true);
  assert.deepEqual(a, b);
});

test('normalizeJsonInput: invalid JSON reports position and never throws', () => {
  const r = normalizeJsonInput('{"a": }');
  assert.equal(r.ok, false);
  assert.match(r.error, /line \d+, column \d+|position|Unexpected/);
  assert.deepEqual(normalizeJsonInput('   '), { ok: true, normalized: '' });
});

test('large mostly-identical input diffs quickly', () => {
  const lines = Array.from({ length: 20000 }, (_, i) => 'line number ' + i);
  const oldT = lines.join('\n') + '\n';
  const modified = lines.slice();
  modified[10000] = 'CHANGED';
  const newT = modified.join('\n') + '\n';
  const start = Date.now();
  const d = computeDiff(oldT, newT, {});
  const ms = Date.now() - start;
  assert.deepEqual(opCounts(d.ops), { equal: 19999, insert: 1, delete: 1 });
  assert.ok(ms < 2000, 'diff took ' + ms + 'ms');
});
