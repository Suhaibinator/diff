// ── DOM references ──
const leftInput = document.getElementById('leftInput');
const rightInput = document.getElementById('rightInput');
const leftCount = document.getElementById('leftCount');
const rightCount = document.getElementById('rightCount');
const diffBtn = document.getElementById('diffBtn');
const clearBtn = document.getElementById('clearBtn');
const swapBtn = document.getElementById('swapBtn');
const inputArea = document.getElementById('inputArea');
const diffArea = document.getElementById('diffArea');
const diffScroll = document.getElementById('diffScroll');
const diffStats = document.getElementById('diffStats');
const viewToggle = document.getElementById('viewToggle');
const modeToggle = document.getElementById('modeToggle');
const resizeHandle = document.getElementById('resizeHandle');
const prevDiffBtn = document.getElementById('prevDiffBtn');
const nextDiffBtn = document.getElementById('nextDiffBtn');
const diffNavLabel = document.getElementById('diffNavLabel');
const diffMinimap = document.getElementById('diffMinimap');
const minimapViewport = document.getElementById('minimapViewport');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPopover = document.getElementById('settingsPopover');
const langChip = document.getElementById('langChip');
const langSelect = document.getElementById('langSelect');
const exportBtn = document.getElementById('exportBtn');
const exportDropdown = document.getElementById('exportDropdown');
const noticeArea = document.getElementById('noticeArea');
const toastArea = document.getElementById('toastArea');
const leftPaneLabel = document.getElementById('leftPaneLabel');
const rightPane = document.getElementById('rightPane');

// ── Persisted settings ──
const SETTINGS_KEY = 'diffchecker:settings:v1';
const INPUTS_KEY = 'diffchecker:inputs:v1';
const INPUT_SAVE_LIMIT = 2 * 1024 * 1024; // per side

const settings = {
  view: 'unified',            // 'unified' | 'split'
  mode: 'text',               // 'text' | 'json' | 'patch'
  granularity: 'word',        // 'line' | 'word' | 'char'
  ignoreWhitespace: 'none',   // 'none' | 'trim' | 'all'
  ignoreCase: false,
  detectMoves: true,          // tag relocated lines/blocks instead of +/-
  ignoreComments: false,      // hide comment-only changes (needs a resolved language)
  collapseUnchanged: false,
  contextLines: 3,
  autoCompare: false,
  syncInputScroll: false,
  language: 'auto',           // 'auto' | 'plain' | hljs language id
};

// ── Per-compare session state (not persisted) ──
const session = {
  leftName: null,
  rightName: null,
  lastDiff: null,
  lastPatch: null,
  activeLang: null,
  hlOld: null,
  hlNew: null,
  changeGroups: [],
  currentChangeIdx: -1,
  suppressInputSave: false,   // true right after loading from a share link
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return;
    for (const key of Object.keys(settings)) {
      if (key in saved) settings[key] = saved[key];
    }
  } catch (e) { /* private mode / quota — settings stay at defaults */ }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

function saveInputs() {
  if (session.suppressInputSave) return;
  try {
    if (leftInput.value.length > INPUT_SAVE_LIMIT || rightInput.value.length > INPUT_SAVE_LIMIT) return;
    localStorage.setItem(INPUTS_KEY, JSON.stringify({
      l: leftInput.value,
      r: rightInput.value,
      ln: session.leftName,
      rn: session.rightName,
    }));
  } catch (e) { /* ignore */ }
}

function restoreInputs() {
  try {
    const raw = localStorage.getItem(INPUTS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return;
    if (typeof saved.l === 'string') leftInput.value = saved.l;
    if (typeof saved.r === 'string') rightInput.value = saved.r;
    session.leftName = typeof saved.ln === 'string' ? saved.ln : null;
    session.rightName = typeof saved.rn === 'string' ? saved.rn : null;
  } catch (e) { /* ignore */ }
}

function clearSavedInputs() {
  try { localStorage.removeItem(INPUTS_KEY); } catch (e) { /* ignore */ }
}
