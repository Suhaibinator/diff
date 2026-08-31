'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const hljs = require('../vendor/highlight.min.js');
const { stripComments, setCommentsHljsForTesting } = require('../src/js/comments.js');
const { computeDiff } = require('../src/js/diff-core.js');

setCommentsHljsForTesting(hljs);

// ── helpers ──

function lineCount(text) {
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

function src(lines) {
  return lines.join('\n') + '\n';
}

// Every fixture goes through strip(), so the line-count invariant is checked
// on all of them — including the multi-line block comments each language's
// main fixture carries.
function strip(text, lang) {
  const out = stripComments(text, lang);
  assert.notEqual(out, null, lang + ': expected a result, got null');
  assert.equal(out.length, lineCount(text), lang + ': line count must mirror the input');
  return out;
}

function assertCommentOnly(lang, a, b) {
  const d = computeDiff(a, b, {
    aKeySource: strip(a, lang),
    bKeySource: strip(b, lang),
  });
  assert.ok(d.ops.every(o => o.type === 'equal'),
    lang + ': a comment-only change should diff as all-equal');
}

function assertCodeEdit(lang, a, b) {
  const d = computeDiff(a, b, {
    aKeySource: strip(a, lang),
    bKeySource: strip(b, lang),
  });
  assert.ok(d.ops.some(o => o.type !== 'equal'),
    lang + ': a real code edit should still show');
}

function langTest(id, name, fn) {
  if (!hljs.getLanguage(id)) {
    test.skip(id + ': ' + name + ' (language not in this hljs build)', () => {});
    return;
  }
  test(id + ': ' + name, fn);
}

// ── javascript ──

langTest('javascript', 'residues, strings and template literals', () => {
  const text = src([
    'function go(n) {',
    '  let x = 1; // trailing',
    '  // whole line',
    '  const s = "// in string";',
    '  const t = `tpl // inside`;',
    '  const u = \'a // b\';',
    '  /* block',
    '     spans',
    '     lines */',
    '  return x + n;',
    '}',
  ]);
  assert.deepEqual(strip(text, 'javascript'), [
    'function go(n) {',
    '  let x = 1;',
    '',
    '  const s = "// in string";',
    '  const t = `tpl // inside`;',
    "  const u = 'a // b';",
    '',
    '',
    '',
    '  return x + n;',
    '}',
  ]);
});

langTest('javascript', 'mid-line block comments collapse, regex survives', () => {
  assert.deepEqual(strip('const v = 1 /* c */ + 2;\n', 'javascript'), ['const v = 1 + 2;']);
  assert.deepEqual(strip('x=1/* c */+2;\n', 'javascript'), ['x=1+2;']);
  assert.deepEqual(strip('const t = `a /* not */ b`;\n', 'javascript'), ['const t = `a /* not */ b`;']);
  // A regex literal full of slashes is hljs-regexp, not a comment.
  assert.deepEqual(strip('const re = /\\/\\//;\n', 'javascript'), ['const re = /\\/\\//;']);
  assert.deepEqual(strip('const q = a / b; // d\n', 'javascript'), ['const q = a / b;']);
});

langTest('javascript', 'end-to-end diff', () => {
  const a = src([
    'function go() {',
    '  run(); // start',
    '  // old note',
    '  /* stale block */',
    '  stop();',
    '}',
  ]);
  const b = src([
    'function go() {',
    '  run(); // begin',
    '  stop();',
    '}',
  ]);
  assertCommentOnly('javascript', a, b);
  assertCodeEdit('javascript', a, src([
    'function go() {',
    '  run(1); // begin',
    '  stop();',
    '}',
  ]));
});

// ── typescript ──

langTest('typescript', 'residues, strings and template literals', () => {
  const text = src([
    'interface I { n: number; }',
    'let x: number = 1; // trailing',
    '// whole line',
    'const s: string = "// in string";',
    'const t = `tpl // inside`;',
    '/* block',
    '   spans',
    '   lines */',
    'const b: number = 2;',
  ]);
  assert.deepEqual(strip(text, 'typescript'), [
    'interface I { n: number; }',
    'let x: number = 1;',
    '',
    'const s: string = "// in string";',
    'const t = `tpl // inside`;',
    '',
    '',
    '',
    'const b: number = 2;',
  ]);
});

langTest('typescript', 'TSDoc doctags and triple-slash directives go entirely', () => {
  const text = src([
    'before();',
    '/**',
    ' * @param x thing',
    ' * @returns nothing',
    ' */',
    '/// <reference path="a.d.ts" />',
    'function f(x: number): void {}',
  ]);
  assert.deepEqual(strip(text, 'typescript'), [
    'before();', '', '', '', '', '', 'function f(x: number): void {}',
  ]);
});

langTest('typescript', 'end-to-end diff', () => {
  const a = src([
    'function go(n: number): number {',
    '  /** @param n count */',
    '  return n + 1; // add',
    '}',
  ]);
  const b = src([
    'function go(n: number): number {',
    '  return n + 1; // increment',
    '}',
  ]);
  assertCommentOnly('typescript', a, b);
  assertCodeEdit('typescript', a, src([
    'function go(n: number): number {',
    '  return n + 2; // increment',
    '}',
  ]));
});

// ── c ──

langTest('c', 'residues, strings and preprocessor lines', () => {
  const text = src([
    '#include <stdio.h>',
    '#define X 1 // note',
    'int x = 1; // trailing',
    '// whole line',
    'const char *s = "// in string";',
    'const char *b = "/* also in string */";',
    '/* block',
    '   spans',
    '   lines */',
    'int main(void) { return 0; }',
  ]);
  assert.deepEqual(strip(text, 'c'), [
    '#include <stdio.h>',
    '#define X 1',
    'int x = 1;',
    '',
    'const char *s = "// in string";',
    'const char *b = "/* also in string */";',
    '',
    '',
    '',
    'int main(void) { return 0; }',
  ]);
});

langTest('c', 'block comments do not nest — the first */ closes them', () => {
  assert.deepEqual(strip('int v = 1 /* c */ + 2;\n', 'c'), ['int v = 1 + 2;']);
  // C has no nested block comments, and hljs models that: the inner /* is just
  // text, the first */ ends the comment, and " still */" survives as code.
  assert.deepEqual(
    strip('int a = 1; /* outer /* inner */ still */ int b = 2;\n', 'c'),
    ['int a = 1; still */ int b = 2;']);
  // Same across lines. Line 3 keeps a leading space: the whitespace-collapse
  // rule only fires when the text already emitted on this line ends in
  // whitespace, and here the comment ended before anything was emitted.
  assert.deepEqual(strip(src([
    'int a = 1;',
    '/* outer',
    '  /* inner',
    '  */ still outer',
    '*/',
    'int b = 2;',
  ]), 'c'), ['int a = 1;', '', '', ' still outer', '*/', 'int b = 2;']);
});

langTest('c', 'a // comment continued with a backslash keeps swallowing', () => {
  assert.deepEqual(strip(src([
    'int a = 1; // cont \\',
    'still comment',
    'int b = 2;',
  ]), 'c'), ['int a = 1;', '', 'int b = 2;']);
});

langTest('c', 'end-to-end diff', () => {
  const a = src([
    'int add(int a, int b) {',
    '  /* sums them */',
    '  return a + b; // sum',
    '}',
  ]);
  const b = src([
    'int add(int a, int b) {',
    '  return a + b; // total',
    '}',
  ]);
  assertCommentOnly('c', a, b);
  assertCodeEdit('c', a, src([
    'int add(int a, int b) {',
    '  return a - b; // total',
    '}',
  ]));
});

// ── cpp ──

langTest('cpp', 'residues, strings, raw strings and doc comments', () => {
  const text = src([
    '#include <string>',
    '#define X 1 // note',
    'int x = 1; // trailing',
    '// whole line',
    'const char *s = "// in string";',
    'auto r = R"(raw // not /* c */)";',
    '/// brief doc',
    '/** @brief thing',
    ' *  @param x v',
    ' */',
    'void f(int x);',
  ]);
  assert.deepEqual(strip(text, 'cpp'), [
    '#include <string>',
    '#define X 1',
    'int x = 1;',
    '',
    'const char *s = "// in string";',
    'auto r = R"(raw // not /* c */)";',
    '', '', '', '',
    'void f(int x);',
  ]);
});

langTest('cpp', 'block comments do not nest', () => {
  assert.deepEqual(strip('int v = 1 /* c */ + 2;\n', 'cpp'), ['int v = 1 + 2;']);
  assert.deepEqual(
    strip('int a = 1; /* outer /* inner */ still */ int b = 2;\n', 'cpp'),
    ['int a = 1; still */ int b = 2;']);
});

langTest('cpp', 'end-to-end diff', () => {
  const a = src([
    'int add(int a, int b) {',
    '  // adds',
    '  return a + b; /* sum */',
    '}',
  ]);
  const b = src([
    'int add(int a, int b) {',
    '  return a + b; /* total */',
    '}',
  ]);
  assertCommentOnly('cpp', a, b);
  assertCodeEdit('cpp', a, src([
    'int add(int a, int b) {',
    '  return b + a * 2; /* total */',
    '}',
  ]));
});

// ── java ──

langTest('java', 'residues, strings, char literals and text blocks', () => {
  const text = src([
    'class A {',
    '  int x = 1; // trailing',
    '  // whole line',
    '  String s = "// in string";',
    '  String b = "/* also */";',
    "  char c = '/';",
    '  String t = """',
    '  // not a comment',
    '  """;',
    '  /* block',
    '     spans',
    '     lines */',
    '  int y = 2;',
    '}',
  ]);
  assert.deepEqual(strip(text, 'java'), [
    'class A {',
    '  int x = 1;',
    '',
    '  String s = "// in string";',
    '  String b = "/* also */";',
    "  char c = '/';",
    '  String t = """',
    '  // not a comment',   // text blocks are hljs-string, so this survives
    '  """;',
    '', '', '',
    '  int y = 2;',
    '}',
  ]);
});

langTest('java', 'javadoc including @param doctags is removed whole', () => {
  const text = src([
    'void before() {}',
    '/**',
    ' * Does a thing.',
    ' * @param x the thing',
    ' * @return nothing',
    ' */',
    '@Override // note',
    'void after(int x) {}',
  ]);
  assert.deepEqual(strip(text, 'java'), [
    'void before() {}', '', '', '', '', '', '@Override', 'void after(int x) {}',
  ]);
  assert.deepEqual(strip('int v = 1 /* c */ + 2;\n', 'java'), ['int v = 1 + 2;']);
  assert.deepEqual(strip('    int x = 1;    // note\n', 'java'), ['    int x = 1;']);
});

langTest('java', 'end-to-end diff', () => {
  const a = src([
    'class A {',
    '  /**',
    '   * @param n count',
    '   */',
    '  int go(int n) { return n + 1; } // add',
    '}',
  ]);
  const b = src([
    'class A {',
    '  int go(int n) { return n + 1; } // increment',
    '}',
  ]);
  assertCommentOnly('java', a, b);
  assertCodeEdit('java', a, src([
    'class A {',
    '  int go(int n) { return n + 2; } // increment',
    '}',
  ]));
});

// ── csharp ──

langTest('csharp', 'residues, verbatim, interpolated and raw strings', () => {
  const text = src([
    'class A {',
    '  int x = 1; // trailing',
    '  // whole line',
    '  string s = "// in string";',
    '  string v = @"C:\\a // b";',
    '  string q = @"a "" // b";',
    '  string i = $"{x} // y";',
    '  /* block',
    '     spans',
    '     lines */',
    '  int y = 2;',
    '}',
  ]);
  assert.deepEqual(strip(text, 'csharp'), [
    'class A {',
    '  int x = 1;',
    '',
    '  string s = "// in string";',
    '  string v = @"C:\\a // b";',
    '  string q = @"a "" // b";',
    '  string i = $"{x} // y";',
    '', '', '',
    '  int y = 2;',
    '}',
  ]);
});

langTest('csharp', '/// XML doc comments including tags are removed whole', () => {
  const text = src([
    'void Before() {}',
    '/// <summary>',
    '/// Does a thing.',
    '/// </summary>',
    '/// <param name="x">v</param>',
    'void After(int x) {}',
  ]);
  assert.deepEqual(strip(text, 'csharp'), [
    'void Before() {}', '', '', '', '', 'void After(int x) {}',
  ]);
});

langTest('csharp', 'trailing comments on #region / #pragma survive', () => {
  // known hljs behavior: csharp swallows a whole preprocessor line into one
  // hljs-meta span with no hljs-comment inside, so the trailing // is kept as
  // code. C, C++ and Objective-C do mark the comment inside #define, so
  // `#define X 1 // note` strips there but `#region X // note` does not here.
  assert.deepEqual(strip('#region Stuff // note\n', 'csharp'), ['#region Stuff // note']);
  assert.deepEqual(strip('#pragma warning disable 1591 // note\n', 'csharp'),
    ['#pragma warning disable 1591 // note']);
});

langTest('csharp', 'end-to-end diff', () => {
  const a = src([
    'class A {',
    '  /// <summary>Adds.</summary>',
    '  int Go(int n) { return n + 1; } // add',
    '}',
  ]);
  const b = src([
    'class A {',
    '  int Go(int n) { return n + 1; } // increment',
    '}',
  ]);
  assertCommentOnly('csharp', a, b);
  assertCodeEdit('csharp', a, src([
    'class A {',
    '  int Go(int n) { return n * 2; } // increment',
    '}',
  ]));
});

// ── go ──

langTest('go', 'residues, backtick raw strings and build tags', () => {
  const text = src([
    '//go:build linux',
    '',
    'package main',
    'var x = 1 // trailing',
    '// whole line',
    'var s = "// in string"',
    'var r = `raw // not a comment`',
    "var c = '/'",
    '/* block',
    '   spans',
    '   lines */',
    'func main() {}',
  ]);
  assert.deepEqual(strip(text, 'go'), [
    '',
    '',
    'package main',
    'var x = 1',
    '',
    'var s = "// in string"',
    'var r = `raw // not a comment`',
    "var c = '/'",
    '', '', '',
    'func main() {}',
  ]);
});

langTest('go', 'multi-line raw strings keep their comment markers', () => {
  assert.deepEqual(strip(src([
    'var r = `line1 // a',
    'line2 /* b */',
    '`',
    'var x = 2',
  ]), 'go'), ['var r = `line1 // a', 'line2 /* b */', '`', 'var x = 2']);
  assert.deepEqual(strip('\tx := 1 // c\n\t// whole\n', 'go'), ['\tx := 1', '']);
});

langTest('go', 'end-to-end diff', () => {
  const a = src([
    'package main',
    '',
    'func add(a, b int) int {',
    '\t// adds them',
    '\treturn a + b // sum',
    '}',
  ]);
  const b = src([
    'package main',
    '',
    'func add(a, b int) int {',
    '\treturn a + b // total',
    '}',
  ]);
  assertCommentOnly('go', a, b);
  assertCodeEdit('go', a, src([
    'package main',
    '',
    'func add(a, b int) int {',
    '\treturn a - b // total',
    '}',
  ]));
});

// ── rust ──

langTest('rust', 'residues, raw strings, doc comments and attributes', () => {
  const text = src([
    '#[doc = "// x"]',
    '//! inner doc',
    '/// outer doc',
    'let x = 1; // trailing',
    '// whole line',
    'let s = "// in string";',
    'let r = r#"raw // here"#;',
    '/* block',
    '   spans',
    '   lines */',
    'fn f() {}',
  ]);
  assert.deepEqual(strip(text, 'rust'), [
    '#[doc = "// x"]',
    '', '',
    'let x = 1;',
    '',
    'let s = "// in string";',
    'let r = r#"raw // here"#;',
    '', '', '',
    'fn f() {}',
  ]);
});

langTest('rust', 'block comments nest — the outer one runs to its own close', () => {
  // Rust nests block comments and hljs models it with a nested hljs-comment
  // span, so everything up to the final */ goes, unlike C above.
  assert.deepEqual(
    strip('let a = 1; /* outer /* inner */ still */ let b = 2;\n', 'rust'),
    ['let a = 1; let b = 2;']);
  assert.deepEqual(strip(src([
    'let a = 1;',
    '/* outer',
    '  /* inner',
    '  */ still outer',
    '*/',
    'let b = 2;',
  ]), 'rust'), ['let a = 1;', '', '', '', '', 'let b = 2;']);
});

langTest('rust', 'end-to-end diff', () => {
  const a = src([
    'fn add(a: i32, b: i32) -> i32 {',
    '    /// adds',
    '    /* outer /* inner */ still */',
    '    a + b // sum',
    '}',
  ]);
  const b = src([
    'fn add(a: i32, b: i32) -> i32 {',
    '    a + b // total',
    '}',
  ]);
  assertCommentOnly('rust', a, b);
  assertCodeEdit('rust', a, src([
    'fn add(a: i32, b: i32) -> i32 {',
    '    a - b // total',
    '}',
  ]));
});

// ── kotlin ──

langTest('kotlin', 'residues, raw strings and template strings', () => {
  const text = src([
    '@JvmStatic // note',
    'val x = 1 // trailing',
    '// whole line',
    'val s = "// in string"',
    'val t = """raw // here"""',
    'val u = "$x // y"',
    '/* block',
    '   spans',
    '   lines */',
    'fun f() {}',
  ]);
  assert.deepEqual(strip(text, 'kotlin'), [
    '@JvmStatic',
    'val x = 1',
    '',
    'val s = "// in string"',
    'val t = """raw // here"""',
    'val u = "$x // y"',
    '', '', '',
    'fun f() {}',
  ]);
});

langTest('kotlin', 'block comments nest, KDoc goes whole', () => {
  // Kotlin nests block comments and hljs models it, so the trailing */ closes
  // the outer comment rather than leaving " still */" behind as C does.
  assert.deepEqual(
    strip('val a = 1 /* outer /* inner */ still */ val b = 2\n', 'kotlin'),
    ['val a = 1 val b = 2']);
  assert.deepEqual(strip(src([
    'val a = 1',
    '/* outer',
    '  /* inner',
    '  */ still outer',
    '*/',
    'val b = 2',
  ]), 'kotlin'), ['val a = 1', '', '', '', '', 'val b = 2']);
  assert.deepEqual(strip(src([
    '/**',
    ' * @param x thing',
    ' */',
    'fun f(x: Int) {}',
  ]), 'kotlin'), ['', '', '', 'fun f(x: Int) {}']);
});

langTest('kotlin', 'end-to-end diff', () => {
  const a = src([
    'fun add(a: Int, b: Int): Int {',
    '    /** @param a first */',
    '    return a + b // sum',
    '}',
  ]);
  const b = src([
    'fun add(a: Int, b: Int): Int {',
    '    return a + b // total',
    '}',
  ]);
  assertCommentOnly('kotlin', a, b);
  assertCodeEdit('kotlin', a, src([
    'fun add(a: Int, b: Int): Int {',
    '    return a - b // total',
    '}',
  ]));
});

// ── swift ──

langTest('swift', 'residues, interpolation and multi-line strings', () => {
  const text = src([
    '#if DEBUG // note',
    'let x = 1 // trailing',
    '// whole line',
    'let s = "// in string"',
    'let i = "\\(x) // y"',
    'let m = """',
    '// not a comment',
    '"""',
    '/* block',
    '   spans',
    '   lines */',
    '#endif',
  ]);
  assert.deepEqual(strip(text, 'swift'), [
    '#if DEBUG',
    'let x = 1',
    '',
    'let s = "// in string"',
    'let i = "\\(x) // y"',
    'let m = """',
    '// not a comment',   // multi-line strings are hljs-string, so this survives
    '"""',
    '', '', '',
    '#endif',
  ]);
});

langTest('swift', 'block comments nest, /// doc lines go whole', () => {
  // Swift nests block comments and hljs models it, so nothing survives here
  // (contrast the C fixture, which leaves " still */").
  assert.deepEqual(
    strip('let a = 1 /* outer /* inner */ still */ let b = 2\n', 'swift'),
    ['let a = 1 let b = 2']);
  assert.deepEqual(strip(src([
    'let a = 1',
    '/* outer',
    '  /* inner',
    '  */ still outer',
    '*/',
    'let b = 2',
  ]), 'swift'), ['let a = 1', '', '', '', '', 'let b = 2']);
  assert.deepEqual(strip(src([
    '/// A doc line',
    '/// - Parameter x: v',
    'func f(x: Int) {}',
  ]), 'swift'), ['', '', 'func f(x: Int) {}']);
});

langTest('swift', 'end-to-end diff', () => {
  const a = src([
    'func add(a: Int, b: Int) -> Int {',
    '    /// adds',
    '    return a + b // sum',
    '}',
  ]);
  const b = src([
    'func add(a: Int, b: Int) -> Int {',
    '    return a + b // total',
    '}',
  ]);
  assertCommentOnly('swift', a, b);
  assertCodeEdit('swift', a, src([
    'func add(a: Int, b: Int) -> Int {',
    '    return a - b // total',
    '}',
  ]));
});

// ── objectivec ──

langTest('objectivec', 'residues, #import lines and @"" strings', () => {
  const text = src([
    '#import <Foundation/Foundation.h>',
    '#import "My // Header.h"',
    '#define X 1 // note',
    '#pragma mark - Section // n',
    'int x = 1; // trailing',
    '// whole line',
    'NSString *s = @"// in string";',
    'NSString *b = @"/* not */";',
    '/* block',
    '   spans',
    '   lines */',
    'int y = 2;',
  ]);
  assert.deepEqual(strip(text, 'objectivec'), [
    '#import <Foundation/Foundation.h>',
    '#import "My // Header.h"',
    '#define X 1',
    '#pragma mark - Section',
    'int x = 1;',
    '',
    'NSString *s = @"// in string";',
    'NSString *b = @"/* not */";',
    '', '', '',
    'int y = 2;',
  ]);
});

langTest('objectivec', 'a trailing comment after an angle-bracket #import survives', () => {
  // known hljs behavior: objectivec runs the <...> include path as an
  // hljs-string that swallows the rest of the line, so the trailing comment is
  // kept as code. The quoted form on the same line does get its comment
  // stripped (see `#define X 1 // note` above), so this is inconsistent.
  assert.deepEqual(strip('#import <A/B.h> // note\n', 'objectivec'),
    ['#import <A/B.h> // note']);
});

langTest('objectivec', 'block comments do not nest', () => {
  assert.deepEqual(strip('int v = 1 /* c */ + 2;\n', 'objectivec'), ['int v = 1 + 2;']);
  assert.deepEqual(
    strip('int a = 1; /* outer /* inner */ still */ int b = 2;\n', 'objectivec'),
    ['int a = 1; still */ int b = 2;']);
});

langTest('objectivec', 'end-to-end diff', () => {
  const a = src([
    '@implementation A',
    '/* adds them */',
    '- (int)add:(int)x to:(int)y { return x + y; } // sum',
    '@end',
  ]);
  const b = src([
    '@implementation A',
    '- (int)add:(int)x to:(int)y { return x + y; } // total',
    '@end',
  ]);
  assertCommentOnly('objectivec', a, b);
  assertCodeEdit('objectivec', a, src([
    '@implementation A',
    '- (int)add:(int)x to:(int)y { return x - y; } // total',
    '@end',
  ]));
});
