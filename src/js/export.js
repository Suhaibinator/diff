// ── Export: patch copy/download, HTML report, share link — plus toast/notice UI ──

// Replaced at build time with the compiled CSS so exported reports match the app.
const REPORT_CSS = '__REPORT_CSS__';

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastArea.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

function showNotice(html, kind) {
  const el = document.createElement('div');
  el.className = 'notice' + (kind === 'error' ? ' notice-error' : '');
  el.innerHTML = html + '<button class="notice-close" title="Dismiss">&times;</button>';
  el.querySelector('.notice-close').addEventListener('click', () => el.remove());
  noticeArea.appendChild(el);
}

function clearNotices() {
  noticeArea.innerHTML = '';
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function patchFileNames() {
  return {
    oldName: session.leftName || 'original',
    newName: session.rightName || 'modified',
  };
}

function currentPatchText() {
  if (!session.lastDiff) return null;
  const names = patchFileNames();
  return generateUnifiedPatch(session.lastDiff, {
    context: settings.contextLines,
    oldName: names.oldName,
    newName: names.newName,
  });
}

async function exportCopyPatch() {
  const patch = currentPatchText();
  if (patch == null) return;
  showToast((await copyText(patch)) ? 'Patch copied to clipboard' : 'Copy failed');
}

function exportDownloadPatch() {
  const patch = currentPatchText();
  if (patch == null) return;
  const names = patchFileNames();
  const base = (names.oldName + '-vs-' + names.newName).replace(/[^\w.-]+/g, '_');
  downloadFile(base + '.patch', patch, 'text/x-patch');
}

function exportHtmlReport() {
  if (!session.lastDiff) return;
  const diff = session.lastDiff;
  const names = patchFileNames();
  const stats = diffStatCounts(diff.ops);
  const body = buildUnifiedHtml(diff, {
    collapse: false,
    contextLines: settings.contextLines,
    granularity: settings.granularity,
    hlOld: session.hlOld,
    hlNew: session.hlNew,
  });
  const now = new Date();
  const html = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Diff: ' + esc(names.oldName) + ' vs ' + esc(names.newName) + '</title>' +
    '<style>' + REPORT_CSS + '</style></head><body>' +
    '<div class="report-header">' +
    '<h1>' + esc(names.oldName) + ' &#8594; ' + esc(names.newName) + '</h1>' +
    '<p class="report-meta">Generated ' + esc(now.toLocaleString()) +
    ' &middot; <span class="stat-added">+' + stats.added + '</span>' +
    ' <span class="stat-removed">-' + stats.removed + '</span>' +
    ' &middot; ' + stats.unchanged + ' unchanged</p></div>' +
    '<div class="report-diff">' + body + '</div>' +
    '</body></html>';
  downloadFile('diff-report.html', html, 'text/html');
}

const SHARE_WARN_BYTES = 8 * 1024;
const SHARE_MAX_BYTES = 100 * 1024;

async function exportShareLink() {
  const payload = {
    v: 1,
    l: leftInput.value,
    r: rightInput.value,
    ln: session.leftName,
    rn: session.rightName,
    s: {
      mode: settings.mode,
      view: settings.view,
      granularity: settings.granularity,
      ignoreWhitespace: settings.ignoreWhitespace,
      ignoreCase: settings.ignoreCase,
      language: settings.language,
    },
  };
  let hash;
  try {
    hash = await encodeSharePayload(payload);
  } catch (e) {
    showToast('Could not create share link');
    return;
  }
  if (hash.length > SHARE_MAX_BYTES) {
    showToast('Inputs are too large to share via URL (' + formatBytes(hash.length) + ')');
    return;
  }
  const url = location.href.split('#')[0] + '#' + hash;
  const ok = await copyText(url);
  if (!ok) { showToast('Copy failed'); return; }
  let msg = 'Link copied (' + formatBytes(url.length) + ')';
  if (hash.length > SHARE_WARN_BYTES) msg += ' — very long URLs may not paste everywhere';
  showToast(msg);
}
