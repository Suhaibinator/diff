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

// The contract every language must honour: one output line per input line.
function assertLineInvariant(text, lang) {
  const out = stripComments(text, lang);
  assert.notEqual(out, null, `no hljs output for ${lang}`);
  assert.equal(out.length, lineCount(text));
  return out;
}

// Comment-only edits collapse to nothing once keySources are supplied.
function assertAllEqual(a, b, lang) {
  const d = computeDiff(a, b, {
    aKeySource: stripComments(a, lang),
    bKeySource: stripComments(b, lang),
  });
  assert.ok(d.ops.every(o => o.type === 'equal'),
    `${lang}: expected all-equal, got ${d.ops.map(o => o.type).join(',')}`);
}

// A real content edit must survive comment stripping.
function assertHasChange(a, b, lang) {
  const d = computeDiff(a, b, {
    aKeySource: stripComments(a, lang),
    bKeySource: stripComments(b, lang),
  });
  assert.ok(d.ops.some(o => o.type !== 'equal'), `${lang}: expected a change`);
}

// ── xml / html ──────────────────────────────────────────────────────────────

if (!hljs.getLanguage('xml')) {
  test.skip('xml unavailable', () => {});
} else {
  test('xml: line-count invariant', () => {
    assertLineInvariant('<a>\n  <!-- c -->\n  <b/>\n</a>\n', 'xml');
    assertLineInvariant('<a>\n  <!-- one\n       two -->\n</a>', 'xml'); // no trailing newline
    assertLineInvariant('<a><!-- x --></a>', 'xml');
  });

  test('xml: comments stripped, markers inside attributes kept', () => {
    const out = stripComments([
      '<root>',
      '  <!-- whole line comment -->',
      '  <item id="1">text</item> <!-- trailing -->',
      '  <item name="a <!-- not a comment --> b">v</item>',
      '</root>',
      ''].join('\n'), 'xml');
    assert.equal(out[0], '<root>');
    assert.equal(out[1], '');                                    // whole-line comment
    assert.equal(out[2], '  <item id="1">text</item>');          // trailing comment
    assert.equal(out[3], '  <item name="a <!-- not a comment --> b">v</item>');
    assert.equal(out[4], '</root>');
  });

  test('xml: <!-- --> spanning multiple lines', () => {
    const out = stripComments('<a>\n  <!-- line one\n       line two -->\n  <b/>\n</a>\n', 'xml');
    assert.deepEqual(out, ['<a>', '', '', '  <b/>', '</a>']);
  });

  test('xml: comment between markup on one line collapses', () => {
    const out = stripComments('<a><!-- gone --><b/></a>\n', 'xml');
    assert.equal(out[0], '<a><b/></a>');
  });

  test('html id maps to the xml grammar', () => {
    const out = stripComments([
      '<!DOCTYPE html>',
      '<html>',
      '<body>',
      '  <!-- nav goes here -->',
      '  <div class="x"><!-- inline --></div>',
      '  <p data-tip="<!-- fake -->">hi</p>',
      '</body>',
      '</html>',
      ''].join('\n'), 'html');
    assert.equal(out.length, 8);
    assert.equal(out[0], '<!DOCTYPE html>');  // doctype is not a comment
    assert.equal(out[3], '');
    assert.equal(out[4], '  <div class="x"></div>');
    assert.equal(out[5], '  <p data-tip="<!-- fake -->">hi</p>');
  });

  test('xml end-to-end', () => {
    const a = '<root>\n  <!-- old note -->\n  <item id="1"/> <!-- keep -->\n</root>\n';
    const b = '<root>\n  <!-- brand new note -->\n  <item id="1"/>\n</root>\n';
    assertAllEqual(a, b, 'xml');
    assertHasChange(a, '<root>\n  <!-- old note -->\n  <item id="2"/>\n</root>\n', 'xml');
  });
}

// ── css ─────────────────────────────────────────────────────────────────────

if (!hljs.getLanguage('css')) {
  test.skip('css unavailable', () => {});
} else {
  test('css: line-count invariant', () => {
    assertLineInvariant('/* c */\n.a { color: red; }\n', 'css');
    assertLineInvariant('.a {\n  /* one\n     two */\n}', 'css');
  });

  test('css: /* */ stripped, marker inside a string kept', () => {
    const out = stripComments([
      '/* header rule */',
      '.a {',
      '  color: red; /* trailing */',
      '  content: "/* not a comment */";',
      '}',
      ''].join('\n'), 'css');
    assert.equal(out[0], '');
    assert.equal(out[1], '.a {');
    assert.equal(out[2], '  color: red;');
    assert.equal(out[3], '  content: "/* not a comment */";');
    assert.equal(out[4], '}');
  });

  test('css: block comment spanning lines', () => {
    const out = stripComments('.a {\n  /* one\n     two */\n  color: blue;\n}\n', 'css');
    assert.deepEqual(out, ['.a {', '', '', '  color: blue;', '}']);
  });

  test('css: mid-declaration comment collapses whitespace', () => {
    const out = stripComments('.a { color: /* why */ red; }\n', 'css');
    assert.equal(out[0], '.a { color: red; }');
  });

  test('css: // is not a css comment and survives', () => {
    // known hljs behavior: plain CSS has no line-comment form, so `//` is left
    // in place (unlike scss/less below).
    const out = stripComments('.a {\n  color: red; // not css comment\n}\n', 'css');
    assert.equal(out[1], '  color: red; // not css comment');
  });

  test('css end-to-end', () => {
    const a = '/* v1 */\n.a { color: red; /* keep */ }\n';
    const b = '/* v2 rewritten */\n.a { color: red; }\n';
    assertAllEqual(a, b, 'css');
    assertHasChange(a, '/* v1 */\n.a { color: blue; }\n', 'css');
  });
}

// ── scss ────────────────────────────────────────────────────────────────────

if (!hljs.getLanguage('scss')) {
  test.skip('scss unavailable', () => {});
} else {
  test('scss: line-count invariant', () => {
    assertLineInvariant('// c\n$c: red;\n/* b */\n', 'scss');
    assertLineInvariant('.a {\n  /* one\n     two */\n}', 'scss');
  });

  test('scss: both // and /* */ stripped, markers in strings kept', () => {
    const out = stripComments([
      '// line comment',
      '$c: red; // trailing',
      '/* block */',
      '.a {',
      '  color: $c; /* mid */ background: blue;',
      '  content: "// not a comment";',
      '}',
      ''].join('\n'), 'scss');
    assert.equal(out[0], '');
    assert.equal(out[1], '$c: red;');
    assert.equal(out[2], '');
    assert.equal(out[3], '.a {');
    assert.equal(out[4], '  color: $c; background: blue;');
    assert.equal(out[5], '  content: "// not a comment";');
    assert.equal(out[6], '}');
  });

  test('scss: block comment spanning lines', () => {
    const out = stripComments('.a {\n  /* one\n     two */\n  color: red;\n}\n', 'scss');
    assert.deepEqual(out, ['.a {', '', '', '  color: red;', '}']);
  });

  test('scss end-to-end', () => {
    const a = '// v1\n$c: red; // keep\n.a { color: $c; }\n';
    const b = '// completely different note\n$c: red;\n.a { color: $c; }\n';
    assertAllEqual(a, b, 'scss');
    assertHasChange(a, '// v1\n$c: blue;\n.a { color: $c; }\n', 'scss');
  });
}

// ── less ────────────────────────────────────────────────────────────────────

if (!hljs.getLanguage('less')) {
  test.skip('less unavailable', () => {});
} else {
  test('less: line-count invariant', () => {
    assertLineInvariant('// c\n@c: red;\n/* b */\n', 'less');
    assertLineInvariant('.a {\n  /* one\n     two */\n}', 'less');
  });

  test('less: // and /* */ stripped, marker in a string kept', () => {
    const out = stripComments([
      '// less line comment',
      '@c: red; // trailing',
      '/* block */',
      '.a {',
      '  color: @c;',
      '  content: "// not a comment";',
      '}',
      ''].join('\n'), 'less');
    assert.equal(out[0], '');
    assert.equal(out[1], '@c: red;');
    assert.equal(out[2], '');
    assert.equal(out[3], '.a {');
    assert.equal(out[4], '  color: @c;');
    assert.equal(out[5], '  content: "// not a comment";');
    assert.equal(out[6], '}');
  });

  test('less: block comment spanning lines', () => {
    const out = stripComments('.a {\n  /* one\n     two */\n  color: red;\n}\n', 'less');
    assert.deepEqual(out, ['.a {', '', '', '  color: red;', '}']);
  });

  test('less end-to-end', () => {
    const a = '// v1\n@c: red; // keep\n.a { color: @c; }\n';
    const b = '// v2 with more words\n@c: red;\n.a { color: @c; }\n';
    assertAllEqual(a, b, 'less');
    assertHasChange(a, '// v1\n@c: green;\n.a { color: @c; }\n', 'less');
  });
}

// ── yaml ────────────────────────────────────────────────────────────────────

if (!hljs.getLanguage('yaml')) {
  test.skip('yaml unavailable', () => {});
} else {
  test('yaml: line-count invariant', () => {
    assertLineInvariant('# c\nname: app\nlist:\n  - one # x\n', 'yaml');
    assertLineInvariant('a: 1\nb: 2', 'yaml');
  });

  test('yaml: # comments stripped, # inside quoted scalars kept', () => {
    const out = stripComments([
      '# top comment',
      'name: app   # trailing',
      'msg: "a # not comment"',
      "msg2: 'b # also not'",
      'plain: value#nothash',
      'list:',
      '  - one   # c',
      '  - two',
      ''].join('\n'), 'yaml');
    assert.equal(out[0], '');
    assert.equal(out[1], 'name: app');
    assert.equal(out[2], 'msg: "a # not comment"');
    assert.equal(out[3], "msg2: 'b # also not'");
    // A `#` with no preceding space is part of the scalar, per YAML.
    assert.equal(out[4], 'plain: value#nothash');
    assert.equal(out[5], 'list:');
    assert.equal(out[6], '  - one');
    assert.equal(out[7], '  - two');
  });

  test('yaml: # inside a block scalar is content, not a comment', () => {
    const out = stripComments('script: |\n  echo hi # inside block scalar\nother: 1\n', 'yaml');
    assert.equal(out[1], '  echo hi # inside block scalar');
    assert.equal(out[2], 'other: 1');
  });

  test('yaml end-to-end', () => {
    const a = '# v1\nname: app   # keep\nport: 80\n';
    const b = '# rewritten header\nname: app\nport: 80\n';
    assertAllEqual(a, b, 'yaml');
    assertHasChange(a, '# v1\nname: app\nport: 443\n', 'yaml');
  });
}

// ── ini ─────────────────────────────────────────────────────────────────────

if (!hljs.getLanguage('ini')) {
  test.skip('ini unavailable', () => {});
} else {
  test('ini: line-count invariant', () => {
    assertLineInvariant('; c\n[s]\nk = v ; x\n', 'ini');
    assertLineInvariant('[s]\nk = v', 'ini');
  });

  test('ini: both ; and # comment forms stripped, quoted markers kept', () => {
    const out = stripComments([
      '; semicolon comment',
      '# hash comment',
      '[section]',
      'key = value   ; trailing semi',
      'key2 = value2 # trailing hash',
      'key3 = "a ; not comment"',
      'key4 = "b # not comment"',
      ''].join('\n'), 'ini');
    assert.equal(out[0], '');
    assert.equal(out[1], '');
    assert.equal(out[2], '[section]');
    assert.equal(out[3], 'key = value');
    assert.equal(out[4], 'key2 = value2');
    assert.equal(out[5], 'key3 = "a ; not comment"');
    assert.equal(out[6], 'key4 = "b # not comment"');
  });

  test('ini end-to-end', () => {
    const a = '; v1\n[db]\nhost = local  ; keep\nport = 5432\n';
    const b = '# switched marker and wording\n[db]\nhost = local\nport = 5432\n';
    assertAllEqual(a, b, 'ini');
    assertHasChange(a, '; v1\n[db]\nhost = remote\nport = 5432\n', 'ini');
  });
}

// ── sql ─────────────────────────────────────────────────────────────────────

if (!hljs.getLanguage('sql')) {
  test.skip('sql unavailable', () => {});
} else {
  test('sql: line-count invariant', () => {
    assertLineInvariant('-- c\nSELECT 1;\n/* b\n   c */\n', 'sql');
    assertLineInvariant('SELECT 1; -- eof', 'sql');
  });

  test('sql: -- and /* */ stripped, -- inside a literal kept', () => {
    const out = stripComments([
      '-- select users',
      'SELECT id, name -- trailing',
      'FROM users',
      "WHERE note = 'a -- not comment'",
      '/* block',
      '   comment */',
      'ORDER BY id; -- end',
      ''].join('\n'), 'sql');
    assert.equal(out[0], '');
    assert.equal(out[1], 'SELECT id, name');
    assert.equal(out[2], 'FROM users');
    assert.equal(out[3], "WHERE note = 'a -- not comment'");
    assert.equal(out[4], '');
    assert.equal(out[5], '');
    assert.equal(out[6], 'ORDER BY id;');
  });

  test('sql: mid-statement block comment collapses to one space', () => {
    const out = stripComments('SELECT a /* mid */ , b FROM t;\n', 'sql');
    assert.equal(out[0], 'SELECT a , b FROM t;');
  });

  test('sql end-to-end', () => {
    const a = '-- v1\nSELECT id -- keep\nFROM users;\n';
    const b = '-- v2, reworded entirely\nSELECT id\nFROM users;\n';
    assertAllEqual(a, b, 'sql');
    assertHasChange(a, '-- v1\nSELECT id, name\nFROM users;\n', 'sql');
  });
}

// ── graphql ─────────────────────────────────────────────────────────────────

if (!hljs.getLanguage('graphql')) {
  test.skip('graphql unavailable', () => {});
} else {
  test('graphql: line-count invariant', () => {
    assertLineInvariant('# c\ntype T {\n  id: ID! # x\n}\n', 'graphql');
    assertLineInvariant('query Q { f }', 'graphql');
  });

  test('graphql: # comments stripped, # inside strings kept', () => {
    const out = stripComments([
      '# schema comment',
      'type User {',
      '  id: ID!   # trailing',
      '  name: String @deprecated(reason: "use # full")',
      '}',
      ''].join('\n'), 'graphql');
    assert.equal(out[0], '');
    assert.equal(out[1], 'type User {');
    assert.equal(out[2], '  id: ID!');
    assert.equal(out[3], '  name: String @deprecated(reason: "use # full")');
    assert.equal(out[4], '}');
  });

  test('graphql: block-string descriptions are not comments', () => {
    const out = stripComments('"""\nDoc string # not comment\n"""\nquery Q {\n  f # c\n}\n', 'graphql');
    assert.equal(out[0], '"""');
    assert.equal(out[1], 'Doc string # not comment');
    assert.equal(out[2], '"""');
    assert.equal(out[4], '  f');
  });

  test('graphql end-to-end', () => {
    const a = '# v1\ntype User {\n  id: ID!  # keep\n}\n';
    const b = '# a totally different header comment\ntype User {\n  id: ID!\n}\n';
    assertAllEqual(a, b, 'graphql');
    assertHasChange(a, '# v1\ntype User {\n  id: Int!\n}\n', 'graphql');
  });
}

// ── markdown ────────────────────────────────────────────────────────────────

if (!hljs.getLanguage('markdown')) {
  test.skip('markdown unavailable', () => {});
} else {
  test('markdown: line-count invariant', () => {
    assertLineInvariant('# H\n\n<!-- c -->\n\ntext\n', 'markdown');
    assertLineInvariant('text\n<!-- one\n     two -->', 'markdown');
  });

  test('markdown: nothing is stripped', () => {
    // known hljs behavior: the markdown grammar emits no hljs-comment scope at
    // all, so `<!-- ... -->` stays put and stripComments is an identity map.
    const src = [
      '# Heading',
      '',
      '<!-- an html comment -->',
      '',
      'Some *text* with `code # here`.',
      '',
      '```js',
      '// js comment inside fence',
      'x = 1;',
      '```',
      ''].join('\n');
    const out = stripComments(src, 'markdown');
    assert.deepEqual(out, src.split('\n').slice(0, -1));
  });

  test('markdown: multi-line html comment also survives', () => {
    const out = stripComments('para\n<!-- one\n     two -->\nend\n', 'markdown');
    assert.deepEqual(out, ['para', '<!-- one', '     two -->', 'end']);
  });

  test('markdown end-to-end: html-comment edits still show as changes', () => {
    // known hljs behavior: with no comment scope, a comment-only markdown edit
    // is indistinguishable from a content edit and diffs as a real change.
    const a = 'text\n<!-- v1 -->\n';
    const b = 'text\n<!-- v2 -->\n';
    assertHasChange(a, b, 'markdown');
    assertHasChange(a, 'other text\n<!-- v1 -->\n', 'markdown');
    // Identical input is still all-equal, so keySources do no harm here.
    assertAllEqual(a, a, 'markdown');
  });
}

// ── makefile ────────────────────────────────────────────────────────────────

if (!hljs.getLanguage('makefile')) {
  test.skip('makefile unavailable', () => {});
} else {
  test('makefile: line-count invariant', () => {
    assertLineInvariant('# c\nCC = gcc\n\nall:\n\t$(CC) x.c\n', 'makefile');
    assertLineInvariant('all:\n\techo hi # c', 'makefile');
  });

  test('makefile: # comments stripped in both variables and recipes', () => {
    const out = stripComments([
      '# top comment',
      'CC = gcc   # trailing',
      '',
      'all: main.o',
      '\t$(CC) -o all main.o   # recipe comment',
      '',
      'clean:',
      '\techo "a # not comment"',
      ''].join('\n'), 'makefile');
    assert.equal(out[0], '');
    assert.equal(out[1], 'CC = gcc');
    assert.equal(out[2], '');
    assert.equal(out[3], 'all: main.o');
    assert.equal(out[4], '\t$(CC) -o all main.o');
    assert.equal(out[5], '');
    assert.equal(out[6], 'clean:');
    assert.equal(out[7], '\techo "a # not comment"'); // double-quoted string wins
  });

  test('makefile: # inside a single-quoted recipe string IS stripped', () => {
    // known hljs behavior: the makefile grammar only models double-quoted
    // strings, so a `#` inside single quotes reads as a comment start.
    const out = stripComments("x:\n\techo 'sq # in single'\n", 'makefile');
    assert.equal(out[1], "\techo 'sq");
  });

  test('makefile: escaped \\# and url fragments are treated as comments', () => {
    // known hljs behavior: `\#` (escaped hash, literal in make) and the `#` of a
    // URL fragment both start an hljs-comment, leaving the backslash / prefix.
    const out = stripComments('URL = http://x/#frag\nx:\n\t@echo hash: \\# escaped\n', 'makefile');
    assert.equal(out[0], 'URL = http://x/');
    assert.equal(out[2], '\t@echo hash: \\');
  });

  test('makefile end-to-end', () => {
    const a = '# v1\nCC = gcc  # keep\n\nall:\n\t$(CC) main.c\n';
    const b = '# a much longer rewritten header\nCC = gcc\n\nall:\n\t$(CC) main.c\n';
    assertAllEqual(a, b, 'makefile');
    assertHasChange(a, '# v1\nCC = clang\n\nall:\n\t$(CC) main.c\n', 'makefile');
  });
}
