// ── File loading: per-pane pickers + drag & drop ──

const FILE_HARD_LIMIT = 10 * 1024 * 1024;  // reject
const FILE_WARN_LIMIT = 1 * 1024 * 1024;   // confirm

function setupFileHandling() {
  document.querySelectorAll('.pane-open').forEach(btn => {
    const side = btn.dataset.side;
    const input = document.getElementById(side + 'FileInput');
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) loadFileIntoPane(input.files[0], side);
      input.value = '';
    });
  });

  document.querySelectorAll('.input-pane').forEach(pane => {
    const side = pane.dataset.side;
    if (!side) return;
    let dragDepth = 0;
    pane.addEventListener('dragover', (e) => { e.preventDefault(); });
    pane.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragDepth++;
      pane.classList.add('drop-target');
    });
    pane.addEventListener('dragleave', () => {
      dragDepth--;
      if (dragDepth <= 0) { dragDepth = 0; pane.classList.remove('drop-target'); }
    });
    pane.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      pane.classList.remove('drop-target');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadFileIntoPane(file, side);
    });
  });

  document.querySelectorAll('.file-clear').forEach(btn => {
    btn.addEventListener('click', () => {
      setPaneFilename(btn.closest('.pane-header').dataset.side || btn.dataset.side, null);
    });
  });
}

async function loadFileIntoPane(file, side) {
  if (file.size > FILE_HARD_LIMIT) {
    showToast('File too large (' + formatBytes(file.size) + ') — limit is 10 MB');
    return;
  }
  if (file.size > FILE_WARN_LIMIT &&
      !confirm(file.name + ' is ' + formatBytes(file.size) + '. Large files may be slow. Load anyway?')) {
    return;
  }
  let text;
  try {
    text = await file.text();
  } catch (e) {
    showToast('Could not read ' + file.name);
    return;
  }
  if (text.slice(0, 8192).includes('\u0000') &&
      !confirm(file.name + ' looks like a binary file. Load anyway?')) {
    return;
  }
  const input = side === 'left' ? leftInput : rightInput;
  input.value = text;
  setPaneFilename(side, file.name);
  // One code path for char counts, auto-save, and auto-compare.
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setPaneFilename(side, name) {
  if (side === 'left') session.leftName = name;
  else session.rightName = name;
  const chip = document.getElementById(side + 'File');
  if (name) {
    chip.querySelector('.pane-file-name').textContent = name;
    chip.hidden = false;
  } else {
    chip.hidden = true;
  }
  saveInputs();
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}
