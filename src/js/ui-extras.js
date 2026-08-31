// ── Minimap, change navigation, resize handle, input scroll sync ──

function jumpDiff(dir) {
  if (session.changeGroups.length === 0) return;
  session.currentChangeIdx += dir;
  if (session.currentChangeIdx < 0) session.currentChangeIdx = session.changeGroups.length - 1;
  if (session.currentChangeIdx >= session.changeGroups.length) session.currentChangeIdx = 0;
  updateNavLabel();
  const el = session.changeGroups[session.currentChangeIdx];
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.style.outline = '2px solid var(--accent)';
  el.style.outlineOffset = '-2px';
  setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 800);
}

function updateNavLabel() {
  if (session.changeGroups.length === 0) {
    diffNavLabel.textContent = '';
  } else {
    diffNavLabel.textContent = (session.currentChangeIdx + 1) + '/' + session.changeGroups.length;
  }
}

function refreshChangeGroups() {
  session.changeGroups = Array.from(diffScroll.querySelectorAll('[data-change-first]'));
  session.currentChangeIdx = -1;
  updateNavLabel();
}

// ── Minimap ──
function updateMinimap() {
  diffMinimap.querySelectorAll('.minimap-marker').forEach(m => m.remove());

  const totalHeight = diffScroll.scrollHeight;
  if (totalHeight === 0) return;
  const mapHeight = diffMinimap.clientHeight;

  const rows = diffScroll.querySelectorAll('.diff-row-added, .diff-row-removed');
  rows.forEach(row => {
    const height = row.offsetHeight;
    if (height === 0) return; // collapsed rows
    const top = row.offsetTop;
    const marker = document.createElement('div');
    marker.className = 'minimap-marker ' + (row.classList.contains('diff-row-added') ? 'added' : 'removed');
    marker.style.top = ((top / totalHeight) * mapHeight) + 'px';
    marker.style.height = Math.max(2, (height / totalHeight) * mapHeight) + 'px';
    diffMinimap.appendChild(marker);
  });

  updateMinimapViewport();
}

function updateMinimapViewport() {
  const totalHeight = diffScroll.scrollHeight;
  const mapHeight = diffMinimap.clientHeight;
  if (totalHeight === 0) { minimapViewport.style.display = 'none'; return; }
  minimapViewport.style.display = '';
  minimapViewport.style.top = ((diffScroll.scrollTop / totalHeight) * mapHeight) + 'px';
  minimapViewport.style.height = ((diffScroll.clientHeight / totalHeight) * mapHeight) + 'px';
}

function setupUiExtras() {
  diffScroll.addEventListener('scroll', updateMinimapViewport);

  diffMinimap.addEventListener('click', (e) => {
    const rect = diffMinimap.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    diffScroll.scrollTop = ratio * diffScroll.scrollHeight - diffScroll.clientHeight / 2;
  });

  window.addEventListener('resize', () => {
    if (session.lastDiff || session.lastPatch) requestAnimationFrame(updateMinimap);
  });

  // ── Resize handle ──
  let isResizing = false;
  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeHandle.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const mainContent = document.getElementById('mainContent');
    const rect = mainContent.getBoundingClientRect();
    const offset = e.clientY - rect.top;
    const newH = Math.max(80, Math.min(rect.height - 150, offset));
    inputArea.style.height = newH + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    resizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // ── Change navigation ──
  prevDiffBtn.addEventListener('click', () => jumpDiff(-1));
  nextDiffBtn.addEventListener('click', () => jumpDiff(1));

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); jumpDiff(-1); }
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); jumpDiff(1); }
  });

  // ── Input textarea scroll sync ──
  let isSyncingScroll = false;
  function mirrorScroll(from, to) {
    if (!settings.syncInputScroll || isSyncingScroll) return;
    isSyncingScroll = true;
    to.scrollTop = from.scrollTop;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => { isSyncingScroll = false; });
  }
  leftInput.addEventListener('scroll', () => mirrorScroll(leftInput, rightInput));
  rightInput.addEventListener('scroll', () => mirrorScroll(rightInput, leftInput));
}
