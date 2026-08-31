#!/usr/bin/env node
// Dependency-free build script: inlines src/ and vendor/ into a single index.html.
// Usage: node build.js [--watch] [--check]
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT_FILE = path.join(ROOT, 'index.html');

// Concatenation order matters for top-level const initialization; function
// declarations hoist across the whole IIFE regardless.
const JS_ORDER = [
  'state.js',
  'diff-core.js',
  'patch.js',
  'share.js',
  'highlight.js',
  'json-mode.js',
  'render.js',
  'files.js',
  'export.js',
  'ui-extras.js',
  'main.js',
];

const APP_CSS = ['main.css', 'features.css', 'hljs-theme.css'];
const REPORT_CSS = ['main.css', 'hljs-theme.css', 'report.css'];

const BANNER = '<!--\n  DO NOT EDIT — this file is generated from src/ by build.js.\n  Run `node build.js` (or `node build.js --watch`) after editing src/ or vendor/.\n-->\n';

function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error('Missing source file: ' + rel);
  return fs.readFileSync(p, 'utf8');
}

function escapeInlineScript(js) {
  // '</script' inside an inline script would close the tag early. '<\/script'
  // is identical inside JS strings and cannot occur in code position.
  return js.replace(/<\/script/gi, '<\\/script');
}

function checkDuplicateDecls(files) {
  const seen = new Map();
  const declRe = /^(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  for (const f of files) {
    let m;
    declRe.lastIndex = 0;
    while ((m = declRe.exec(f.code)) !== null) {
      const name = m[1];
      if (seen.has(name) && seen.get(name) !== f.name) {
        throw new Error('Duplicate top-level declaration "' + name + '" in ' + f.name + ' and ' + seen.get(name));
      }
      seen.set(name, f.name);
    }
  }
}

function build() {
  const template = read('src/index.html');
  const appCss = APP_CSS.map(f => '/* ── ' + f + ' ── */\n' + read('src/styles/' + f)).join('\n');
  const reportCss = REPORT_CSS.map(f => read('src/styles/' + f)).join('\n');
  const vendor = escapeInlineScript(read('vendor/highlight.min.js'));

  const jsFiles = JS_ORDER.map(name => ({ name, code: read('src/js/' + name) }));
  checkDuplicateDecls(jsFiles);

  let bundle = jsFiles.map(f => '// ' + '─'.repeat(12) + ' src/js/' + f.name + ' ' + '─'.repeat(12) + '\n' + f.code).join('\n');
  bundle = "(function () {\n'use strict';\n" + bundle + '\n})();\n';
  bundle = escapeInlineScript(bundle);

  if (!bundle.includes("'__REPORT_CSS__'")) throw new Error('REPORT_CSS placeholder not found in JS bundle');
  bundle = bundle.replace("'__REPORT_CSS__'", () => JSON.stringify(reportCss));

  for (const marker of ['<!-- BUILD:CSS -->', '<!-- BUILD:VENDOR -->', '<!-- BUILD:JS -->']) {
    if (!template.includes(marker)) throw new Error('Template is missing marker ' + marker);
  }

  let out = template
    .replace('<!-- BUILD:CSS -->', () => '<style>\n' + appCss + '\n</style>')
    .replace('<!-- BUILD:VENDOR -->', () => '<script>\n' + vendor + '\n</script>')
    .replace('<!-- BUILD:JS -->', () => '<script>\n' + bundle + '</script>');
  out = out.replace('<!DOCTYPE html>\n', () => '<!DOCTYPE html>\n' + BANNER);

  // Sanity checks: the artifact must be fully self-contained and intact.
  if (/(?:src|href)\s*=\s*["']https?:/i.test(out)) throw new Error('Built file references an external URL');
  for (const id of ['leftInput', 'rightInput', 'diffScroll', 'settingsPopover']) {
    if (!out.includes('id="' + id + '"')) throw new Error('Built file is missing #' + id);
  }
  if (out.includes('BUILD:')) throw new Error('Unreplaced BUILD marker in output');
  if (out.includes('__REPORT_CSS__')) throw new Error('Unreplaced REPORT_CSS placeholder in output');

  fs.writeFileSync(OUT_FILE, out);
  return out.length;
}

function runBuild() {
  try {
    const bytes = build();
    console.log('[' + new Date().toLocaleTimeString() + '] built index.html (' + (bytes / 1024).toFixed(1) + ' KB)');
    return true;
  } catch (e) {
    console.error('[' + new Date().toLocaleTimeString() + '] BUILD FAILED: ' + e.message);
    return false;
  }
}

const args = process.argv.slice(2);
if (args.includes('--watch')) {
  runBuild();
  let timer = null;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(runBuild, 100);
  };
  for (const dir of ['src', 'vendor']) {
    fs.watch(path.join(ROOT, dir), { recursive: true }, trigger);
  }
  console.log('Watching src/ and vendor/ for changes…');
} else {
  const ok = runBuild();
  if (!ok) process.exit(1);
}
