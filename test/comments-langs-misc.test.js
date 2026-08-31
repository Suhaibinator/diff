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

// Every fixture here asserts the contract that callers index on: one output
// line per input line, trailing-newline aware.
function assertLineInvariant(text, lang) {
  const out = stripComments(text, lang);
  assert.notEqual(out, null);
  assert.equal(out.length, lineCount(text));
  return out;
}

function keyed(a, b, lang, opts) {
  return computeDiff(a, b, Object.assign({
    aKeySource: stripComments(a, lang),
    bKeySource: stripComments(b, lang),
  }, opts || {}));
}

function allEqual(d) {
  return d.ops.every(o => o.type === 'equal');
}

// ── Data / pseudo languages ──────────────────────────────────────────────────

test('plaintext strips nothing (null, not a pass-through array)', () => {
  assert.equal(stripComments('hello // world\n', 'plaintext'), null);
  assert.equal(stripComments('', 'plaintext'), null);
});

test('json strips // and /* */ comments', () => {
  if (!hljs.getLanguage('json')) return;
  // known hljs behavior: hljs's json grammar accepts JSONC-style comments, so
  // `//` and `/* */` are stripped even though strict JSON has no comments.
  const out = assertLineInvariant('{\n  "a": 1, // c\n  "b": "// not"\n}\n', 'json');
  assert.deepEqual(out, ['{', '  "a": 1,', '  "b": "// not"', '}']);

  const blk = assertLineInvariant('{\n  "a": 1,\n  /* blk */\n  "b": 2\n}\n', 'json');
  assert.equal(blk[2], '');

  // Comment-free JSON round-trips byte for byte.
  assert.deepEqual(stripComments('{"a": [1, 2], "b": null}\n', 'json'),
    ['{"a": [1, 2], "b": null}']);
});

test('json comment-only change diffs as unchanged', () => {
  if (!hljs.getLanguage('json')) return;
  const a = '{\n  "a": 1, // old\n  "b": 2\n}\n';
  const b = '{\n  "a": 1, // new\n  "b": 2\n}\n';
  assert.ok(allEqual(keyed(a, b, 'json')));
});

test('diff language: ---/+++ headers are scoped as comments', () => {
  if (!hljs.getLanguage('diff')) return;
  // known hljs behavior: the diff grammar tags the `---`/`+++` file headers
  // with hljs-comment, so stripping erases them; hunk headers and +/- body
  // lines survive untouched.
  const out = assertLineInvariant('--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n-old // c\n+new // c\n', 'diff');
  assert.deepEqual(out, ['', '', '@@ -1,2 +1,2 @@', '-old // c', '+new // c']);
});

test('diff language: a header-only change reads as unchanged', () => {
  if (!hljs.getLanguage('diff')) return;
  // Direct consequence of the header-as-comment scoping above.
  const a = '--- a/old.txt\n+++ b/old.txt\n@@ -1 +1 @@\n-x\n+y\n';
  const b = '--- a/new.txt\n+++ b/new.txt\n@@ -1 +1 @@\n-x\n+y\n';
  assert.ok(allEqual(keyed(a, b, 'diff')));
});

// ── Per-language smoke fixtures ──────────────────────────────────────────────

test('lua: -- line and --[[ ]] block comments', () => {
  if (!hljs.getLanguage('lua')) return;
  const out = assertLineInvariant(
    'local x = 1 -- note\n--[[ block\ncomment ]]\nprint("-- not")\n', 'lua');
  assert.deepEqual(out, ['local x = 1', '', '', 'print("-- not")']);
  assert.ok(allEqual(keyed('local x = 1 -- old\n', 'local x = 1 -- new\n', 'lua')));
});

test('r: # comments', () => {
  if (!hljs.getLanguage('r')) return;
  const out = assertLineInvariant('x <- 1  # note\n# whole line\ny <- "# not"\n', 'r');
  assert.deepEqual(out, ['x <- 1', '', 'y <- "# not"']);
  assert.ok(allEqual(keyed('x <- 1  # old\n', 'x <- 1 # new\n', 'r')));
});

test('vbnet: apostrophe and REM comments', () => {
  if (!hljs.getLanguage('vbnet')) return;
  const out = assertLineInvariant(
    "Dim x = 1 ' note\n' whole line\nREM old style\nDim s = \"' not\"\n", 'vbnet');
  assert.deepEqual(out, ['Dim x = 1', '', '', 'Dim s = "\' not"']);
  assert.ok(allEqual(keyed("Dim x = 1 ' old\n", "Dim x = 1 ' new\n", 'vbnet')));
});

test('wasm: ;; line and (; ;) block comments', () => {
  if (!hljs.getLanguage('wasm')) return;
  const out = assertLineInvariant('(module\n  ;; a comment\n  (func $f) ;; trailing\n)\n', 'wasm');
  assert.deepEqual(out, ['(module', '', '  (func $f)', ')']);
  assert.deepEqual(stripComments('(module\n  (;block\n  comment;)\n)\n', 'wasm'),
    ['(module', '', '', ')']);
  assert.ok(allEqual(keyed('(func $f) ;; old\n', '(func $f) ;; new\n', 'wasm')));
});

// ── Adversarial shapes ───────────────────────────────────────────────────────

test('a file of nothing but comments strips to all-blank lines', () => {
  const out = assertLineInvariant('// one\n// two\n// three\n', 'javascript');
  assert.deepEqual(out, ['', '', '']);
  // Indentation before a whole-line comment goes with it.
  assert.deepEqual(stripComments('  // one\n\t// two\n', 'javascript'), ['', '']);
});

test('comment-only file vs a shorter comment-only file merges to all-equal', () => {
  const a = '// one\n// two\n// three\n';
  const b = '// ONE changed\n';
  const d = keyed(a, b, 'javascript');
  assert.ok(allEqual(d));
  // Surplus comment lines become one-sided equal ops (oldIdx only).
  assert.deepEqual(d.ops, [
    { type: 'equal', oldIdx: 0, newIdx: 0 },
    { type: 'equal', oldIdx: 1 },
    { type: 'equal', oldIdx: 2 },
  ]);
});

test('comment-only file vs a lone blank line merges to all-equal', () => {
  const d = keyed('// one\n// two\n// three\n', '\n', 'javascript');
  assert.ok(allEqual(d));
});

test('a file that is one giant block comment', () => {
  const text = '/*\n * alpha\n * beta\n * gamma\n */\n';
  assert.deepEqual(assertLineInvariant(text, 'javascript'), ['', '', '', '', '']);
  // Same without a trailing newline.
  assert.deepEqual(stripComments('/*\n * only\n * this\n */', 'javascript'), ['', '', '', '']);

  const other = '/*\n * totally different\n */\nrun();\n';
  assert.ok(allEqual(keyed(text + 'run();\n', other, 'javascript')));
});

test('CRLF: line count holds and the CR survives outside comments', () => {
  // known hljs behavior: the \r sits OUTSIDE the comment span, so a comment
  // that ends a line drops it along with the preceding whitespace, while an
  // untouched line keeps its \r.
  assert.deepEqual(assertLineInvariant('var a = 1; // c\r\nvar b = 2;\r\n', 'javascript'),
    ['var a = 1;', 'var b = 2;\r']);
  assert.deepEqual(stripComments('var a = 1; // c\r\nvar b = 2;', 'javascript'),
    ['var a = 1;', 'var b = 2;']);
  // A mid-line block comment collapses but leaves the trailing CR in place.
  assert.deepEqual(stripComments('x = 1 /* c */ + 2;\r\ny = 3;\r\n', 'javascript'),
    ['x = 1 + 2;\r', 'y = 3;\r']);
  // known hljs behavior: a whole-line comment strips to a bare '\r', not '',
  // because nothing precedes the CR for the trailing-trim rule to bite on.
  assert.deepEqual(stripComments('/* a\r\nb */\r\nz();\r\n', 'javascript'),
    ['', '\r', 'z();\r']);
  assert.deepEqual(stripComments('a();\r\n\r\n// c\r\nb();', 'javascript'),
    ['a();\r', '\r', '\r', 'b();']);
});

test('CRLF: a comment-only change still diffs as unchanged', () => {
  // The residual '\r' is all-whitespace, so commentKeySource normalizes it to
  // '' and the line is still recognized as a dropped comment line.
  assert.ok(allEqual(keyed('run();\r\n// old note\r\nstop();\r\n', 'run();\r\nstop();\r\n', 'javascript')));
  assert.ok(allEqual(keyed('run();\t// old\r\nkeep();\r\n', 'run(); // new\r\nkeep();\r\n', 'javascript')));
});

test('unicode inside and outside comments', () => {
  const out = assertLineInvariant(
    'const s = "héllo 🎉 世界"; // 注释 🚀\nconst t = "日本語";\n', 'javascript');
  assert.deepEqual(out, ['const s = "héllo 🎉 世界";', 'const t = "日本語";']);
  assert.deepEqual(stripComments('// 🚀🎉 emoji comment\nrun();\n', 'javascript'), ['', 'run();']);
  assert.ok(allEqual(keyed(
    'const s = "世界 🎉"; // 古いメモ\n',
    'const s = "世界 🎉"; // new note 🚀\n', 'javascript')));
});

test('HTML-entity-sensitive code round-trips exactly', () => {
  assert.deepEqual(stripComments('if (a && b < c || d > e) { f("&amp;&lt;"); } // x < y && z\n', 'javascript'),
    ['if (a && b < c || d > e) { f("&amp;&lt;"); }']);
  assert.deepEqual(stripComments('const s = "a & b < c > d \\" e \' f"; // <&>\n', 'javascript'),
    ['const s = "a & b < c > d \\" e \' f";']);
});

test('total garbage under a real language id does not throw', () => {
  const garbage = '  ???? }}}{{{ /* unterminated\n<<<>>>&&&&"""\'\'\'\n\\\\\\ ###\n@@!!~~\n';
  for (const lang of ['javascript', 'python', 'xml', 'json', 'lua', 'r', 'vbnet', 'wasm', 'diff']) {
    if (!hljs.getLanguage(lang)) continue;
    assert.doesNotThrow(() => stripComments(garbage, lang), lang);
    assertLineInvariant(garbage, lang);
  }
  // known hljs behavior: with ignoreIllegals, an unterminated /* swallows the
  // rest of the file in C-like grammars (javascript, json here).
  assert.deepEqual(stripComments(garbage, 'javascript'), ['  ???? }}}{{{', '', '', '']);
  // Grammars without /* */ leave the same bytes untouched.
  assert.deepEqual(stripComments(garbage, 'python'), garbage.replace(/\n$/, '').split('\n'));
});

// ── Interaction with the other diff options ──────────────────────────────────

const IW_A = 'function go() {\n  run(); // start\n  // old note\n  stop();\n}\n';
const IW_B = 'function go() {\n  run(); // begin\n  stop();\n}\n';

for (const mode of ['none', 'trim', 'all']) {
  test(`comment-only change stays all-equal under ignoreWhitespace '${mode}'`, () => {
    const d = keyed(IW_A, IW_B, 'javascript', { ignoreWhitespace: mode });
    assert.ok(allEqual(d), JSON.stringify(d.ops));
    assert.equal(d.ops.length, 5); // 4 old lines paired + 1 one-sided dropped comment
    assert.deepEqual(d.ops[2], { type: 'equal', oldIdx: 2 });
  });
}

test("indentation change plus comment change: visible under 'none', equal under 'trim'/'all'", () => {
  const a = 'function f() {\n    run();   // old\n}\n';
  const b = 'function f() {\n  run(); // new\n}\n';
  assert.ok(!allEqual(keyed(a, b, 'javascript', { ignoreWhitespace: 'none' })));
  assert.ok(allEqual(keyed(a, b, 'javascript', { ignoreWhitespace: 'trim' })));
  assert.ok(allEqual(keyed(a, b, 'javascript', { ignoreWhitespace: 'all' })));
});

test('comment-only change with ignoreCase', () => {
  assert.ok(allEqual(keyed('Run(); // Note\n', 'Run(); // NOTE different\n', 'javascript',
    { ignoreCase: true })));
  assert.ok(allEqual(keyed(IW_A, IW_B, 'javascript', { ignoreCase: true })));
  // ignoreCase also folds the surviving code, as it does without a key source.
  assert.ok(allEqual(keyed('RUN(); // Note\n', 'run(); // NOTE\n', 'javascript',
    { ignoreCase: true })));
});

test('detectMoves tags a relocated line whose comment changed', () => {
  const a = 'alphaFunction(1); // note A\nbetaFunction(2);\nfiller1();\nfiller2();\n';
  const b = 'filler1();\nfiller2();\nalphaFunction(1); // note B\nbetaFunction(2);\n';
  const d = keyed(a, b, 'javascript', { detectMoves: true });
  assert.ok(d.ops.some(o => o.moveId != null), JSON.stringify(d.ops));
  const del = d.ops.find(o => o.type === 'delete' && o.moveId != null);
  const ins = d.ops.find(o => o.type === 'insert' && o.moveId != null);
  assert.ok(del && ins);
  assert.equal(del.moveId, ins.moveId);
  assert.equal(del.moveTo, ins.newIdx);
  assert.equal(ins.moveFrom, del.oldIdx);
});
