// ── Renderers: build HTML strings for unified/split/patch views ──
// Pure string builders (aside from renderLineContent's optional overlayRanges
// call, which touches DOM via a detached template element). Callers assign
// the result to diffScroll.innerHTML, or embed it in an exported report.

function groupOps(ops) {
  const groups = [];
  let current = null;
  for (const op of ops) {
    const gtype = op.type === 'equal' ? 'equal' : 'change';
    if (!current || current.type !== gtype) {
      current = { type: gtype, ops: [] };
      groups.push(current);
    }
    current.ops.push(op);
  }
  return groups;
}

function diffStatCounts(ops) {
  let added = 0, removed = 0, unchanged = 0;
  for (const op of ops) {
    if (op.type === 'insert') added++;
    else if (op.type === 'delete') removed++;
    else unchanged++;
  }
  return { added, removed, unchanged };
}

// Compose a line's cell HTML from raw text, optional pre-highlighted HTML,
// and inline diff ranges (offsets into the raw text).
function renderLineContent(text, hlHtml, ranges, cls) {
  if (!ranges || ranges.length === 0) return hlHtml != null ? hlHtml : esc(text);
  if (hlHtml != null && typeof overlayRanges === 'function') {
    return overlayRanges(hlHtml, ranges, cls);
  }
  let html = '';
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) html += esc(text.slice(pos, r.start));
    html += '<span class="' + cls + '">' + esc(text.slice(r.start, r.end)) + '</span>';
    pos = r.end;
  }
  if (pos < text.length) html += esc(text.slice(pos));
  return html;
}

function collapsePlan(groupLen, isFirst, isLast, contextLines) {
  const headKeep = isFirst ? 0 : contextLines;
  const tailKeep = isLast ? 0 : contextLines;
  const hiddenCount = groupLen - headKeep - tailKeep;
  if (hiddenCount < 3) return null;
  return { headKeep, tailKeep, hiddenCount };
}

function expanderRowHtml(collapseId, hiddenCount, colspan) {
  return '<tr class="diff-row-collapse" data-collapse-id="' + collapseId + '">' +
    '<td colspan="' + colspan + '">&#8943; Show ' + hiddenCount + ' hidden line' +
    (hiddenCount === 1 ? '' : 's') + ' &#8943;</td></tr>';
}

// opts: { collapse, contextLines, granularity, hlOld, hlNew }
function buildUnifiedHtml(diff, opts) {
  const { oldLines, newLines } = diff;
  const groups = groupOps(diff.ops);
  const hasChanges = diff.ops.some(op => op.type !== 'equal');
  const doCollapse = !!opts.collapse && hasChanges;
  let html = '<table class="diff-table">';
  let changeGroupIdx = 0;
  let collapseId = 0;

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    if (group.type === 'equal') {
      const plan = doCollapse
        ? collapsePlan(group.ops.length, g === 0, g === groups.length - 1, opts.contextLines)
        : null;
      for (let i = 0; i < group.ops.length; i++) {
        const op = group.ops[i];
        const hidden = plan && i >= plan.headKeep && i < group.ops.length - plan.tailKeep;
        if (hidden && i === plan.headKeep) html += expanderRowHtml(collapseId, plan.hiddenCount, 4);
        // Equal ops from whitespace-only line joins/splits may carry only one
        // side; show whichever side exists and leave the other number blank.
        const content = op.oldIdx != null
          ? ((opts.hlOld && opts.hlOld[op.oldIdx] != null) ? opts.hlOld[op.oldIdx] : esc(oldLines[op.oldIdx]))
          : ((opts.hlNew && opts.hlNew[op.newIdx] != null) ? opts.hlNew[op.newIdx] : esc(newLines[op.newIdx]));
        html += '<tr class="diff-row-unchanged' + (hidden ? ' collapse-hidden' : '') + '"' +
          (hidden ? ' data-collapse-id="' + collapseId + '"' : '') + '>' +
          '<td class="line-num">' + (op.oldIdx != null ? op.oldIdx + 1 : '') + '</td>' +
          '<td class="line-num">' + (op.newIdx != null ? op.newIdx + 1 : '') + '</td>' +
          '<td class="line-type"></td>' +
          '<td class="line-content">' + content + '</td></tr>';
      }
      if (plan) collapseId++;
    } else {
      const deletes = group.ops.filter(o => o.type === 'delete');
      const inserts = group.ops.filter(o => o.type === 'insert');
      const pairCount = Math.min(deletes.length, inserts.length);
      const pairRanges = [];
      for (let i = 0; i < pairCount; i++) {
        pairRanges.push(inlineDiffRanges(
          oldLines[deletes[i].oldIdx], newLines[inserts[i].newIdx], opts.granularity));
      }
      const gAttr = ' data-change-group="' + changeGroupIdx + '"';
      let first = true;

      for (let i = 0; i < deletes.length; i++) {
        const op = deletes[i];
        const text = oldLines[op.oldIdx];
        const hl = opts.hlOld ? opts.hlOld[op.oldIdx] : null;
        const ranges = i < pairCount ? pairRanges[i].oldRanges : [];
        html += '<tr class="diff-row-removed"' + gAttr + (first ? ' data-change-first' : '') + '>' +
          '<td class="line-num">' + (op.oldIdx + 1) + '</td>' +
          '<td class="line-num"></td>' +
          '<td class="line-type">-</td>' +
          '<td class="line-content">' + renderLineContent(text, hl, ranges, 'char-highlight-remove') + '</td></tr>';
        first = false;
      }

      for (let i = 0; i < inserts.length; i++) {
        const op = inserts[i];
        const text = newLines[op.newIdx];
        const hl = opts.hlNew ? opts.hlNew[op.newIdx] : null;
        const ranges = i < pairCount ? pairRanges[i].newRanges : [];
        html += '<tr class="diff-row-added"' + gAttr + (first ? ' data-change-first' : '') + '>' +
          '<td class="line-num"></td>' +
          '<td class="line-num">' + (op.newIdx + 1) + '</td>' +
          '<td class="line-type">+</td>' +
          '<td class="line-content">' + renderLineContent(text, hl, ranges, 'char-highlight-add') + '</td></tr>';
        first = false;
      }
      changeGroupIdx++;
    }
  }

  html += '</table>';
  return html;
}

// opts: same as buildUnifiedHtml, plus { oldLabel, newLabel }
function buildSplitHtml(diff, opts) {
  const { oldLines, newLines } = diff;
  const groups = groupOps(diff.ops);
  const hasChanges = diff.ops.some(op => op.type !== 'equal');
  const doCollapse = !!opts.collapse && hasChanges;
  let changeGroupIdx = 0;
  let collapseId = 0;

  let leftHtml = '<table class="diff-table">';
  let rightHtml = '<table class="diff-table">';

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    if (group.type === 'equal') {
      const plan = doCollapse
        ? collapsePlan(group.ops.length, g === 0, g === groups.length - 1, opts.contextLines)
        : null;
      for (let i = 0; i < group.ops.length; i++) {
        const op = group.ops[i];
        const hidden = plan && i >= plan.headKeep && i < group.ops.length - plan.tailKeep;
        if (hidden && i === plan.headKeep) {
          leftHtml += expanderRowHtml(collapseId, plan.hiddenCount, 2);
          rightHtml += expanderRowHtml(collapseId, plan.hiddenCount, 2);
        }
        const rowCls = 'diff-row-unchanged' + (hidden ? ' collapse-hidden' : '');
        const idAttr = hidden ? ' data-collapse-id="' + collapseId + '"' : '';
        // Equal ops from whitespace-only line joins/splits may carry only one
        // side; pad the other side so the columns stay aligned.
        if (op.oldIdx != null) {
          const oldContent = (opts.hlOld && opts.hlOld[op.oldIdx] != null)
            ? opts.hlOld[op.oldIdx] : esc(oldLines[op.oldIdx]);
          leftHtml += '<tr class="' + rowCls + '"' + idAttr + '><td class="line-num">' + (op.oldIdx + 1) +
            '</td><td class="line-content">' + oldContent + '</td></tr>';
        } else {
          leftHtml += '<tr class="' + rowCls + '"' + idAttr + '><td class="line-num"></td><td class="line-content"></td></tr>';
        }
        if (op.newIdx != null) {
          const newContent = (opts.hlNew && opts.hlNew[op.newIdx] != null)
            ? opts.hlNew[op.newIdx] : esc(newLines[op.newIdx]);
          rightHtml += '<tr class="' + rowCls + '"' + idAttr + '><td class="line-num">' + (op.newIdx + 1) +
            '</td><td class="line-content">' + newContent + '</td></tr>';
        } else {
          rightHtml += '<tr class="' + rowCls + '"' + idAttr + '><td class="line-num"></td><td class="line-content"></td></tr>';
        }
      }
      if (plan) collapseId++;
    } else {
      const deletes = group.ops.filter(o => o.type === 'delete');
      const inserts = group.ops.filter(o => o.type === 'insert');
      const maxLen = Math.max(deletes.length, inserts.length);
      const pairCount = Math.min(deletes.length, inserts.length);
      const pairRanges = [];
      for (let i = 0; i < pairCount; i++) {
        pairRanges.push(inlineDiffRanges(
          oldLines[deletes[i].oldIdx], newLines[inserts[i].newIdx], opts.granularity));
      }
      const gAttr = ' data-change-group="' + changeGroupIdx + '"';

      for (let i = 0; i < maxLen; i++) {
        const isFirst = i === 0;
        if (i < deletes.length) {
          const op = deletes[i];
          const ranges = i < pairCount ? pairRanges[i].oldRanges : [];
          const hl = opts.hlOld ? opts.hlOld[op.oldIdx] : null;
          leftHtml += '<tr class="diff-row-removed"' + gAttr + (isFirst ? ' data-change-first' : '') +
            '><td class="line-num">' + (op.oldIdx + 1) + '</td><td class="line-content">' +
            renderLineContent(oldLines[op.oldIdx], hl, ranges, 'char-highlight-remove') + '</td></tr>';
        } else {
          leftHtml += '<tr class="diff-row-unchanged"><td class="line-num"></td><td class="line-content"></td></tr>';
        }

        if (i < inserts.length) {
          const op = inserts[i];
          const ranges = i < pairCount ? pairRanges[i].newRanges : [];
          const hl = opts.hlNew ? opts.hlNew[op.newIdx] : null;
          rightHtml += '<tr class="diff-row-added"' + gAttr + '><td class="line-num">' + (op.newIdx + 1) +
            '</td><td class="line-content">' +
            renderLineContent(newLines[op.newIdx], hl, ranges, 'char-highlight-add') + '</td></tr>';
        } else {
          rightHtml += '<tr class="diff-row-unchanged"><td class="line-num"></td><td class="line-content"></td></tr>';
        }
      }
      changeGroupIdx++;
    }
  }

  leftHtml += '</table>';
  rightHtml += '</table>';

  return '<div class="diff-side-wrapper">' +
    '<div class="diff-side"><div class="diff-side-header">' + esc(opts.oldLabel || 'Original') + '</div>' + leftHtml + '</div>' +
    '<div class="diff-side"><div class="diff-side-header">' + esc(opts.newLabel || 'Modified') + '</div>' + rightHtml + '</div>' +
    '</div>';
}

// ── Patch view: render a parsed unified patch ──
function buildPatchViewHtml(parsed) {
  let html = '<table class="diff-table">';
  let changeGroupIdx = 0;

  for (const file of parsed.files) {
    if (file.oldName != null || file.newName != null) {
      const label = (file.oldName === file.newName || file.newName == null)
        ? (file.oldName || file.newName)
        : (file.oldName == null ? file.newName : file.oldName + ' → ' + file.newName);
      html += '<tr class="diff-row-file"><td colspan="4">' + esc(label || '') + '</td></tr>';
    }
    for (const meta of file.meta) {
      if (meta.trim() === '') continue;
      html += '<tr class="diff-row-meta"><td colspan="4">' + esc(meta) + '</td></tr>';
    }
    for (const hunk of file.hunks) {
      html += '<tr class="diff-row-separator"><td colspan="4">' + esc(hunk.header) + '</td></tr>';
      let oldNum = hunk.oldStart;
      let newNum = hunk.newStart;
      let inRun = false;
      for (const line of hunk.lines) {
        const isChange = line.type !== ' ';
        const firstAttr = isChange && !inRun
          ? ' data-change-group="' + (changeGroupIdx++) + '" data-change-first' : '';
        inRun = isChange;
        let cls, oldCell = '', newCell = '', typeCell = '';
        if (line.type === '-') {
          cls = 'diff-row-removed'; oldCell = oldNum++; typeCell = '-';
        } else if (line.type === '+') {
          cls = 'diff-row-added'; newCell = newNum++; typeCell = '+';
        } else {
          cls = 'diff-row-unchanged'; oldCell = oldNum++; newCell = newNum++;
        }
        html += '<tr class="' + cls + '"' + firstAttr + '>' +
          '<td class="line-num">' + oldCell + '</td>' +
          '<td class="line-num">' + newCell + '</td>' +
          '<td class="line-type">' + typeCell + '</td>' +
          '<td class="line-content">' + esc(line.text) +
          (line.noNewline ? '<span class="no-newline-marker" title="No newline at end of file">&#9083;</span>' : '') +
          '</td></tr>';
      }
    }
  }

  html += '</table>';
  return html;
}

function emptyStateHtml(msg) {
  return '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg><p>' + msg + '</p></div>';
}
