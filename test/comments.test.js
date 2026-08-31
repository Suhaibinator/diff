'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const hljs = require('../vendor/highlight.min.js');
const { stripComments, setCommentsHljsForTesting } = require('../src/js/comments.js');
const { computeDiff } = require('../src/js/diff-core.js');

setCommentsHljsForTesting(hljs);

function lineCount(text) {
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

function assertLineInvariant(text, lang) {
  const out = stripComments(text, lang);
  assert.notEqual(out, null);
  assert.equal(out.length, lineCount(text));
  return out;
}

test('stripComments preserves line counts', () => {
  assertLineInvariant('a\nb\nc\n', 'javascript');
  assertLineInvariant('a\nb\nc', 'javascript');            // no trailing newline
  assertLineInvariant('/* one\ntwo\nthree */\nx\n', 'javascript');
  assertLineInvariant('x // comment at eof', 'javascript'); // comment ends the file
  assert.deepEqual(stripComments('', 'javascript'), []);
});

test('stripComments removes JS comments but not strings', () => {
  const out = stripComments(
    'const a = 1; // note\nconst s = "// not a comment";\nconst t = `b // c`;\n/* gone */\n',
    'javascript');
  assert.equal(out[0], 'const a = 1;');
  assert.equal(out[1], 'const s = "// not a comment";');
  assert.equal(out[2], 'const t = `b // c`;');
  assert.equal(out[3].trim(), '');
});

test('stripComments collapses mid-line block comments', () => {
  const out = stripComments('x = 1 /* c */ + 2;\n', 'javascript');
  assert.equal(out[0], 'x = 1 + 2;');
});

test('stripComments handles multi-line block comments and doctags', () => {
  const out = stripComments('before();\n/**\n * @param x the thing\n */\nafter();\n', 'javascript');
  assert.equal(out[0], 'before();');
  assert.equal(out[1], '');
  assert.equal(out[2].trim(), '');
  assert.equal(out[3].trim(), '');
  assert.equal(out[4], 'after();');
});

test('stripComments round-trips hljs entities', () => {
  const out = stripComments('if (a && b < c) { d("&amp;"); } // x < y\n', 'javascript');
  assert.equal(out[0], 'if (a && b < c) { d("&amp;"); }');
});

test('stripComments on Python: # stripped, docstrings kept', () => {
  const out = stripComments('def f():\n    """docstring"""\n    x = 1  # note\n', 'python');
  assert.equal(out[0], 'def f():');
  assert.equal(out[1], '    """docstring"""'); // strings are not comments
  assert.equal(out[2], '    x = 1');
});

test('stripComments null paths', () => {
  assert.equal(stripComments('x\n', 'no-such-language'), null);
  assert.equal(stripComments('x\n', 'plaintext'), null);
  assert.equal(stripComments('x\n', null), null);
  setCommentsHljsForTesting({ getLanguage: () => null });
  assert.equal(stripComments('x\n', 'javascript'), null);
  setCommentsHljsForTesting(hljs);
});

test('end-to-end: comment-only JS change diffs as unchanged', () => {
  const a = 'function go() {\n  run(); // start\n  // old note\n  stop();\n}\n';
  const b = 'function go() {\n  run(); // begin\n  stop();\n}\n';
  const d = computeDiff(a, b, {
    aKeySource: stripComments(a, 'javascript'),
    bKeySource: stripComments(b, 'javascript'),
  });
  assert.ok(d.ops.every(o => o.type === 'equal'));
});

test('end-to-end: real code edits still show among comment churn', () => {
  const a = 'run(1); // v1\n';
  const b = 'run(2); // v2\n';
  const d = computeDiff(a, b, {
    aKeySource: stripComments(a, 'javascript'),
    bKeySource: stripComments(b, 'javascript'),
  });
  assert.ok(d.ops.some(o => o.type !== 'equal'));
});
