const test = require('node:test');
const assert = require('node:assert/strict');

const hljs = require('../vendor/highlight.min.js');
const {
  HL_EXT_MAP,
  detectLanguage,
  highlightToLines,
  overlayRanges,
  sliceRangesForNode,
  setHljsForTesting
} = require('../src/js/highlight.js');

setHljsForTesting(hljs);

function stripTags(html) {
  return html.replace(/<[^>]*>/g, '');
}

function unescapeHtml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

function countMatches(s, re) {
  return (s.match(re) || []).length;
}

const jsFixture = [
  '/* multi-line',
  '   block comment */',
  'const s = `template line one',
  '  line two ${x + 1} nested',
  'line three`;',
  'function f(a, b) { return a < b && a > 0; }',
  'const special = "&<>\\"\'" + \'&amp;\';'
].join('\n');

const pyFixture = [
  'def greet(name):',
  '    """Say <hello>',
  '    & \'goodbye\' to "them"',
  '    """',
  '    return "&<>" + name'
].join('\n');

function assertLineInvariants(text, lang) {
  const rawLines = text.split('\n');
  const htmlLines = highlightToLines(text, lang);
  assert.ok(Array.isArray(htmlLines), 'highlightToLines returned an array');
  assert.equal(htmlLines.length, rawLines.length, 'line count matches');
  for (let i = 0; i < rawLines.length; i++) {
    assert.equal(
      unescapeHtml(stripTags(htmlLines[i])),
      rawLines[i],
      `line ${i} round-trips to raw text`
    );
    assert.equal(
      countMatches(htmlLines[i], /<span[^>]*>/g),
      countMatches(htmlLines[i], /<\/span>/g),
      `line ${i} has balanced spans`
    );
  }
}

test('HL_EXT_MAP: every language id exists in the vendored build', () => {
  for (const [ext, lang] of Object.entries(HL_EXT_MAP)) {
    assert.ok(hljs.getLanguage(lang), `${ext} -> ${lang} is registered`);
  }
});

test('HL_EXT_MAP: covers expected extensions', () => {
  assert.equal(HL_EXT_MAP.js, 'javascript');
  assert.equal(HL_EXT_MAP.tsx, 'typescript');
  assert.equal(HL_EXT_MAP.py, 'python');
  assert.equal(HL_EXT_MAP.hpp, 'cpp');
  assert.equal(HL_EXT_MAP.html, 'xml');
  assert.equal(HL_EXT_MAP.toml, 'ini');
  assert.equal(HL_EXT_MAP.txt, 'plaintext');
});

test('detectLanguage: extension wins, first known extension used', () => {
  assert.equal(detectLanguage('anything', ['foo.py']), 'python');
  assert.equal(detectLanguage('anything', [null, 'a.unknownext', 'b.ts']), 'typescript');
  assert.equal(detectLanguage('anything', ['UPPER.JS']), 'javascript');
});

test('detectLanguage: falls back to highlightAuto with relevance gate', () => {
  const auto = hljs.highlightAuto(pyFixture.slice(0, 2000));
  const expected = auto.relevance >= 5 ? auto.language : null;
  assert.equal(detectLanguage(pyFixture, []), expected);
  assert.equal(detectLanguage(pyFixture, [null, 'noext']), expected);
  // Low-relevance samples are rejected rather than guessed.
  const weak = hljs.highlightAuto('hello');
  if (weak.relevance < 5) {
    assert.equal(detectLanguage('hello', []), null);
  }
});

test('detectLanguage: null for empty/whitespace sample or missing hljs', () => {
  assert.equal(detectLanguage('', ['foo.py']), null);
  assert.equal(detectLanguage('   \n\t ', ['foo.py']), null);
  setHljsForTesting(null);
  assert.equal(detectLanguage('const x = 1;', ['foo.js']), null);
  setHljsForTesting(hljs);
});

test('highlightToLines: null for missing hljs, falsy/plaintext/unknown lang', () => {
  assert.equal(highlightToLines('x', null), null);
  assert.equal(highlightToLines('x', ''), null);
  assert.equal(highlightToLines('x', 'plaintext'), null);
  assert.equal(highlightToLines('x', 'no-such-language'), null);
  setHljsForTesting(null);
  assert.equal(highlightToLines('const x = 1;', 'javascript'), null);
  setHljsForTesting(hljs);
});

test('highlight output contains only escaped text and span tags', () => {
  for (const [text, lang] of [[jsFixture, 'javascript'], [pyFixture, 'python']]) {
    const value = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    const stripped = value.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
    assert.ok(!/[<>]/.test(stripped), `no unescaped angle brackets in ${lang} output`);
  }
});

test('highlightToLines: javascript fixture round-trips per line', () => {
  assertLineInvariants(jsFixture, 'javascript');
});

test('highlightToLines: python fixture round-trips per line', () => {
  assertLineInvariants(pyFixture, 'python');
});

test('highlightToLines: multi-line constructs continue highlighting across lines', () => {
  const htmlLines = highlightToLines(jsFixture, 'javascript');
  // Line 1 is the interior of the block comment: it must reopen the comment span.
  assert.ok(/^<span[^>]*hljs-comment/.test(htmlLines[1]), 'comment span reopened on line 1');
  // Line 3 is the interior of the template literal: it must reopen the string span.
  assert.ok(/^<span[^>]*hljs-string/.test(htmlLines[3]), 'string span reopened on line 3');
});

test('sliceRangesForNode: clips global ranges to node-local offsets', () => {
  // Range fully inside the node.
  assert.deepEqual(sliceRangesForNode(10, 5, [{ start: 11, end: 13 }]), [{ start: 1, end: 3 }]);
  // Range spanning the whole node and beyond.
  assert.deepEqual(sliceRangesForNode(10, 5, [{ start: 0, end: 100 }]), [{ start: 0, end: 5 }]);
  // Range entirely before / entirely after the node.
  assert.deepEqual(sliceRangesForNode(10, 5, [{ start: 0, end: 10 }]), []);
  assert.deepEqual(sliceRangesForNode(10, 5, [{ start: 15, end: 20 }]), []);
  // Ranges touching the node boundaries.
  assert.deepEqual(sliceRangesForNode(10, 5, [{ start: 9, end: 11 }]), [{ start: 0, end: 1 }]);
  assert.deepEqual(sliceRangesForNode(10, 5, [{ start: 14, end: 16 }]), [{ start: 4, end: 5 }]);
  // Multiple ranges, empty and null entries dropped.
  assert.deepEqual(
    sliceRangesForNode(0, 10, [{ start: 1, end: 2 }, null, { start: 5, end: 5 }, { start: 8, end: 12 }]),
    [{ start: 1, end: 2 }, { start: 8, end: 10 }]
  );
  assert.deepEqual(sliceRangesForNode(0, 10, null), []);
});

test('overlayRanges: returns input unchanged when document is unavailable', () => {
  const html = 'const <span class="hljs-title">f</span> = 1;';
  assert.equal(overlayRanges(html, [{ start: 0, end: 5 }], 'char-highlight-add'), html);
});
