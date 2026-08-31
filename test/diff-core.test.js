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

test('detectMoves tags a uniquely moved line on both sides', () => {
  const oldT = 'import b\nimport a\nimport c\n';
  const newT = 'import a\nimport c\nimport b\n';
  const d = computeDiff(oldT, newT, { detectMoves: true });
  const del = d.ops.find(o => o.type === 'delete');
  const ins = d.ops.find(o => o.type === 'insert');
  assert.equal(d.oldLines[del.oldIdx], 'import b');
  assert.equal(del.moveId, ins.moveId);
  assert.notEqual(del.moveId, undefined);
  assert.equal(del.moveTo, ins.newIdx);
  assert.equal(ins.moveFrom, del.oldIdx);
  // Types unchanged, so text reconstruction still works.
  assert.deepEqual(applyOps(d), ['import a', 'import c', 'import b']);
});

test('detectMoves assigns distinct sequential moveIds in old-file order', () => {
  const oldT = 'alpha\nkeep1\nbeta\nkeep2\n';
  const newT = 'keep1\nbeta\nkeep2\nalpha\n';
  const d = computeDiff(oldT, newT, { detectMoves: true });
  // 'alpha' moves down; 'beta' stays equal. Add a second real move:
  const oldT2 = 'alpha\nkeep1\nbeta\nkeep2\nkeep3\n';
  const newT2 = 'keep1\nkeep2\nbeta\nkeep3\nalpha\n';
  const d2 = computeDiff(oldT2, newT2, { detectMoves: true });
  const dels = d2.ops.filter(o => o.type === 'delete' && o.moveId != null);
  assert.equal(dels.length, 2);
  assert.equal(dels[0].moveId, 0); // 'alpha' (oldIdx 0) anchors first
  assert.equal(dels[1].moveId, 1); // 'beta'
  assert.equal(d2.oldLines[dels[0].oldIdx], 'alpha');
  assert.equal(d2.oldLines[dels[1].oldIdx], 'beta');
  assert.ok(d.ops.some(o => o.moveId != null));
});

test('detectMoves grows a moved function block including trivial lines', () => {
  // The stationary middle is larger than the function so Myers relocates the
  // function (4 lines of churn) rather than the middle (5 lines).
  const fn = ['function helper() {', '  work();', '', '}'];
  const mid = ['m1();', 'm2();', 'm3();', 'm4();', 'm5();'];
  const oldT = [...fn, ...mid, 'end'].join('\n') + '\n';
  const newT = [...mid, ...fn, 'end'].join('\n') + '\n';
  const d = computeDiff(oldT, newT, { detectMoves: true });
  const dels = d.ops.filter(o => o.type === 'delete');
  const ins = d.ops.filter(o => o.type === 'insert');
  assert.equal(dels.length, 4);
  assert.equal(ins.length, 4);
  const ids = new Set([...dels, ...ins].map(o => o.moveId));
  assert.deepEqual([...ids], [0]); // whole block, one moveId, incl. '' and '}'
  for (const o of dels) assert.equal(d.newLines[o.moveTo], d.oldLines[o.oldIdx]);
});

test('detectMoves ignores duplicates and lone trivial lines', () => {
  // 'dup' deleted twice and inserted twice — ambiguous, never anchors.
  // (maxD: 0 forces the block-replacement fallback so both copies churn;
  // no shared prefix/suffix so nothing gets trimmed to equal first.)
  const dup = computeDiff('dup\na\ndup\nb\n', 'c\ndup\nd\ndup\ne\n', { detectMoves: true, maxD: 0 });
  assert.ok(dup.ops.every(o => o.moveId == null));
  // A lone unique '}' relocation is trivial — untagged.
  const triv = computeDiff('}\na\nb\n', 'a\nb\n}\n', { detectMoves: true });
  assert.ok(triv.ops.every(o => o.moveId == null));
});

test('detectMoves off leaves ops untagged', () => {
  const d = computeDiff('b\na\n', 'a\nb\n', {});
  assert.ok(d.ops.every(o => !('moveId' in o)));
});

test('detectMoves works with normalization and one-sided equals', () => {
  // Moved copy re-indented: matches under 'trim'.
  const d = computeDiff('  doWork();\nkeep\n', 'keep\ndoWork();\n',
    { detectMoves: true, ignoreWhitespace: 'trim' });
  assert.ok(d.ops.some(o => o.moveId != null));
  // ignoreWhitespace 'all' with a line join (one-sided equals) plus a move.
  const oldT = 'if (x) {\n  a();\n}\nelse {\n  b();\n}\nmoveMe();\nkeep\n';
  const newT = 'moveMe();\nif (x) {\n  a();\n} else {\n  b();\n}\nkeep\n';
  const d2 = computeDiff(oldT, newT, { detectMoves: true, ignoreWhitespace: 'all' });
  const moved = d2.ops.filter(o => o.moveId != null);
  assert.equal(moved.length, 2);
  assert.equal(d2.oldLines[moved.find(o => o.type === 'delete').oldIdx], 'moveMe();');
  // One-sided equal ops untouched.
  assert.ok(d2.ops.filter(o => o.type === 'equal').every(o => o.moveId == null));
});

test('detectMoves still fires on the truncated block-replacement fallback', () => {
  const oldT = 'unique line one\nunique line two\nunique line three\n';
  const newT = 'unique line three\nunique line one\nunique line two\n';
  const d = computeDiff(oldT, newT, { detectMoves: true, maxD: 0 });
  assert.equal(d.truncated, true);
  assert.ok(d.ops.some(o => o.moveId != null));
  // Tagging never changes op types or counts.
  assert.deepEqual(opCounts(d.ops), { equal: 0, insert: 3, delete: 3 });
});

const { commentKeySource } = require('../src/js/diff-core.js');

test('commentKeySource only touches lines stripping changed', () => {
  assert.equal(commentKeySource('  x = 1', '  x = 1'), '  x = 1'); // untouched: exact
  assert.equal(commentKeySource('  // note', '  '), '');           // pure comment line
  assert.equal(commentKeySource('x = 1 // c', 'x = 1 '), 'x = 1'); // trailing comment
  assert.equal(commentKeySource('   ', '   '), '   ');             // raw blank untouched
});

// Helper: fabricate keySource arrays the way stripComments would.
function stripFixture(lines, stripFn) {
  return lines.map(stripFn);
}

test('keySource: comment-only edits read as unchanged', () => {
  // old: code with trailing comment + a comment line; new: edited comment,
  // comment block resplit 2 -> 3 lines.
  const oldLines = ['a();', 'b(); // old note', '// one', '// two', 'c();'];
  const newLines = ['a();', 'b(); // new note', '// one liner', '// split', '// up', 'c();'];
  const strip = l => l.replace(/\/\/.*$/, '');
  const d = computeDiff(oldLines.join('\n') + '\n', newLines.join('\n') + '\n', {
    aKeySource: stripFixture(oldLines, strip),
    bKeySource: stripFixture(newLines, strip),
  });
  assert.ok(d.ops.every(o => o.type === 'equal'));
  // Resplit leaves one surplus new comment line as a one-sided equal.
  assert.equal(d.ops.filter(o => o.oldIdx == null).length, 1);
});

test('keySource: comment lines added/removed at run edges merge', () => {
  const oldLines = ['x();'];
  const newLines = ['// header', 'x();', '// footer'];
  const strip = l => l.replace(/\/\/.*$/, '');
  const d = computeDiff(oldLines.join('\n') + '\n', newLines.join('\n') + '\n', {
    aKeySource: stripFixture(oldLines, strip),
    bKeySource: stripFixture(newLines, strip),
  });
  assert.ok(d.ops.every(o => o.type === 'equal'));
});

test('keySource: blank-line inserts and code rewraps stay real changes', () => {
  const strip = l => l.replace(/\/\/.*$/, '');
  // Inserted blank line: raw blank is never ignorable.
  const d1 = computeDiff('a();\nb();\n', 'a();\n\nb();\n', {
    aKeySource: ['a();', 'b();'], bKeySource: ['a();', '', 'b();'],
  });
  assert.ok(d1.ops.some(o => o.type !== 'equal'));
  // Code rewrap under default whitespace: sequences differ, not merged.
  const oldL = ['foo();', 'bar();'];
  const newL = ['foo(); bar();'];
  const d2 = computeDiff(oldL.join('\n') + '\n', newL.join('\n') + '\n', {
    aKeySource: stripFixture(oldL, strip), bKeySource: stripFixture(newL, strip),
  });
  assert.ok(d2.ops.some(o => o.type !== 'equal'));
});

test('keySource: a real code edit among comment churn stays visible', () => {
  const oldLines = ['// intro', 'value = 1;'];
  const newLines = ['// rewritten intro', 'value = 2;'];
  const strip = l => l.replace(/\/\/.*$/, '');
  const d = computeDiff(oldLines.join('\n') + '\n', newLines.join('\n') + '\n', {
    aKeySource: stripFixture(oldLines, strip),
    bKeySource: stripFixture(newLines, strip),
  });
  // The comment pair keys as equal; the code edit stays a real change.
  assert.deepEqual(opCounts(d.ops), { equal: 1, insert: 1, delete: 1 });
  assert.equal(d.oldLines[d.ops.find(o => o.type === 'delete').oldIdx], 'value = 1;');
});

test('keySource: composes with ignoreWhitespace all and detectMoves', () => {
  const strip = l => l.replace(/\/\/.*$/, '');
  // 'all': comment churn plus a line join both collapse.
  const oldL = ['x();', '// gone', 'if (a) {', 'doIt();', '}'];
  const newL = ['x();', 'if (a) { doIt();', '}'];
  const d = computeDiff(oldL.join('\n') + '\n', newL.join('\n') + '\n', {
    ignoreWhitespace: 'all',
    aKeySource: stripFixture(oldL, strip), bKeySource: stripFixture(newL, strip),
  });
  assert.ok(d.ops.every(o => o.type === 'equal'));
  // Moves match on stripped keys: relocated line with a changed comment.
  const oldM = ['doWork(); // a', 'keep1();', 'keep2();'];
  const newM = ['keep1();', 'keep2();', 'doWork(); // b'];
  const d2 = computeDiff(oldM.join('\n') + '\n', newM.join('\n') + '\n', {
    detectMoves: true,
    aKeySource: stripFixture(oldM, strip), bKeySource: stripFixture(newM, strip),
  });
  assert.ok(d2.ops.some(o => o.moveId != null));
});

test('keySource: length mismatch is ignored defensively', () => {
  const d = computeDiff('a\nb\n', 'a\nb\n', { aKeySource: ['x'], bKeySource: ['x', 'y'] });
  assert.deepEqual(opCounts(d.ops), { equal: 2, insert: 0, delete: 0 });
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
