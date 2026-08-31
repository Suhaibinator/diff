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

function ops(a, b, lang) {
  return computeDiff(a, b, {
    aKeySource: stripComments(a, lang),
    bKeySource: stripComments(b, lang),
  }).ops;
}

function assertCommentOnly(a, b, lang) {
  assert.ok(ops(a, b, lang).every(o => o.type === 'equal'));
}

function assertRealChange(a, b, lang) {
  assert.ok(ops(a, b, lang).some(o => o.type !== 'equal'));
}

// ── Python ──

test('python: comments stripped, docstrings and quoted # kept', (t) => {
  if (!hljs.getLanguage('python')) return t.skip('python not in this hljs build');
  // Python has no block-comment form; a triple-quoted docstring is the
  // multi-line construct the line walker has to span here.
  const src = [
    '#!/usr/bin/env python',
    '"""Module docstring.',
    'Second line of docstring.',
    '"""',
    'import os  # trailing',
    '',
    'def f(x):',
    '    """Inner docstring."""',
    '    # whole line comment',
    '    y = x + 1  # add one',
    '    s = "# not a comment"',
    "    t = f'value {x} # still string'",
    '    return y',
  ].join('\n') + '\n';
  const out = assertLineInvariant(src, 'python');

  // known hljs behavior: Python marks the shebang hljs-comment, so it is
  // stripped (Ruby and Bash mark theirs hljs-meta and keep it — see below).
  assert.equal(out[0], '');
  // Docstrings are hljs-string, not hljs-comment: they survive verbatim.
  assert.equal(out[1], '"""Module docstring.');
  assert.equal(out[2], 'Second line of docstring.');
  assert.equal(out[3], '"""');
  assert.equal(out[7], '    """Inner docstring."""');

  assert.equal(out[4], 'import os');       // trailing comment takes its spacing
  assert.equal(out[8], '');                // whole-line comment
  assert.equal(out[9], '    y = x + 1');   // indentation preserved
  assert.equal(out[10], '    s = "# not a comment"');
  assert.equal(out[11], "    t = f'value {x} # still string'"); // # inside an f-string
  assert.equal(out[12], '    return y');
});

test('python: # inside every string flavor survives', (t) => {
  if (!hljs.getLanguage('python')) return t.skip('python not in this hljs build');
  const out = stripComments(
    'a = "# nope"\nb = \'# nope\'\nc = """# nope"""\nd = f\'{x}#tag\'\ne = 1 # yes\n',
    'python');
  assert.equal(out[0], 'a = "# nope"');
  assert.equal(out[1], "b = '# nope'");
  assert.equal(out[2], 'c = """# nope"""');
  assert.equal(out[3], "d = f'{x}#tag'");
  assert.equal(out[4], 'e = 1');
});

test('python: no trailing newline and comment at EOF', (t) => {
  if (!hljs.getLanguage('python')) return t.skip('python not in this hljs build');
  assert.deepEqual(stripComments('x = 1  # note', 'python'), ['x = 1']);
  assert.deepEqual(stripComments('x = 1\n# eof comment', 'python'), ['x = 1', '']);
});

test('python: comment-only change is equal, code change is not', (t) => {
  if (!hljs.getLanguage('python')) return t.skip('python not in this hljs build');
  assertCommentOnly(
    'def f():\n    # old note\n    return 1  # a\n',
    'def f():\n    return 1  # b\n', 'python');
  assertRealChange(
    'def f():\n    return 1  # a\n',
    'def f():\n    return 2  # b\n', 'python');
});

// ── Ruby ──

test('ruby: =begin/=end blocks, # comments, interpolation', (t) => {
  if (!hljs.getLanguage('ruby')) return t.skip('ruby not in this hljs build');
  const src = [
    '#!/usr/bin/env ruby',
    '=begin',
    'Block comment line one.',
    'Block comment line two.',
    '=end',
    'x = 1  # trailing',
    '# whole line',
    'puts "# not a comment"',
    'puts "value #{x} # inside interp string"',
    'y = :sym',
  ].join('\n') + '\n';
  const out = assertLineInvariant(src, 'ruby');

  // known hljs behavior: Ruby's shebang is hljs-meta, not hljs-comment, so it
  // survives — the opposite of Python and Perl, which strip theirs.
  assert.equal(out[0], '#!/usr/bin/env ruby');

  assert.equal(out[1], '');  // =begin
  assert.equal(out[2], '');
  assert.equal(out[3], '');
  assert.equal(out[4], '');  // =end
  assert.equal(out[5], 'x = 1');
  assert.equal(out[6], '');
  assert.equal(out[7], 'puts "# not a comment"');
  assert.equal(out[8], 'puts "value #{x} # inside interp string"');
  assert.equal(out[9], 'y = :sym');
});

test('ruby: =begin only counts at column 0', (t) => {
  if (!hljs.getLanguage('ruby')) return t.skip('ruby not in this hljs build');
  const out = stripComments('  =begin\n  text\n  =end\nx = 1\n', 'ruby');
  assert.deepEqual(out, ['  =begin', '  text', '  =end', 'x = 1']);
});

test('ruby: comment marker inside #{} interpolation', (t) => {
  if (!hljs.getLanguage('ruby')) return t.skip('ruby not in this hljs build');
  // known hljs behavior: inside #{...} a `#` opens a comment scope that runs to
  // end of line, swallowing the closing brace and quote. Ruby itself agrees a
  // `#` starts a comment there, so the residue is truncated rather than intact.
  assert.deepEqual(stripComments('puts "#{x # c}"\n', 'ruby'), ['puts "#{x']);
});

test('ruby: doc comments and single quotes', (t) => {
  if (!hljs.getLanguage('ruby')) return t.skip('ruby not in this hljs build');
  const out = stripComments(
    "##\n# @param x [Integer]\ndef f(x)\n  s = '# single quoted'\n  x\nend\n", 'ruby');
  assert.equal(out[0], '');
  assert.equal(out[1], '');
  assert.equal(out[2], 'def f(x)');
  assert.equal(out[3], "  s = '# single quoted'");
  assert.equal(out[5], 'end');
});

test('ruby: comment-only change is equal, code change is not', (t) => {
  if (!hljs.getLanguage('ruby')) return t.skip('ruby not in this hljs build');
  assertCommentOnly(
    '=begin\nold docs\n=end\ndef f\n  1  # a\nend\n',
    'def f\n  # new note\n  1  # b\nend\n', 'ruby');
  assertRealChange('def f\n  1  # a\nend\n', 'def f\n  2  # b\nend\n', 'ruby');
});

// ── Perl ──

test('perl: POD blocks and # comments', (t) => {
  if (!hljs.getLanguage('perl')) return t.skip('perl not in this hljs build');
  const src = [
    '#!/usr/bin/perl',
    'use strict;',
    '',
    '=pod',
    'This is POD documentation.',
    'More POD.',
    '=cut',
    '',
    'my $x = 1;  # trailing',
    '# whole line',
    'my $s = "# not a comment";',
    "my $t = '# also not';",
    'print "done\\n";',
  ].join('\n') + '\n';
  const out = assertLineInvariant(src, 'perl');

  assert.equal(out[0], '');            // shebang is hljs-comment in Perl
  assert.equal(out[1], 'use strict;');
  assert.equal(out[3], '');            // =pod
  assert.equal(out[4], '');
  assert.equal(out[5], '');
  assert.equal(out[6], '');            // =cut
  assert.equal(out[8], 'my $x = 1;');
  assert.equal(out[9], '');
  assert.equal(out[10], 'my $s = "# not a comment";');
  assert.equal(out[11], "my $t = '# also not';");
  assert.equal(out[12], 'print "done\\n";');
});

test('perl: =head1 POD and # inside regex/quote-like', (t) => {
  if (!hljs.getLanguage('perl')) return t.skip('perl not in this hljs build');
  const pod = stripComments(
    '=head1 NAME\n\nThing - does things\n\n=cut\nmy $y = 2;\n', 'perl');
  assert.deepEqual(pod, ['', '', '', '', '', 'my $y = 2;']);

  const re = stripComments(
    'if ($s =~ /#\\d+/) { print "hash"; }\nmy $q = qq{# in qq};\n$x =~ s/a#b/c/g;  # subst\n',
    'perl');
  assert.equal(re[0], 'if ($s =~ /#\\d+/) { print "hash"; }'); // # inside a regexp
  assert.equal(re[1], 'my $q = qq{# in qq};');                 // # inside qq{}
  assert.equal(re[2], '$x =~ s/a#b/c/g;');
});

test('perl: comment-only change is equal, code change is not', (t) => {
  if (!hljs.getLanguage('perl')) return t.skip('perl not in this hljs build');
  assertCommentOnly(
    '=pod\nold\n=cut\nmy $x = 1;  # a\n',
    'my $x = 1;  # b\n# extra\n', 'perl');
  assertRealChange('my $x = 1;  # a\n', 'my $x = 2;  # b\n', 'perl');
});

// ── Bash ──

test('bash: comments, shebang, heredocs, ${} expansions', (t) => {
  if (!hljs.getLanguage('bash')) return t.skip('bash not in this hljs build');
  // Bash has no block-comment form; the heredoc is the multi-line construct.
  const src = [
    '#!/bin/bash',
    'set -e  # exit on error',
    '# whole line comment',
    'cat <<EOF',
    'this # is inside a heredoc',
    'EOF',
    'echo "# not a comment"',
    "echo '# also not'",
    'echo ${VAR#prefix}',
    'echo ${#VAR}',
    'echo done',
  ].join('\n') + '\n';
  const out = assertLineInvariant(src, 'bash');

  // known hljs behavior: Bash marks the shebang hljs-meta, so it survives.
  assert.equal(out[0], '#!/bin/bash');

  assert.equal(out[1], 'set -e');
  assert.equal(out[2], '');
  assert.equal(out[3], 'cat <<EOF');
  assert.equal(out[4], 'this # is inside a heredoc'); // heredoc body is a string
  assert.equal(out[5], 'EOF');
  assert.equal(out[6], 'echo "# not a comment"');
  assert.equal(out[7], "echo '# also not'");
  assert.equal(out[8], 'echo ${VAR#prefix}');  // # as a prefix-strip operator
  assert.equal(out[9], 'echo ${#VAR}');        // # as the length operator
  assert.equal(out[10], 'echo done');
});

test('bash: heredoc quoting decides whether the body is scanned', (t) => {
  if (!hljs.getLanguage('bash')) return t.skip('bash not in this hljs build');
  const unquoted = stripComments(
    'cat <<EOF\n# leading hash inside heredoc\nEOF\necho after  # real\n', 'bash');
  assert.equal(unquoted[1], '# leading hash inside heredoc');
  assert.equal(unquoted[3], 'echo after');

  // known hljs behavior: with a quoted delimiter (<<'EOF') hljs closes the
  // string at the delimiter itself, so the heredoc body is scanned as code and
  // a leading `#` in it is stripped as a comment — real bash would keep it.
  const quoted = stripComments("cat <<'EOF'\n# quoted heredoc hash\nEOF\n", 'bash');
  assert.equal(quoted[0], "cat <<'EOF'");
  assert.equal(quoted[1], '');
  assert.equal(quoted[2], 'EOF');
});

test('bash: comment-only change is equal, code change is not', (t) => {
  if (!hljs.getLanguage('bash')) return t.skip('bash not in this hljs build');
  assertCommentOnly('set -e  # a\n# old\nrun\n', 'set -e  # b\nrun\n', 'bash');
  assertRealChange('set -e  # a\nrun\n', 'set -u  # b\nrun\n', 'bash');
});

// ── Shell (hljs "Shell Session": a console transcript, not a bash script) ──

test('shell: only prompt-marked lines are scanned for comments', (t) => {
  if (!hljs.getLanguage('shell')) return t.skip('shell not in this hljs build');
  // known hljs behavior: the `shell` id is Shell Session, which highlights a
  // terminal transcript. Only text after a `$ ` / `# ` prompt marker is handed
  // to the bash sublanguage; everything else is command output and is left
  // alone. So the same script that strips cleanly as `bash` strips to nothing
  // here, and a leading `#` reads as a root prompt rather than a comment.
  const src = [
    '#!/bin/bash',
    'set -e  # exit on error',
    '# whole line comment',
    'echo done',
  ].join('\n') + '\n';
  const out = assertLineInvariant(src, 'shell');
  assert.deepEqual(out, src.split('\n').slice(0, -1));
});

test('shell: comments inside a prompt line are stripped', (t) => {
  if (!hljs.getLanguage('shell')) return t.skip('shell not in this hljs build');
  const out = stripComments('$ echo hi  # trailing\nhi\n# root prompt\n', 'shell');
  assert.equal(out[0], '$ echo hi');    // bash sublanguage inside the prompt
  assert.equal(out[1], 'hi');           // command output, untouched
  // known hljs behavior: `# ` here is the root-prompt marker (hljs-meta), so
  // the rest of the line is bash code and nothing is removed.
  assert.equal(out[2], '# root prompt');
  assert.deepEqual(stripComments('$ x=1  # note', 'shell'), ['$ x=1']);
});

test('shell: comment-only change is equal, code change is not', (t) => {
  if (!hljs.getLanguage('shell')) return t.skip('shell not in this hljs build');
  assertCommentOnly('$ ls -l  # a\ntotal 0\n', '$ ls -l  # b\ntotal 0\n', 'shell');
  assertRealChange('$ ls -l  # a\ntotal 0\n', '$ ls -a  # b\ntotal 0\n', 'shell');
});

// ── Lua ──

test('lua: -- comments, --[[ ]] blocks, and [[ ]] long strings', (t) => {
  if (!hljs.getLanguage('lua')) return t.skip('lua not in this hljs build');
  const src = [
    '-- whole line comment',
    'local x = 1  -- trailing',
    '--[[ block comment',
    'still comment',
    ']]',
    'local s = "-- not a comment"',
    "local t = '-- also not'",
    'local u = [[ -- inside long string ]]',
    '--- triple dash doc',
    'print(x)',
  ].join('\n') + '\n';
  const out = assertLineInvariant(src, 'lua');

  assert.equal(out[0], '');
  assert.equal(out[1], 'local x = 1');
  assert.equal(out[2], '');  // --[[
  assert.equal(out[3], '');
  assert.equal(out[4], '');  // ]]
  assert.equal(out[5], 'local s = "-- not a comment"');
  assert.equal(out[6], "local t = '-- also not'");
  assert.equal(out[7], 'local u = [[ -- inside long string ]]'); // long string, kept
  assert.equal(out[8], '');
  assert.equal(out[9], 'print(x)');
});

test('lua: mid-line block comment collapses its whitespace', (t) => {
  if (!hljs.getLanguage('lua')) return t.skip('lua not in this hljs build');
  const out = stripComments('local x = 1 --[[ c ]] + 2\nprint(x) -- eof comment', 'lua');
  assert.deepEqual(out, ['local x = 1 + 2', 'print(x)']);
});

test('lua: unterminated block comment runs to EOF', (t) => {
  if (!hljs.getLanguage('lua')) return t.skip('lua not in this hljs build');
  assert.deepEqual(stripComments('--[[ open\nstill\n', 'lua'), ['', '']);
});

test('lua: comment-only change is equal, code change is not', (t) => {
  if (!hljs.getLanguage('lua')) return t.skip('lua not in this hljs build');
  assertCommentOnly(
    '--[[ old ]]\nlocal x = 1  -- a\n',
    'local x = 1  -- b\n-- new\n', 'lua');
  assertRealChange('local x = 1  -- a\n', 'local x = 2  -- b\n', 'lua');
});

// ── R ──

test('r: # comments and #\' roxygen with doctags', (t) => {
  if (!hljs.getLanguage('r')) return t.skip('r not in this hljs build');
  // R has no block-comment form; roxygen runs are the multi-line construct,
  // and their @tags nest an hljs-doctag span inside the comment span.
  const src = [
    "#' @param x a number",
    "#' @return x plus one",
    'f <- function(x) {',
    '  y <- x + 1  # add one',
    '  # whole line',
    '  s <- "# not a comment"',
    "  t <- '# also not'",
    '  y',
    '}',
  ].join('\n') + '\n';
  const out = assertLineInvariant(src, 'r');

  assert.equal(out[0], '');  // nested doctag span is dropped with its comment
  assert.equal(out[1], '');
  assert.equal(out[2], 'f <- function(x) {');
  assert.equal(out[3], '  y <- x + 1');
  assert.equal(out[4], '');
  assert.equal(out[5], '  s <- "# not a comment"');
  assert.equal(out[6], "  t <- '# also not'");
  assert.equal(out[7], '  y');
  assert.equal(out[8], '}');
});

test('r: no trailing newline', (t) => {
  if (!hljs.getLanguage('r')) return t.skip('r not in this hljs build');
  assert.deepEqual(stripComments('x <- 1  # note', 'r'), ['x <- 1']);
});

test('r: comment-only change is equal, code change is not', (t) => {
  if (!hljs.getLanguage('r')) return t.skip('r not in this hljs build');
  assertCommentOnly("#' old doc\nx <- 1  # a\n", 'x <- 1  # b\n# new\n', 'r');
  assertRealChange('x <- 1  # a\n', 'x <- 2  # b\n', 'r');
});

// ── PHP ──

test('php: //, #, and /* */ comments inside <?php', (t) => {
  if (!hljs.getLanguage('php')) return t.skip('php not in this hljs build');
  const src = [
    '<?php',
    '// line comment',
    '# hash comment',
    '/* block comment',
    '   second line */',
    '$x = 1;  // trailing',
    '$y = 2;  # hash trailing',
    '$s = "// not a comment";',
    "$t = '# also not';",
    '$u = "http://example.com";',
    '/** doc @param int $x */',
    'echo $x;',
  ].join('\n') + '\n';
  const out = assertLineInvariant(src, 'php');

  assert.equal(out[0], '<?php');  // hljs-meta, kept
  assert.equal(out[1], '');
  assert.equal(out[2], '');
  assert.equal(out[3], '');  // /* block
  assert.equal(out[4], '');  // second line */
  assert.equal(out[5], '$x = 1;');
  assert.equal(out[6], '$y = 2;');
  assert.equal(out[7], '$s = "// not a comment";');
  assert.equal(out[8], "$t = '# also not';");
  assert.equal(out[9], '$u = "http://example.com";'); // // inside a URL string
  assert.equal(out[10], '');                          // docblock with @param doctag
  assert.equal(out[11], 'echo $x;');
});

test('php: mid-line block comment collapses, no open tag still parses', (t) => {
  if (!hljs.getLanguage('php')) return t.skip('php not in this hljs build');
  assert.deepEqual(
    stripComments('<?php\n$x = 1 /* c */ + 2;\necho $x; // eof', 'php'),
    ['<?php', '$x = 1 + 2;', 'echo $x;']);
  // A fragment without <?php is scanned as PHP all the same.
  assert.deepEqual(
    stripComments('// comment\n$x = 1; // trailing\n', 'php'),
    ['', '$x = 1;']);
});

test('php: text after ?> — php vs php-template', (t) => {
  if (!hljs.getLanguage('php')) return t.skip('php not in this hljs build');
  const src = '<?php\necho $x;\n?>\nplain html # not php\n';

  // known hljs behavior: the `php` id keeps scanning as PHP past `?>`, so a `#`
  // in the trailing HTML is stripped as a PHP comment even though PHP itself
  // would emit it as literal output.
  assert.deepEqual(stripComments(src, 'php'), ['<?php', 'echo $x;', '?>', 'plain html']);

  // php-template hands the region after ?> to the xml sublanguage, keeping it.
  if (!hljs.getLanguage('php-template')) return;
  assert.deepEqual(
    stripComments(src, 'php-template'),
    ['<?php', 'echo $x;', '?>', 'plain html # not php']);
});

test('php: comment-only change is equal, code change is not', (t) => {
  if (!hljs.getLanguage('php')) return t.skip('php not in this hljs build');
  assertCommentOnly('<?php\n/* old */\n$x = 1;  // a\n', '<?php\n$x = 1;  # b\n', 'php');
  assertRealChange('<?php\n$x = 1;  // a\n', '<?php\n$x = 2;  // b\n', 'php');
});
