// ── App orchestration and event wiring ──

const HL_MAX_CHARS = 500 * 1024;
const HL_MAX_LINES = 20000;
const AUTO_COMPARE_LIMIT = 300 * 1024;

let autoCompareTimer = null;
let saveInputsTimer = null;
let autoCompareWarned = false;

function updateCounts() {
  leftCount.textContent = leftInput.value.length + ' chars';
  rightCount.textContent = rightInput.value.length + ' chars';
}

function refreshFileChips() {
  setPaneFilename('left', session.leftName);
  setPaneFilename('right', session.rightName);
}

function showDiffArea() {
  inputArea.classList.add('has-diff');
  resizeHandle.style.display = '';
  diffArea.classList.add('visible');
}

function hideDiffArea() {
  diffArea.classList.remove('visible');
  resizeHandle.style.display = 'none';
  inputArea.classList.remove('has-diff');
  inputArea.style.height = '';
}

// ── Syntax highlighting prep ──
function prepareHighlight(aText, bText, diff) {
  session.hlOld = null;
  session.hlNew = null;
  session.activeLang = null;
  if (typeof highlightToLines !== 'function') { updateLangChip(); return; }

  let lang = null;
  if (settings.mode === 'json') lang = 'json';
  else if (settings.language === 'plain') lang = null;
  else if (settings.language === 'auto') {
    const sample = aText.length >= bText.length ? aText : bText;
    lang = detectLanguage(sample, [session.leftName, session.rightName]);
  } else lang = settings.language;

  if (!lang || lang === 'plaintext') { updateLangChip(); return; }
  if (aText.length > HL_MAX_CHARS || bText.length > HL_MAX_CHARS ||
      diff.oldLines.length > HL_MAX_LINES || diff.newLines.length > HL_MAX_LINES) {
    updateLangChip();
    return;
  }
  session.hlOld = highlightToLines(diff.oldLines.join('\n'), lang);
  session.hlNew = highlightToLines(diff.newLines.join('\n'), lang);
  session.activeLang = (session.hlOld || session.hlNew) ? lang : null;
  updateLangChip();
}

function updateLangChip() {
  if (session.activeLang) {
    langChip.textContent = session.activeLang;
    langChip.hidden = false;
  } else {
    langChip.hidden = true;
  }
}

// ── Compare / render ──
function runDiff() {
  clearNotices();

  if (settings.mode === 'patch') {
    session.lastDiff = null;
    session.lastPatch = null;
    session.activeLang = null;
    updateLangChip();
    const parsed = parseUnifiedPatch(leftInput.value);
    showDiffArea();
    if (parsed.error) {
      diffStats.innerHTML = '';
      diffScroll.innerHTML = emptyStateHtml(parsed.error);
      refreshChangeGroups();
      requestAnimationFrame(updateMinimap);
      return;
    }
    for (const w of parsed.warnings) showNotice(esc(w));
    session.lastPatch = parsed;
    renderCurrentPatch();
    return;
  }

  let a = leftInput.value;
  let b = rightInput.value;
  if (settings.mode === 'json') {
    const ra = normalizeJsonInput(a);
    const rb = normalizeJsonInput(b);
    let bad = false;
    if (!ra.ok) { showNotice('<strong>Original:</strong> ' + esc(ra.error), 'error'); bad = true; }
    if (!rb.ok) { showNotice('<strong>Modified:</strong> ' + esc(rb.error), 'error'); bad = true; }
    if (bad) return;
    a = ra.normalized;
    b = rb.normalized;
  }

  const diff = computeDiff(a, b, {
    ignoreWhitespace: settings.ignoreWhitespace,
    ignoreCase: settings.ignoreCase,
  });
  session.lastDiff = diff;
  session.lastPatch = null;
  if (diff.truncated) {
    showNotice('Diff too complex &mdash; showing a block replacement for the changed middle section.');
  }
  prepareHighlight(a, b, diff);
  showDiffArea();
  renderCurrentDiff();
}

function renderCurrentDiff() {
  const diff = session.lastDiff;
  if (!diff) { if (session.lastPatch) renderCurrentPatch(); return; }

  const stats = diffStatCounts(diff.ops);
  diffStats.innerHTML =
    '<span class="stat-added">+' + stats.added + ' added</span>' +
    '<span class="stat-removed">-' + stats.removed + ' removed</span>' +
    '<span class="stat-unchanged">' + stats.unchanged + ' unchanged</span>';

  const opts = {
    collapse: settings.collapseUnchanged,
    contextLines: settings.contextLines,
    granularity: settings.granularity,
    hlOld: session.hlOld,
    hlNew: session.hlNew,
    oldLabel: session.leftName || 'Original',
    newLabel: session.rightName || 'Modified',
  };
  const isEmpty = diff.oldLines.length === 0 && diff.newLines.length === 0;
  diffScroll.innerHTML = isEmpty
    ? emptyStateHtml('Both inputs are empty')
    : (settings.view === 'split' ? buildSplitHtml(diff, opts) : buildUnifiedHtml(diff, opts));
  refreshChangeGroups();
  requestAnimationFrame(updateMinimap);
}

function renderCurrentPatch() {
  const parsed = session.lastPatch;
  if (!parsed) return;
  let added = 0, removed = 0;
  for (const file of parsed.files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === '+') added++;
        else if (line.type === '-') removed++;
      }
    }
  }
  diffStats.innerHTML =
    '<span class="stat-added">+' + added + ' added</span>' +
    '<span class="stat-removed">-' + removed + ' removed</span>' +
    '<span class="stat-unchanged">' + parsed.files.length + ' file' + (parsed.files.length === 1 ? '' : 's') + '</span>';
  diffScroll.innerHTML = buildPatchViewHtml(parsed);
  refreshChangeGroups();
  requestAnimationFrame(updateMinimap);
}

// ── Mode / view UI ──
function applyModeUI() {
  modeToggle.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === settings.mode));
  const isPatch = settings.mode === 'patch';
  document.querySelector('.app').classList.toggle('patch-mode', isPatch);
  viewToggle.style.display = isPatch ? 'none' : '';
  diffBtn.textContent = isPatch ? 'Render' : 'Compare';
  leftPaneLabel.textContent = isPatch ? 'Unified diff / patch'
    : (settings.mode === 'json' ? 'Original JSON' : 'Original');
  document.getElementById('rightPaneLabel').textContent =
    settings.mode === 'json' ? 'Modified JSON' : 'Modified';
  leftInput.placeholder = isPatch ? 'Paste a unified diff / git diff output here...'
    : 'Paste original text here...';
}

function applySettingsToControls() {
  viewToggle.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === settings.view));
  settingsPopover.querySelectorAll('[data-gran]').forEach(b =>
    b.classList.toggle('active', b.dataset.gran === settings.granularity));
  document.getElementById('optWhitespace').value = settings.ignoreWhitespace;
  document.getElementById('optIgnoreCase').checked = settings.ignoreCase;
  document.getElementById('optAutoCompare').checked = settings.autoCompare;
  document.getElementById('optCollapse').checked = settings.collapseUnchanged;
  document.getElementById('optSyncScroll').checked = settings.syncInputScroll;
  document.getElementById('optContext').value = settings.contextLines;
  if (langSelect.options.length > 0) {
    langSelect.value = settings.language;
    if (langSelect.selectedIndex === -1) { langSelect.value = 'auto'; settings.language = 'auto'; }
  }
}

function populateLanguageSelect() {
  const h = (typeof hljs !== 'undefined') ? hljs : null;
  if (!h) { document.getElementById('langRow').style.display = 'none'; return; }
  const frag = document.createDocumentFragment();
  const mkOpt = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  };
  frag.appendChild(mkOpt('auto', 'Auto-detect'));
  frag.appendChild(mkOpt('plain', 'Plain text'));
  for (const id of h.listLanguages().slice().sort()) frag.appendChild(mkOpt(id, id));
  langSelect.appendChild(frag);
}

function afterComputeSettingChange() {
  saveSettings();
  if (diffArea.classList.contains('visible')) runDiff();
}

function afterRenderSettingChange() {
  saveSettings();
  renderCurrentDiff();
}

// ── Inline options bar vs gear popover ──
const wideOptionsQuery = window.matchMedia('(min-width: 1100px)');

function isInlineOptions() {
  return wideOptionsQuery.matches;
}

function syncOptionsBar() {
  const inline = isInlineOptions();
  settingsPopover.classList.toggle('inline', inline);
  settingsBtn.style.display = inline ? 'none' : '';
  settingsPopover.hidden = !inline;
}

// ── Event wiring ──
function setupMainEvents() {
  for (const input of [leftInput, rightInput]) {
    input.addEventListener('input', () => {
      session.suppressInputSave = false;
      updateCounts();
      clearTimeout(saveInputsTimer);
      saveInputsTimer = setTimeout(saveInputs, 500);
      if (settings.autoCompare) {
        const total = leftInput.value.length + rightInput.value.length;
        if (total > AUTO_COMPARE_LIMIT) {
          if (!autoCompareWarned) {
            autoCompareWarned = true;
            showToast('Live compare paused for large input — use the Compare button');
          }
          return;
        }
        clearTimeout(autoCompareTimer);
        autoCompareTimer = setTimeout(runDiff, 300);
      }
    });
  }

  viewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    settings.view = btn.dataset.view;
    applySettingsToControls();
    afterRenderSettingChange();
  });

  modeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn || btn.dataset.mode === settings.mode) return;
    settings.mode = btn.dataset.mode;
    saveSettings();
    session.lastDiff = null;
    session.lastPatch = null;
    clearNotices();
    hideDiffArea();
    applyModeUI();
  });

  diffBtn.addEventListener('click', runDiff);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runDiff();
    if (e.key === 'Escape') {
      if (!isInlineOptions()) settingsPopover.hidden = true;
      exportDropdown.hidden = true;
    }
  });

  clearBtn.addEventListener('click', () => {
    leftInput.value = '';
    rightInput.value = '';
    session.leftName = null;
    session.rightName = null;
    session.lastDiff = null;
    session.lastPatch = null;
    updateCounts();
    refreshFileChips();
    clearNotices();
    hideDiffArea();
    clearSavedInputs();
    leftInput.focus();
  });

  swapBtn.addEventListener('click', () => {
    const tmpVal = leftInput.value;
    leftInput.value = rightInput.value;
    rightInput.value = tmpVal;
    const tmpName = session.leftName;
    session.leftName = session.rightName;
    session.rightName = tmpName;
    updateCounts();
    refreshFileChips();
    saveInputs();
    if (diffArea.classList.contains('visible')) runDiff();
  });

  // ── Settings popover ──
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPopover.hidden = !settingsPopover.hidden;
    exportDropdown.hidden = true;
  });
  settingsPopover.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => {
    if (!isInlineOptions()) settingsPopover.hidden = true;
    exportDropdown.hidden = true;
  });

  wideOptionsQuery.addEventListener('change', syncOptionsBar);

  settingsPopover.querySelectorAll('[data-gran]').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.granularity = btn.dataset.gran;
      applySettingsToControls();
      afterComputeSettingChange();
    });
  });

  document.getElementById('optWhitespace').addEventListener('change', (e) => {
    settings.ignoreWhitespace = e.target.value;
    afterComputeSettingChange();
  });
  document.getElementById('optIgnoreCase').addEventListener('change', (e) => {
    settings.ignoreCase = e.target.checked;
    afterComputeSettingChange();
  });
  document.getElementById('optAutoCompare').addEventListener('change', (e) => {
    settings.autoCompare = e.target.checked;
    saveSettings();
  });
  document.getElementById('optCollapse').addEventListener('change', (e) => {
    settings.collapseUnchanged = e.target.checked;
    afterRenderSettingChange();
  });
  document.getElementById('optSyncScroll').addEventListener('change', (e) => {
    settings.syncInputScroll = e.target.checked;
    saveSettings();
  });
  document.getElementById('optContext').addEventListener('change', (e) => {
    let n = parseInt(e.target.value, 10);
    if (!Number.isFinite(n)) n = 3;
    n = Math.max(1, Math.min(10, n));
    e.target.value = n;
    settings.contextLines = n;
    afterRenderSettingChange();
  });
  langSelect.addEventListener('change', () => {
    settings.language = langSelect.value;
    afterComputeSettingChange();
  });

  langChip.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isInlineOptions()) settingsPopover.hidden = false;
    langSelect.focus();
  });

  // ── Export dropdown ──
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportDropdown.hidden = !exportDropdown.hidden;
    settingsPopover.hidden = true;
  });
  exportDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('[data-export]');
    if (!item) return;
    exportDropdown.hidden = true;
    const action = item.dataset.export;
    if (action === 'share') { exportShareLink(); return; }
    if (!session.lastDiff) {
      showToast(settings.mode === 'patch'
        ? 'Patch export is for compare modes — switch to Text or JSON'
        : 'Run a compare first');
      return;
    }
    if (action === 'copy-patch') exportCopyPatch();
    else if (action === 'download-patch') exportDownloadPatch();
    else if (action === 'report') exportHtmlReport();
  });

  // ── Expand collapsed regions ──
  diffScroll.addEventListener('click', (e) => {
    const row = e.target.closest('.diff-row-collapse');
    if (!row) return;
    const id = row.dataset.collapseId;
    diffScroll.querySelectorAll('[data-collapse-id="' + CSS.escape(id) + '"]').forEach(el => {
      if (el.classList.contains('diff-row-collapse')) el.remove();
      else el.classList.remove('collapse-hidden');
    });
    updateMinimap();
  });
}

// ── Share-link loading ──
async function loadFromHash(hash) {
  try {
    const payload = await decodeSharePayload(hash.slice(1));
    if (!payload || typeof payload !== 'object') throw new Error('bad payload');
    leftInput.value = typeof payload.l === 'string' ? payload.l : '';
    rightInput.value = typeof payload.r === 'string' ? payload.r : '';
    session.leftName = typeof payload.ln === 'string' ? payload.ln : null;
    session.rightName = typeof payload.rn === 'string' ? payload.rn : null;
    if (payload.s && typeof payload.s === 'object') {
      for (const key of ['mode', 'view', 'granularity', 'ignoreWhitespace', 'ignoreCase', 'language']) {
        if (key in payload.s) settings[key] = payload.s[key];
      }
    }
    session.suppressInputSave = true; // don't clobber saved inputs until the user edits
    applySettingsToControls();
    applyModeUI();
    updateCounts();
    refreshFileChips();
    runDiff();
  } catch (e) {
    showToast(e && e.message === 'This link requires a newer browser'
      ? e.message : 'Could not read this share link');
    history.replaceState(null, '', location.pathname + location.search);
    restoreInputs();
    updateCounts();
    refreshFileChips();
  }
}

// ── Init ──
function init() {
  loadSettings();
  populateLanguageSelect();
  applySettingsToControls();
  applyModeUI();
  setupFileHandling();
  setupUiExtras();
  setupMainEvents();
  syncOptionsBar();

  const hash = location.hash;
  if (hash.startsWith('#d=') || hash.startsWith('#du=')) {
    loadFromHash(hash);
  } else {
    restoreInputs();
    updateCounts();
    refreshFileChips();
  }
  leftInput.focus();
}

init();
