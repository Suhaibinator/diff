'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { generateUnifiedPatch, parseUnifiedPatch } = require('../src/js/patch.js');

// --- Test helpers: build the app's diff object from two raw strings. ---

function splitInput(text) {
  if (text === '') return { lines: [], eol: true };
  const lines = text.split('\n');
  let eol = false;
  if (lines[lines.length - 1] === '') {
    lines.pop();
    eol = true;
  }
  return { lines, eol };
}

function makeDiff(oldText, newText) {
  const o = splitInput(oldText);
  const n = splitInput(newText);
  const a = o.lines;
  const b = n.lines;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', oldIdx: i, newIdx: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'delete', oldIdx: i });
      i++;
    } else {
      ops.push({ type: 'insert', newIdx: j });
      j++;
    }
  }
  while (i < a.length) ops.push({ type: 'delete', oldIdx: i++ });
  while (j < b.length) ops.push({ type: 'insert', newIdx: j++ });
  return { oldLines: a, newLines: b, oldEol: o.eol, newEol: n.eol, ops };
}

function hunkCount(patch) {
  const m = patch.match(/^@@ /gm);
  return m ? m.length : 0;
}

// Generate a patch between oldText and newText, apply it with git apply in a
// temp repo, and return the patched file content plus the patch itself.
function gitApplyRoundTrip(oldText, newText, opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-patch-test-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'f.txt'), oldText);
    const diff = makeDiff(oldText, newText);
    const patch = generateUnifiedPatch(diff, Object.assign({ oldName: 'f.txt', newName: 'f.txt' }, opts));
    fs.writeFileSync(path.join(dir, 'p.patch'), patch);
    execFileSync('git', ['apply', '--check', 'p.patch'], { cwd: dir });
    execFileSync('git', ['apply', 'p.patch'], { cwd: dir });
    return { patch, result: fs.readFileSync(path.join(dir, 'f.txt'), 'utf8') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- generateUnifiedPatch: structure ---

test('no changes emits only the two header lines', () => {
  const diff = makeDiff('a\nb\n', 'a\nb\n');
  const patch = generateUnifiedPatch(diff);
  assert.equal(patch, '--- a/original\n+++ b/modified\n');
});

test('middle edit produces the expected unified patch text', () => {
  const diff = makeDiff('a\nb\nc\nd\ne\nf\ng\n', 'a\nb\nc\nX\ne\nf\ng\n');
  const patch = generateUnifiedPatch(diff, { oldName: 'left.txt', newName: 'right.txt' });
  assert.equal(patch, [
    '--- a/left.txt',
    '+++ b/right.txt',
    '@@ -1,7 +1,7 @@',
    ' a',
    ' b',
    ' c',
    '-d',
    '+X',
    ' e',
    ' f',
    ' g',
    ''
  ].join('\n'));
});

test('empty old side yields @@ -0,0 +1,N @@', () => {
  const diff = makeDiff('', 'x\ny\n');
  const patch = generateUnifiedPatch(diff);
  assert.match(patch, /^@@ -0,0 \+1,2 @@$/m);
  assert.match(patch, /^\+x$/m);
  assert.match(patch, /^\+y$/m);
});

test('empty new side yields @@ -1,N +0,0 @@', () => {
  const diff = makeDiff('x\ny\n', '');
  const patch = generateUnifiedPatch(diff);
  assert.match(patch, /^@@ -1,2 \+0,0 @@$/m);
});

test('changes separated by exactly 2*context equal lines merge into one hunk', () => {
  const mid = ['1', '2', '3', '4', '5', '6'];
  const oldText = ['A'].concat(mid, ['B']).join('\n') + '\n';
  const newText = ['a'].concat(mid, ['b']).join('\n') + '\n';
  const patch = generateUnifiedPatch(makeDiff(oldText, newText));
  assert.equal(hunkCount(patch), 1);
});

test('changes separated by more than 2*context equal lines stay separate hunks', () => {
  const mid = ['1', '2', '3', '4', '5', '6', '7'];
  const oldText = ['A'].concat(mid, ['B']).join('\n') + '\n';
  const newText = ['a'].concat(mid, ['b']).join('\n') + '\n';
  const patch = generateUnifiedPatch(makeDiff(oldText, newText));
  assert.equal(hunkCount(patch), 2);
});

test('no-newline marker on both sides of a changed last line', () => {
  const diff = makeDiff('a\nb', 'a\nB');
  const patch = generateUnifiedPatch(diff);
  assert.equal(patch, [
    '--- a/original',
    '+++ b/modified',
    '@@ -1,2 +1,2 @@',
    ' a',
    '-b',
    '\\ No newline at end of file',
    '+B',
    '\\ No newline at end of file',
    ''
  ].join('\n'));
});

test('shared last context line without newline gets a single marker', () => {
  const diff = makeDiff('x\na', 'y\na');
  const patch = generateUnifiedPatch(diff);
  assert.equal(patch, [
    '--- a/original',
    '+++ b/modified',
    '@@ -1,2 +1,2 @@',
    '-x',
    '+y',
    ' a',
    '\\ No newline at end of file',
    ''
  ].join('\n'));
});

// --- generateUnifiedPatch: git apply round trips ---

test('git apply: edit in the middle of a file', () => {
  const oldText = 'a\nb\nc\nd\ne\nf\ng\nh\n';
  const newText = 'a\nb\nc\nX\nY\ne\nf\ng\nh\n';
  const { result } = gitApplyRoundTrip(oldText, newText);
  assert.equal(result, newText);
});

test('git apply: edit at file start', () => {
  const oldText = 'first\nb\nc\nd\ne\n';
  const newText = 'FIRST\nb\nc\nd\ne\n';
  const { result } = gitApplyRoundTrip(oldText, newText);
  assert.equal(result, newText);
});

test('git apply: edit at file end', () => {
  const oldText = 'a\nb\nc\nd\nlast\n';
  const newText = 'a\nb\nc\nd\nLAST\n';
  const { result } = gitApplyRoundTrip(oldText, newText);
  assert.equal(result, newText);
});

test('git apply: new side loses the trailing newline', () => {
  const oldText = 'a\nb\n';
  const newText = 'a\nc';
  const { patch, result } = gitApplyRoundTrip(oldText, newText);
  assert.match(patch, /\\ No newline at end of file/);
  assert.equal(result, newText);
});

test('git apply: old side lacks the trailing newline', () => {
  const oldText = 'a\nb';
  const newText = 'a\nB\n';
  const { result } = gitApplyRoundTrip(oldText, newText);
  assert.equal(result, newText);
});

test('git apply: two far-apart changes apply as two hunks', () => {
  const mid = [];
  for (let i = 0; i < 20; i++) mid.push('line ' + i);
  const oldText = ['start'].concat(mid, ['end']).join('\n') + '\n';
  const newText = ['START'].concat(mid, ['END']).join('\n') + '\n';
  const { patch, result } = gitApplyRoundTrip(oldText, newText);
  assert.equal(hunkCount(patch), 2);
  assert.equal(result, newText);
});

test('git apply: two nearby changes apply as one merged hunk', () => {
  const mid = ['1', '2', '3', '4'];
  const oldText = ['start'].concat(mid, ['end']).join('\n') + '\n';
  const newText = ['START'].concat(mid, ['END']).join('\n') + '\n';
  const { patch, result } = gitApplyRoundTrip(oldText, newText);
  assert.equal(hunkCount(patch), 1);
  assert.equal(result, newText);
});

test('git apply: content added to an empty file', () => {
  const { patch, result } = gitApplyRoundTrip('', 'one\ntwo\n');
  assert.match(patch, /^@@ -0,0 \+1,2 @@$/m);
  assert.equal(result, 'one\ntwo\n');
});

test('git apply: all content removed', () => {
  const { patch, result } = gitApplyRoundTrip('one\ntwo\n', '');
  assert.match(patch, /^@@ -1,2 \+0,0 @@$/m);
  assert.equal(result, '');
});

// --- parseUnifiedPatch ---

test('parses a realistic multi-file git diff', () => {
  const fixture = [
    'diff --git a/src/app.js b/src/app.js',
    'index 3b18e51..9daeafb 100644',
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,5 +1,6 @@ function main() {',
    ' one',
    '-two',
    '+TWO',
    '+extra',
    ' three',
    ' four',
    ' five',
    'diff --git a/docs/new.md b/docs/new.md',
    'new file mode 100644',
    'index 0000000..e69de29',
    '--- /dev/null',
    '+++ b/docs/new.md',
    '@@ -0,0 +1,2 @@',
    '+# Title',
    '+Body',
    ''
  ].join('\n');

  const res = parseUnifiedPatch(fixture);
  assert.equal(res.error, null);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.files.length, 2);

  const f1 = res.files[0];
  assert.equal(f1.oldName, 'src/app.js');
  assert.equal(f1.newName, 'src/app.js');
  assert.deepEqual(f1.meta, [
    'diff --git a/src/app.js b/src/app.js',
    'index 3b18e51..9daeafb 100644'
  ]);
  assert.equal(f1.hunks.length, 1);
  const h1 = f1.hunks[0];
  assert.equal(h1.header, '@@ -1,5 +1,6 @@ function main() {');
  assert.deepEqual(
    { oldStart: h1.oldStart, oldCount: h1.oldCount, newStart: h1.newStart, newCount: h1.newCount },
    { oldStart: 1, oldCount: 5, newStart: 1, newCount: 6 }
  );
  assert.deepEqual(h1.lines, [
    { type: ' ', text: 'one' },
    { type: '-', text: 'two' },
    { type: '+', text: 'TWO' },
    { type: '+', text: 'extra' },
    { type: ' ', text: 'three' },
    { type: ' ', text: 'four' },
    { type: ' ', text: 'five' }
  ]);

  const f2 = res.files[1];
  assert.equal(f2.oldName, null);
  assert.equal(f2.newName, 'docs/new.md');
  assert.deepEqual(f2.meta, [
    'diff --git a/docs/new.md b/docs/new.md',
    'new file mode 100644',
    'index 0000000..e69de29'
  ]);
  assert.equal(f2.hunks.length, 1);
  assert.deepEqual(f2.hunks[0].lines, [
    { type: '+', text: '# Title' },
    { type: '+', text: 'Body' }
  ]);
});

test('accepts a bare hunk stream with no file headers', () => {
  const res = parseUnifiedPatch('@@ -1,2 +1,2 @@\n keep\n-old\n+new\n');
  assert.equal(res.error, null);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.files.length, 1);
  assert.equal(res.files[0].oldName, null);
  assert.equal(res.files[0].newName, null);
  assert.deepEqual(res.files[0].hunks[0].lines, [
    { type: ' ', text: 'keep' },
    { type: '-', text: 'old' },
    { type: '+', text: 'new' }
  ]);
});

test('truncated hunk keeps parsed lines and warns about counts', () => {
  const res = parseUnifiedPatch('@@ -1,5 +1,5 @@\n a\n b\n');
  assert.equal(res.error, null);
  assert.equal(res.files[0].hunks[0].lines.length, 2);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /hunk line counts do not match header \(@ line 1\)/);
});

test('unexpected line inside a hunk ends it early with warnings', () => {
  const res = parseUnifiedPatch('@@ -1,3 +1,3 @@\n a\nGARBAGE\n b\n c\n');
  assert.equal(res.error, null);
  assert.equal(res.files[0].hunks[0].lines.length, 1);
  assert.ok(res.warnings.some((w) => /unexpected line inside hunk/.test(w)));
  assert.ok(res.warnings.some((w) => /hunk line counts do not match header \(@ line 1\)/.test(w)));
});

test('no-newline markers set noNewline on the preceding line', () => {
  const res = parseUnifiedPatch([
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,2 +1,2 @@',
    ' a',
    '-b',
    '\\ No newline at end of file',
    '+B',
    '\\ No newline at end of file',
    ''
  ].join('\n'));
  assert.equal(res.error, null);
  assert.deepEqual(res.warnings, []);
  const lines = res.files[0].hunks[0].lines;
  assert.deepEqual(lines, [
    { type: ' ', text: 'a' },
    { type: '-', text: 'b', noNewline: true },
    { type: '+', text: 'B', noNewline: true }
  ]);
});

test('hunk headers without explicit counts default to 1', () => {
  const res = parseUnifiedPatch('@@ -1 +1 @@\n-a\n+b\n');
  assert.equal(res.error, null);
  const h = res.files[0].hunks[0];
  assert.deepEqual(
    { oldStart: h.oldStart, oldCount: h.oldCount, newStart: h.newStart, newCount: h.newCount },
    { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 }
  );
});

test('garbage input returns an error without throwing', () => {
  const res = parseUnifiedPatch('hello\nthis is not a diff\n\nat all\n');
  assert.deepEqual(res.files, []);
  assert.equal(res.error, 'No hunks found — is this a unified diff?');
});

test('empty and non-string inputs never throw', () => {
  for (const input of ['', '\n', null, undefined, 42]) {
    const res = parseUnifiedPatch(input);
    assert.equal(res.error, 'No hunks found — is this a unified diff?');
    assert.deepEqual(res.files, []);
    assert.deepEqual(res.warnings, []);
  }
});

test('trailing newline does not produce a bogus warning', () => {
  const res = parseUnifiedPatch('@@ -1,1 +1,1 @@\n-a\n+b\n');
  assert.equal(res.error, null);
  assert.deepEqual(res.warnings, []);
});

// --- Round trip: generate -> parse ---

test('generated patches parse back to the same names, headers, and lines', () => {
  const oldText = 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\n';
  const newText = 'alpha\nBETA\ngamma\ndelta\nepsilon\nzeta\neta\nTHETA\nextra\n';
  const diff = makeDiff(oldText, newText);
  const patch = generateUnifiedPatch(diff, { context: 1, oldName: 'old.txt', newName: 'new.txt' });
  const res = parseUnifiedPatch(patch);

  assert.equal(res.error, null);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.files.length, 1);
  assert.equal(res.files[0].oldName, 'old.txt');
  assert.equal(res.files[0].newName, 'new.txt');

  const emittedHunkLines = patch.split('\n').filter((l) => l.startsWith('@@ '));
  assert.deepEqual(res.files[0].hunks.map((h) => h.header), emittedHunkLines);

  const reLines = [];
  for (const h of res.files[0].hunks) {
    for (const l of h.lines) reLines.push(l.type + l.text);
  }
  const expected = patch
    .split('\n')
    .filter((l, idx) => idx >= 2 && l !== '' && !l.startsWith('@@ ') && !l.startsWith('\\'));
  assert.deepEqual(reLines, expected);
});
