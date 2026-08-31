// Syntax-highlighting integration for the diff view, backed by the vendored
// highlight.js build (loaded as a separate script tag before this bundle).
// All hljs access is lazy and optional: every function degrades to the plain
// text path when hljs is absent.

const HL_EXT_MAP = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  svg: 'xml',
  html: 'xml',
  htm: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  ini: 'ini',
  toml: 'ini',
  diff: 'diff',
  patch: 'diff',
  txt: 'plaintext'
};

let hljsTestOverride = null;

function setHljsForTesting(h) {
  hljsTestOverride = h;
}

function getHljs() {
  if (hljsTestOverride) return hljsTestOverride;
  return (typeof hljs !== 'undefined') ? hljs : (typeof window !== 'undefined' ? window.hljs : null);
}

function extensionOf(name) {
  if (typeof name !== 'string') return null;
  const m = /\.([^.\/\\]+)$/.exec(name);
  return m ? m[1].toLowerCase() : null;
}

function detectLanguage(sample, filenames) {
  const h = getHljs();
  if (!h) return null;
  if (typeof sample !== 'string' || sample.trim() === '') return null;
  for (const name of filenames || []) {
    const ext = extensionOf(name);
    if (ext && HL_EXT_MAP[ext]) return HL_EXT_MAP[ext];
  }
  const result = h.highlightAuto(sample.slice(0, 2000));
  if (result && result.language && result.relevance >= 5) return result.language;
  return null;
}

function highlightToLines(text, lang) {
  const h = getHljs();
  if (!h || !lang || lang === 'plaintext' || !h.getLanguage(lang)) return null;
  let value;
  try {
    value = h.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch (e) {
    return null;
  }
  // result.value contains only escaped text, <span ...> and </span>; split it
  // into per-line HTML, closing open spans at each newline and reopening them
  // on the next line so every line is independently balanced.
  const lines = [];
  const stack = [];
  let current = '';
  const re = /(<span[^>]*>)|(<\/span>)|\n/g;
  let last = 0;
  let m;
  while ((m = re.exec(value)) !== null) {
    current += value.slice(last, m.index);
    if (m[1]) {
      stack.push(m[1]);
      current += m[1];
    } else if (m[2]) {
      stack.pop();
      current += m[2];
    } else {
      current += '</span>'.repeat(stack.length);
      lines.push(current);
      current = stack.join('');
    }
    last = re.lastIndex;
  }
  current += value.slice(last);
  lines.push(current);
  return lines;
}

function sliceRangesForNode(nodeStart, nodeLen, ranges) {
  const out = [];
  for (const r of ranges || []) {
    if (!r) continue;
    const start = Math.max(0, r.start - nodeStart);
    const end = Math.min(nodeLen, r.end - nodeStart);
    if (end > start) out.push({ start, end });
  }
  return out;
}

let overlayTemplateEl = null;

function overlayRanges(lineHtml, ranges, cls) {
  if (typeof document === 'undefined') return lineHtml;
  if (!ranges || ranges.length === 0) return lineHtml;
  if (!overlayTemplateEl) overlayTemplateEl = document.createElement('template');
  overlayTemplateEl.innerHTML = lineHtml;
  const root = overlayTemplateEl.content;
  const sorted = ranges
    .filter((r) => r && r.end > r.start)
    .sort((a, b) => a.start - b.start);
  for (const range of sorted) {
    // Collect target text nodes with node-local slices first, then mutate:
    // splitText only touches the node being wrapped, so slices for the other
    // collected nodes stay valid.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets = [];
    let offset = 0;
    let node;
    while ((node = walker.nextNode()) !== null) {
      const len = node.data.length;
      const local = sliceRangesForNode(offset, len, [range]);
      if (local.length > 0) targets.push({ node, slice: local[0] });
      offset += len;
    }
    for (const t of targets) {
      let target = t.node;
      if (t.slice.start > 0) target = target.splitText(t.slice.start);
      const sliceLen = t.slice.end - t.slice.start;
      if (sliceLen < target.data.length) target.splitText(sliceLen);
      const span = document.createElement('span');
      span.className = cls;
      target.parentNode.insertBefore(span, target);
      span.appendChild(target);
    }
  }
  return overlayTemplateEl.innerHTML;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HL_EXT_MAP, detectLanguage, highlightToLines, overlayRanges, sliceRangesForNode, setHljsForTesting };
}
