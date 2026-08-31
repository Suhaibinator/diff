// Unified patch generation and parsing.
// generateUnifiedPatch serializes the app's diff object to a unified diff;
// parseUnifiedPatch tolerantly parses a unified diff pasted by the user.

function generateUnifiedPatch(diff, opts) {
  const options = opts || {};
  const context = options.context === undefined ? 3 : options.context;
  const oldName = options.oldName === undefined ? 'original' : options.oldName;
  const newName = options.newName === undefined ? 'modified' : options.newName;
  // One-sided equal ops (whitespace-only line joins/splits under the
  // ignore-all-whitespace option) cannot become context lines — a context line
  // consumes one line on both sides — so emit them as real changes.
  const ops = diff.ops.map(op => {
    if (op.type !== 'equal') return op;
    if (op.oldIdx == null) return { type: 'insert', newIdx: op.newIdx };
    if (op.newIdx == null) return { type: 'delete', oldIdx: op.oldIdx };
    return op;
  });
  const header = '--- a/' + oldName + '\n+++ b/' + newName + '\n';

  // Cumulative line counts consumed on each side before op k.
  const oldAt = new Array(ops.length + 1);
  const newAt = new Array(ops.length + 1);
  oldAt[0] = 0;
  newAt[0] = 0;
  for (let k = 0; k < ops.length; k++) {
    oldAt[k + 1] = oldAt[k] + (ops[k].type === 'insert' ? 0 : 1);
    newAt[k + 1] = newAt[k] + (ops[k].type === 'delete' ? 0 : 1);
  }

  // Regions of op indices [lo, hi]: each change run padded with up to
  // `context` equal ops; regions that overlap or touch are merged.
  const regions = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < ops.length && ops[j + 1].type !== 'equal') j++;
    const lo = Math.max(0, i - context);
    const hi = Math.min(ops.length - 1, j + context);
    const last = regions[regions.length - 1];
    if (last && lo <= last[1] + 1) {
      last[1] = Math.max(last[1], hi);
    } else {
      regions.push([lo, hi]);
    }
    i = j + 1;
  }
  if (regions.length === 0) return header;

  const markOld = !diff.oldEol && diff.oldLines.length > 0;
  const markNew = !diff.newEol && diff.newLines.length > 0;
  const lastOld = diff.oldLines.length - 1;
  const lastNew = diff.newLines.length - 1;

  const lines = [];
  const pushLine = (prefix, text, needsMarker) => {
    lines.push(prefix + text);
    if (needsMarker) lines.push('\\ No newline at end of file');
  };

  for (const region of regions) {
    const lo = region[0];
    const hi = region[1];
    const oldCount = oldAt[hi + 1] - oldAt[lo];
    const newCount = newAt[hi + 1] - newAt[lo];
    const oldStart = oldCount > 0 ? oldAt[lo] + 1 : oldAt[lo];
    const newStart = newCount > 0 ? newAt[lo] + 1 : newAt[lo];
    lines.push('@@ -' + oldStart + ',' + oldCount + ' +' + newStart + ',' + newCount + ' @@');

    let k = lo;
    while (k <= hi) {
      const op = ops[k];
      if (op.type === 'equal') {
        const marker = (markOld && op.oldIdx === lastOld) || (markNew && op.newIdx === lastNew);
        pushLine(' ', diff.oldLines[op.oldIdx], marker);
        k++;
        continue;
      }
      // Change run: emit deletes before inserts, each side in op order.
      let r = k;
      while (r < hi && ops[r + 1].type !== 'equal') r++;
      for (let q = k; q <= r; q++) {
        if (ops[q].type === 'delete') {
          pushLine('-', diff.oldLines[ops[q].oldIdx], markOld && ops[q].oldIdx === lastOld);
        }
      }
      for (let q = k; q <= r; q++) {
        if (ops[q].type === 'insert') {
          pushLine('+', diff.newLines[ops[q].newIdx], markNew && ops[q].newIdx === lastNew);
        }
      }
      k = r + 1;
    }
  }

  return header + lines.join('\n') + '\n';
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function stripPatchName(raw, prefix) {
  let name = raw.split('\t')[0];
  if (name === '/dev/null') return null;
  if (name.startsWith(prefix)) name = name.slice(prefix.length);
  return name;
}

function parseUnifiedPatch(text) {
  const warnings = [];
  const files = [];
  try {
    const raw = String(text === undefined || text === null ? '' : text);
    const srcLines = raw.split('\n');
    // A trailing '\n' produces one empty last element; it is not content.
    if (srcLines.length > 0 && srcLines[srcLines.length - 1] === '') srcLines.pop();

    let pendingMeta = [];
    let currentFile = null;
    let i = 0;
    const n = srcLines.length;

    while (i < n) {
      const line = srcLines[i];

      if (line.startsWith('--- ') && i + 1 < n && srcLines[i + 1].startsWith('+++ ')) {
        currentFile = {
          oldName: stripPatchName(line.slice(4), 'a/'),
          newName: stripPatchName(srcLines[i + 1].slice(4), 'b/'),
          meta: pendingMeta,
          hunks: []
        };
        pendingMeta = [];
        files.push(currentFile);
        i += 2;
        continue;
      }

      const m = HUNK_HEADER_RE.exec(line);
      if (!m) {
        pendingMeta.push(line);
        i++;
        continue;
      }

      if (!currentFile) {
        // Bare hunk stream with no ---/+++ headers: synthesize a file.
        currentFile = { oldName: null, newName: null, meta: pendingMeta, hunks: [] };
        pendingMeta = [];
        files.push(currentFile);
      } else if (pendingMeta.length > 0) {
        currentFile.meta.push(...pendingMeta);
        pendingMeta = [];
      }

      const headerLineNo = i + 1;
      const hunk = {
        oldStart: parseInt(m[1], 10),
        oldCount: m[2] === undefined ? 1 : parseInt(m[2], 10),
        newStart: parseInt(m[3], 10),
        newCount: m[4] === undefined ? 1 : parseInt(m[4], 10),
        header: line,
        lines: []
      };
      currentFile.hunks.push(hunk);
      i++;

      let oldSeen = 0;
      let newSeen = 0;
      let ended = false;
      while (i < n && !ended && (oldSeen < hunk.oldCount || newSeen < hunk.newCount)) {
        const l = srcLines[i];
        // Tolerate a fully empty line inside a hunk as an empty context line
        // (some tools strip the trailing space).
        const c = l.length === 0 ? ' ' : l[0];
        if (c === ' ') {
          hunk.lines.push({ type: ' ', text: l.slice(1) });
          oldSeen++;
          newSeen++;
          i++;
        } else if (c === '-') {
          hunk.lines.push({ type: '-', text: l.slice(1) });
          oldSeen++;
          i++;
        } else if (c === '+') {
          hunk.lines.push({ type: '+', text: l.slice(1) });
          newSeen++;
          i++;
        } else if (c === '\\') {
          if (hunk.lines.length > 0) {
            hunk.lines[hunk.lines.length - 1].noNewline = true;
          } else {
            warnings.push('stray "\\ No newline" marker (@ line ' + (i + 1) + ')');
          }
          i++;
        } else {
          warnings.push('unexpected line inside hunk ends it early (@ line ' + (i + 1) + ')');
          ended = true;
        }
      }
      // A trailing no-newline marker lands after the last counted line.
      if (i < n && !ended && srcLines[i].startsWith('\\')) {
        if (hunk.lines.length > 0) hunk.lines[hunk.lines.length - 1].noNewline = true;
        i++;
      }
      if (oldSeen !== hunk.oldCount || newSeen !== hunk.newCount) {
        warnings.push('hunk line counts do not match header (@ line ' + headerLineNo + ')');
      }
    }

    if (pendingMeta.length > 0 && currentFile) {
      currentFile.meta.push(...pendingMeta);
    }

    let totalHunks = 0;
    for (const f of files) totalHunks += f.hunks.length;
    if (totalHunks === 0) {
      return { files: [], warnings, error: 'No hunks found — is this a unified diff?' };
    }
    return { files, warnings, error: null };
  } catch (e) {
    warnings.push('parser error: ' + (e && e.message ? e.message : String(e)));
    return { files: [], warnings, error: 'No hunks found — is this a unified diff?' };
  }
}

if (typeof module !== 'undefined' && module.exports) { module.exports = { generateUnifiedPatch, parseUnifiedPatch }; }
