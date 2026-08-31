// ── Comment stripping for "ignore comment-only changes" ──
// Reuses the vendored highlight.js tokenizer: whatever the highlighter marks
// as a comment span is stripped, so strings containing comment markers are
// never touched and every registered language works without its own table.

let commentsHljsOverride = null;
function setCommentsHljsForTesting(h) { commentsHljsOverride = h; }

function commentsGetHljs() {
  if (commentsHljsOverride) return commentsHljsOverride;
  return (typeof getHljs === 'function') ? getHljs() : null;
}

// hljs escapes exactly these five entities in its HTML output.
function unescapeHljsHtml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
}

// Returns one string per line of `text` with all comment text removed, or
// null when hljs or the language is unavailable. Line count mirrors
// splitLines(text).lines (same trailing-eol handling) so callers can index
// the result by oldIdx/newIdx.
function stripComments(text, lang) {
  const h = commentsGetHljs();
  if (!h || !lang || lang === 'plaintext' || !h.getLanguage(lang)) return null;
  if (text === '') return [];
  let value;
  try {
    value = h.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch (e) {
    return null;
  }

  const lines = [];
  let current = '';
  const stack = [];        // one entry per open span: true if inside a comment scope
  let commentDepth = 0;    // > 0 → text belongs to a comment (incl. nested doctags)
  let removedHere = false; // a comment was dropped since the last emitted char

  // Collapse the whitespace a dropped mid-line comment leaves behind, so
  // 'x = 1 /* c */ + 2' strips to 'x = 1 + 2', not 'x = 1  + 2'.
  const emit = (chunk) => {
    if (removedHere && /\s$/.test(current)) chunk = chunk.replace(/^\s+/, '');
    if (chunk) removedHere = false;
    current += chunk;
  };

  const re = /(<span[^>]*>)|(<\/span>)|\n/g;
  let last = 0;
  let m;
  while ((m = re.exec(value)) !== null) {
    const textPart = value.slice(last, m.index);
    if (textPart) {
      if (commentDepth > 0) removedHere = true;
      else emit(unescapeHljsHtml(textPart));
    }
    if (m[1]) {
      const isComment = commentDepth > 0 || /\bhljs-comment\b/.test(m[1]);
      stack.push(isComment);
      if (isComment) commentDepth++;
    } else if (m[2]) {
      if (stack.pop()) commentDepth--;
    } else {
      // A comment ending the line takes the whitespace before it along.
      lines.push(removedHere ? current.replace(/\s+$/, '') : current);
      current = '';
      removedHere = false;
    }
    last = re.lastIndex;
  }
  const tail = value.slice(last);
  if (tail && commentDepth === 0) emit(unescapeHljsHtml(tail));
  lines.push(removedHere ? current.replace(/\s+$/, '') : current);
  if (text.endsWith('\n')) lines.pop();
  return lines;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { stripComments, setCommentsHljsForTesting };
}
