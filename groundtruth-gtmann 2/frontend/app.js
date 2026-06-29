// ─── Config ──────────────────────────────────────────────────────────────────
const API_BASE = window.GROUNDTRUTH_API_BASE || localStorage.getItem('groundtruth_api_base') || 'http://localhost:3000';
const TRADES = ['framing', 'drywall', 'electrical', 'plumbing', 'hvac', 'painting', 'tile', 'glazing', 'cabinetry', 'flooring', 'concrete', 'general'];

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  user: null,
  items: [],
  subs: [],
  drift: null,
  filter: { window: 'all', flag: null },
  view: new URLSearchParams(window.location.search).get('view') === 'office' ? 'office' : 'foreman',
  editingItem: null,
  wizardQueue: [],
  wizardIndex: 0,
  wizardSelectedStatus: null,
  detailSelectedStatus: null
};

// ─── API ─────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const url = `${API_BASE}${path}`;
  const config = { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } };
  if (opts.body) config.body = JSON.stringify(opts.body);
  const res = await fetch(url, config);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || `HTTP ${res.status}`); err.status = res.status; err.data = data; throw err; }
  return data;
}

// ─── Utilities ───────────────────────────────────────────────────────────────
function escapeHTML(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}
function dayOffset(iso) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso + 'T12:00:00');
  return Math.round((d - today) / 86400000);
}
const STATUS_LABELS = {
  planned: 'Planned', in_progress: 'In progress', on_track: 'On track',
  slipping: 'Slipping', blocked: 'Blocked', done: 'Done'
};
const STATUS_EMOJI = { planned: '⏳', in_progress: '🔨', on_track: '✅', slipping: '⚠️', blocked: '🚫', done: '🏁' };
const STATUS_KEYS = ['on_track', 'slipping', 'blocked', 'in_progress', 'planned', 'done'];

// ─── User ────────────────────────────────────────────────────────────────────
function loadUser() {
  const s = localStorage.getItem('groundtruth_user');
  if (s) { try { state.user = JSON.parse(s); } catch { state.user = null; } }
}
function saveUser(name) {
  const initials = name.trim().split(/\s+/).map(p => p[0]).join('').toUpperCase().slice(0, 3);
  state.user = { name: name.trim(), initials };
  localStorage.setItem('groundtruth_user', JSON.stringify(state.user));
  document.getElementById('user-initials').textContent = initials;
}

// ─── Rendering: foreman board ───────────────────────────────────────────────
function schedCardHTML(item) {
  const sub = state.subs.find(s => s.id === item.assignedSubId);
  let driftHTML = '';
  if (item.flag === 'slipping' && item.daysShift > 0) driftHTML = `<span class="drift-badge drift-positive">+${item.daysShift}d behind</span>`;
  else if (item.flag === 'should_have_started') driftHTML = `<span class="drift-badge drift-positive">should've started</span>`;
  else if (item.flag === 'on_track' && item.status !== 'done') {
    const dStart = dayOffset(item.plannedStart), dEnd = dayOffset(item.plannedEnd);
    if (dStart > 0) driftHTML = `<span class="drift-badge drift-future">starts in ${dStart}d</span>`;
    else if (dEnd >= 0) driftHTML = `<span class="drift-badge drift-zero">on track · ${dEnd}d left</span>`;
  }
  return `
    <div class="sched-card flag-${item.flag} ${item.status === 'done' ? 'done' : ''}" data-id="${item.id}">
      <div class="sched-row-1">
        <div>
          <div class="sched-name">${STATUS_EMOJI[item.status]} ${escapeHTML(item.name)}</div>
          <div class="sched-area">${escapeHTML(item.area || '—')}</div>
        </div>
        <span class="sched-status-badge status-${item.status}">${STATUS_LABELS[item.status]}</span>
      </div>
      <div class="sched-row-2">
        <span class="trade-chip">${item.trade}</span>
        ${sub ? `<span class="sep">·</span><span>${escapeHTML(sub.name)}</span>` : ''}
        <span class="sep">·</span>
        <span>${fmtDate(item.plannedStart)} → ${fmtDate(item.plannedEnd)}</span>
        ${driftHTML ? `<span class="sep">·</span>${driftHTML}` : ''}
      </div>
      ${item.notes && (item.status === 'blocked' || item.status === 'slipping') ? `<div class="sched-area" style="margin-top:6px;color:var(--warning-text)">📝 ${escapeHTML(item.notes)}</div>` : ''}
    </div>`;
}

function renderItems() {
  let items = state.items;
  if (state.filter.window !== 'all') {
    const days = parseInt(state.filter.window);
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    items = items.filter(i =>
      i.status !== 'done' && (
        (i.plannedStart >= today && i.plannedStart <= future) ||
        (i.plannedStart <= today && i.plannedEnd >= today)
      )
    );
  }
  if (state.filter.flag) items = items.filter(i => i.flag === state.filter.flag);

  const list = document.getElementById('item-list');
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">${state.items.length ? 'No items match filters.' : 'No schedule items yet. Tap + to add one or import a CSV.'}</div>`;
    return;
  }
  list.innerHTML = items.map(schedCardHTML).join('');
  list.querySelectorAll('.sched-card').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.id)));
}

// ─── Stats strip ────────────────────────────────────────────────────────────
function renderStats() {
  const onTrack = state.items.filter(i => i.flag === 'on_track' && i.status !== 'done').length;
  const slipping = state.items.filter(i => i.flag === 'slipping').length;
  const blocked = state.items.filter(i => i.flag === 'blocked').length;
  const totalSlipped = state.items.filter(i => i.flag === 'slipping').reduce((s, i) => s + i.daysShift, 0);
  document.getElementById('stat-on-track').textContent = onTrack;
  document.getElementById('stat-slipping').textContent = slipping;
  document.getElementById('stat-blocked').textContent = blocked;
  document.getElementById('stat-days-slipped').textContent = totalSlipped + 'd';
}

// ─── Item detail / check-in ─────────────────────────────────────────────────
function openDetail(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  state.editingItem = item;
  state.detailSelectedStatus = item.status;
  const sub = item.assignedSubId ? state.subs.find(s => s.id === item.assignedSubId) : null;

  document.getElementById('detail-content').innerHTML = `
    <div class="sheet-header">
      <h2>${STATUS_EMOJI[item.status]} ${escapeHTML(item.name)}</h2>
      <p>${escapeHTML(item.area || '—')} · ${item.trade}</p>
    </div>
    <div class="detail-card">
      <div class="detail-row"><span class="detail-label">Planned</span><span class="detail-value">${fmtDate(item.plannedStart)} → ${fmtDate(item.plannedEnd)}</span></div>
      <div class="detail-row"><span class="detail-label">Current status</span><span class="detail-value"><span class="sched-status-badge status-${item.status}">${STATUS_LABELS[item.status]}</span></span></div>
      ${sub ? `<div class="detail-row"><span class="detail-label">Sub</span><span class="detail-value">${escapeHTML(sub.name)}</span></div>` : ''}
      ${item.daysShift > 0 ? `<div class="detail-row"><span class="detail-label">Drift</span><span class="detail-value" style="color:var(--warning-text)">+${item.daysShift} days</span></div>` : ''}
      ${item.lastCheckIn ? `<div class="detail-row"><span class="detail-label">Last check-in</span><span class="detail-value">${new Date(item.lastCheckIn).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} by ${escapeHTML(item.lastCheckInBy || '?')}</span></div>` : ''}
    </div>
  `;
  document.getElementById('detail-notes').value = item.notes || '';
  renderStatusGrid('detail-status-grid', item.status, 'detail');
  openSheet('detail-sheet');
}

function renderStatusGrid(containerId, currentStatus, key) {
  const grid = document.getElementById(containerId);
  grid.innerHTML = STATUS_KEYS.map(s => `
    <button class="status-btn s-${s} ${currentStatus === s ? 'active' : ''}" data-status="${s}">
      <span class="emoji">${STATUS_EMOJI[s]}</span>
      <span>${STATUS_LABELS[s]}</span>
    </button>
  `).join('');
  grid.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (key === 'detail') state.detailSelectedStatus = btn.dataset.status;
      else state.wizardSelectedStatus = btn.dataset.status;
    });
  });
}

document.getElementById('detail-save').addEventListener('click', async () => {
  if (!state.editingItem) return;
  if (!state.user) { showToast('Pick your name first', 'error'); openSheet('user-sheet'); return; }
  const notes = document.getElementById('detail-notes').value.trim();
  try {
    await api(`/api/schedule/${state.editingItem.id}/check-in`, {
      method: 'POST',
      body: { status: state.detailSelectedStatus, by: state.user.name, notes }
    });
    closeSheet('detail-sheet');
    showToast('Check-in saved');
    refresh();
  } catch (err) { showToast(err.message, 'error'); }
});

document.getElementById('detail-edit').addEventListener('click', () => {
  closeSheet('detail-sheet');
  openItemSheet(state.editingItem);
});

document.getElementById('detail-delete').addEventListener('click', async () => {
  if (!state.editingItem) return;
  if (!confirm(`Delete "${state.editingItem.name}"?`)) return;
  try {
    await api(`/api/schedule/${state.editingItem.id}`, { method: 'DELETE' });
    closeSheet('detail-sheet');
    showToast('Deleted');
    refresh();
  } catch (err) { showToast(err.message, 'error'); }
});

// ─── Add / edit item ────────────────────────────────────────────────────────
function openItemSheet(existing = null) {
  state.editingItem = existing;
  document.getElementById('item-sheet-title').textContent = existing ? 'Edit schedule item' : 'Add schedule item';
  document.getElementById('f-name').value = existing?.name || '';
  document.getElementById('f-area').value = existing?.area || '';
  document.getElementById('f-trade').innerHTML = '<option value="">— Pick trade —</option>' +
    TRADES.map(t => `<option value="${t}" ${existing?.trade === t ? 'selected' : ''}>${t}</option>`).join('');
  document.getElementById('f-sub').innerHTML = '<option value="">— Unassigned —</option>' +
    state.subs.map(s => `<option value="${s.id}" ${existing?.assignedSubId === s.id ? 'selected' : ''}>${escapeHTML(s.name)} (${s.trade})</option>`).join('');
  document.getElementById('f-start').value = existing?.plannedStart || new Date().toISOString().slice(0, 10);
  document.getElementById('f-end').value = existing?.plannedEnd || new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10);
  document.getElementById('f-notes').value = existing?.notes || '';
  openSheet('item-sheet');
}

document.getElementById('submit-item').addEventListener('click', async () => {
  const body = {
    name: document.getElementById('f-name').value.trim(),
    area: document.getElementById('f-area').value.trim(),
    trade: document.getElementById('f-trade').value,
    assignedSubId: document.getElementById('f-sub').value || null,
    plannedStart: document.getElementById('f-start').value,
    plannedEnd: document.getElementById('f-end').value,
    notes: document.getElementById('f-notes').value.trim(),
    createdBy: state.user?.name || 'unknown'
  };
  if (!body.name || !body.trade || !body.plannedStart || !body.plannedEnd) {
    showToast('Name, trade, start and end are required', 'error');
    return;
  }
  try {
    if (state.editingItem) {
      await api(`/api/schedule/${state.editingItem.id}`, { method: 'PATCH', body: { ...body, updatedBy: state.user?.name } });
    } else {
      await api('/api/schedule', { method: 'POST', body });
    }
    closeSheet('item-sheet');
    showToast(state.editingItem ? 'Updated' : 'Added');
    state.editingItem = null;
    refresh();
  } catch (err) { showToast(err.message, 'error'); }
});

// ─── Daily check-in wizard ──────────────────────────────────────────────────
function startWizard() {
  if (!state.user) { openSheet('user-sheet'); return; }
  // Queue: open items, ordered by flag severity then start date
  const open = state.items.filter(i => i.status !== 'done');
  const flagPri = { blocked: 0, slipping: 1, should_have_started: 2, on_track: 3 };
  open.sort((a, b) => (flagPri[a.flag] ?? 9) - (flagPri[b.flag] ?? 9));
  if (!open.length) { showToast('Nothing to check in. All done!', 'success'); return; }
  state.wizardQueue = open;
  state.wizardIndex = 0;
  renderWizardStep();
  openSheet('wizard-sheet');
}

function renderWizardStep() {
  const total = state.wizardQueue.length;
  const idx = state.wizardIndex;
  const item = state.wizardQueue[idx];
  if (!item) {
    closeSheet('wizard-sheet');
    showToast('Check-in complete ✓');
    refresh();
    return;
  }
  state.wizardSelectedStatus = item.status;
  document.getElementById('wizard-step').textContent = `${idx + 1} of ${total}`;
  document.getElementById('wizard-bar').style.width = ((idx) / total * 100) + '%';
  const sub = item.assignedSubId ? state.subs.find(s => s.id === item.assignedSubId) : null;
  document.getElementById('wizard-content').innerHTML = `
    <div class="wizard-item-card">
      <div class="wizard-item-name">${escapeHTML(item.name)}</div>
      <div class="wizard-item-meta">${escapeHTML(item.area || '—')} · ${item.trade}${sub ? ' · ' + escapeHTML(sub.name) : ''}</div>
      <div class="wizard-item-dates">
        <span>📅 ${fmtDate(item.plannedStart)} → ${fmtDate(item.plannedEnd)}</span>
        ${item.daysShift > 0 ? `<span style="color:var(--warning-text);font-weight:600">+${item.daysShift}d behind</span>` : ''}
      </div>
    </div>
    <div class="wizard-item-current">Currently <strong>${STATUS_LABELS[item.status]}</strong>${item.notes ? ' — ' + escapeHTML(item.notes) : ''}</div>
  `;
  document.getElementById('wizard-notes').value = item.notes || '';
  renderStatusGrid('wizard-status-grid', item.status, 'wizard');
  document.getElementById('wizard-back').disabled = idx === 0;
  document.getElementById('wizard-next').textContent = idx === total - 1 ? 'Finish ✓' : 'Save & next ›';
}

document.getElementById('wizard-next').addEventListener('click', async () => {
  const item = state.wizardQueue[state.wizardIndex];
  if (!item) return;
  const notes = document.getElementById('wizard-notes').value.trim();
  try {
    if (state.wizardSelectedStatus !== item.status || notes !== item.notes) {
      await api(`/api/schedule/${item.id}/check-in`, {
        method: 'POST',
        body: { status: state.wizardSelectedStatus, by: state.user.name, notes }
      });
    }
    state.wizardIndex++;
    renderWizardStep();
  } catch (err) { showToast(err.message, 'error'); }
});

document.getElementById('wizard-back').addEventListener('click', () => {
  if (state.wizardIndex > 0) {
    state.wizardIndex--;
    renderWizardStep();
  }
});

document.getElementById('wizard-skip').addEventListener('click', () => {
  state.wizardIndex++;
  renderWizardStep();
});

// ─── CSV import ─────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    // Try tab first, then comma
    const sep = line.includes('\t') ? '\t' : ',';
    const parts = line.split(sep).map(p => p.trim().replace(/^["']|["']$/g, ''));
    if (parts.length < 5) { out.push({ raw: line, valid: false, reason: 'need 5 columns' }); continue; }
    const [name, area, trade, start, end] = parts;
    const dateOk = /^\d{4}-\d{2}-\d{2}$/;
    if (!name) { out.push({ raw: line, valid: false, reason: 'name empty' }); continue; }
    if (!TRADES.includes(trade.toLowerCase())) { out.push({ raw: line, valid: false, reason: 'unknown trade: ' + trade }); continue; }
    if (!dateOk.test(start) || !dateOk.test(end)) { out.push({ raw: line, valid: false, reason: 'dates must be YYYY-MM-DD' }); continue; }
    out.push({ valid: true, item: { name, area, trade: trade.toLowerCase(), plannedStart: start, plannedEnd: end } });
  }
  return out;
}

document.getElementById('import-preview-btn').addEventListener('click', () => {
  const text = document.getElementById('import-text').value;
  const rows = parseCSV(text);
  const good = rows.filter(r => r.valid);
  const bad = rows.filter(r => !r.valid);
  const preview = document.getElementById('import-preview');
  preview.innerHTML = `
    <div class="preview-summary">${good.length} valid · ${bad.length} invalid</div>
    ${good.map(r => `<div class="preview-row">✓ ${escapeHTML(r.item.name)} — ${r.item.trade} (${r.item.plannedStart} → ${r.item.plannedEnd})</div>`).join('')}
    ${bad.map(r => `<div class="preview-row bad">✗ ${escapeHTML(r.raw)} — ${r.reason}</div>`).join('')}
  `;
  document.getElementById('import-save-btn').style.display = good.length ? 'block' : 'none';
  window._importGoodRows = good.map(r => r.item);
});

document.getElementById('import-save-btn').addEventListener('click', async () => {
  if (!window._importGoodRows?.length) return;
  try {
    const res = await api('/api/schedule/bulk', { method: 'POST', body: { items: window._importGoodRows, createdBy: state.user?.name || 'import' } });
    closeSheet('import-sheet');
    showToast(`Imported ${res.count} items`);
    document.getElementById('import-text').value = '';
    document.getElementById('import-preview').innerHTML = '';
    document.getElementById('import-save-btn').style.display = 'none';
    refresh();
  } catch (err) { showToast(err.message, 'error'); }
});

// ─── Office view ────────────────────────────────────────────────────────────
function renderOfficeView() {
  // Drift snapshot
  const slipping = state.items.filter(i => i.flag === 'slipping');
  const blocked = state.items.filter(i => i.flag === 'blocked');
  const shouldStart = state.items.filter(i => i.flag === 'should_have_started');

  const subById = id => state.subs.find(s => s.id === id);
  const driftRow = i => `
    <div class="office-drift-row">
      <div class="left">
        <div class="name">${STATUS_EMOJI[i.status]} ${escapeHTML(i.name)}</div>
        <div class="meta">${escapeHTML(i.area || '—')} · ${i.trade}${i.assignedSubId ? ' · ' + escapeHTML(subById(i.assignedSubId)?.name || '') : ''} · planned ${fmtDate(i.plannedStart)} → ${fmtDate(i.plannedEnd)}${i.notes ? ' · ' + escapeHTML(i.notes) : ''}</div>
      </div>
      ${i.daysShift > 0 ? `<span class="drift-badge drift-positive">+${i.daysShift}d</span>` : ''}
    </div>`;

  document.getElementById('office-drift').innerHTML = `
    ${blocked.length ? `<div style="margin-bottom:10px;font-size:12px;font-weight:600;color:var(--danger-text)">🚫 BLOCKED (${blocked.length})</div>${blocked.map(driftRow).join('')}` : ''}
    ${slipping.length ? `<div style="margin:14px 0 10px;font-size:12px;font-weight:600;color:var(--warning-text)">⚠️ SLIPPING (${slipping.length})</div>${slipping.map(driftRow).join('')}` : ''}
    ${shouldStart.length ? `<div style="margin:14px 0 10px;font-size:12px;font-weight:600;color:var(--info-text)">⏱ SHOULD HAVE STARTED (${shouldStart.length})</div>${shouldStart.map(driftRow).join('')}` : ''}
    ${(!blocked.length && !slipping.length && !shouldStart.length) ? `<div class="empty-state" style="padding:20px">No drift. Everything's tracking ✓</div>` : ''}
  `;

  renderGantt();
}

function renderGantt() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = 21;
  const items = state.items.filter(i => i.status !== 'done');
  const colTemplate = `repeat(${days}, minmax(28px, 1fr))`;

  const headerCells = Array.from({ length: days }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() + i);
    const lbl = d.toLocaleDateString('en-CA', { month: 'numeric', day: 'numeric' });
    return `<div class="gantt-day ${i === 0 ? 'today' : ''}">${lbl}</div>`;
  }).join('');

  const rowsHTML = items.map(item => {
    const startOffset = Math.max(0, Math.round((new Date(item.plannedStart + 'T12:00:00') - today) / 86400000));
    const endOffset = Math.min(days - 1, Math.round((new Date(item.plannedEnd + 'T12:00:00') - today) / 86400000));
    if (endOffset < 0) return '';
    const span = Math.max(1, endOffset - startOffset + 1);
    const sub = item.assignedSubId ? state.subs.find(s => s.id === item.assignedSubId) : null;
    const flagClass = item.flag === 'on_track' ? item.status : item.flag;
    const colWidth = 100 / days;
    return `
      <div class="gantt-row" style="grid-template-columns:180px ${colTemplate}">
        <div class="gantt-label">${escapeHTML(item.name)}<div class="meta">${item.trade}${sub ? ' · ' + escapeHTML(sub.name) : ''}</div></div>
        <div class="gantt-track" style="grid-column: 2 / span ${days}; position:relative">
          <div class="gantt-bar ${flagClass}" style="left:${startOffset * colWidth}%; width:${span * colWidth}%" title="${escapeHTML(item.name)}">
            ${item.daysShift > 0 ? '+' + item.daysShift + 'd' : item.status}
          </div>
          <div class="gantt-today-line" style="left:${0}px"></div>
        </div>
      </div>`;
  }).join('');

  document.getElementById('gantt-wrap').innerHTML = `
    <div class="gantt">
      <div class="gantt-header" style="grid-template-columns:${colTemplate}">${headerCells}</div>
      ${rowsHTML || '<div class="empty-state" style="padding:20px">No upcoming items in the next 21 days.</div>'}
    </div>
  `;
}

// ─── Refresh ────────────────────────────────────────────────────────────────
async function refresh() {
  try {
    const params = new URLSearchParams();
    if (state.filter.window !== 'all') params.set('window', state.filter.window);
    if (state.filter.flag) params.set('flag', state.filter.flag);
    const [items, subs] = await Promise.all([
      api('/api/schedule?' + params.toString()),
      api('/api/subs')
    ]);
    state.items = items;
    state.subs = subs;
    renderStats();
    if (state.view === 'office') {
      renderOfficeView();
    } else {
      renderItems();
    }
  } catch (err) {
    document.getElementById('item-list').innerHTML = '<div class="empty-state">Cannot reach backend. Check API URL.</div>';
  }
}

// ─── View toggle ────────────────────────────────────────────────────────────
function applyView() {
  if (state.view === 'office') {
    document.getElementById('foreman-view').style.display = 'none';
    document.getElementById('office-view').style.display = 'block';
    document.getElementById('bottom-bar').style.display = 'none';
    document.getElementById('view-label').textContent = 'Office';
    document.body.style.paddingBottom = '20px';
  } else {
    document.getElementById('foreman-view').style.display = 'block';
    document.getElementById('office-view').style.display = 'none';
    document.getElementById('bottom-bar').style.display = 'flex';
    document.getElementById('view-label').textContent = 'Site';
    document.body.style.paddingBottom = 'calc(80px + env(safe-area-inset-bottom))';
  }
}

document.getElementById('view-toggle-btn').addEventListener('click', () => {
  state.view = state.view === 'office' ? 'foreman' : 'office';
  const params = new URLSearchParams(window.location.search);
  if (state.view === 'office') params.set('view', 'office'); else params.delete('view');
  const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
  window.history.replaceState({}, '', newUrl);
  applyView();
  refresh();
});

// ─── Buttons ────────────────────────────────────────────────────────────────
document.getElementById('checkin-btn').addEventListener('click', startWizard);
document.getElementById('add-btn').addEventListener('click', () => {
  if (!state.user) { openSheet('user-sheet'); return; }
  openItemSheet();
});
document.getElementById('import-btn').addEventListener('click', () => openSheet('import-sheet'));
document.getElementById('export-btn').addEventListener('click', () => {
  window.open(API_BASE + '/api/export.csv', '_blank');
});
document.getElementById('user-chip').addEventListener('click', () => openSheet('user-sheet'));
document.getElementById('save-name').addEventListener('click', () => {
  const name = document.getElementById('quick-name').value.trim();
  if (!name) { showToast('Name required', 'error'); return; }
  saveUser(name);
  closeSheet('user-sheet');
  showToast(`Hello ${name}`);
});

// Filter chips
document.querySelectorAll('#filter-row .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#filter-row .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    if (chip.dataset.window) { state.filter.window = chip.dataset.window; state.filter.flag = null; }
    else if (chip.dataset.flag) { state.filter.flag = chip.dataset.flag; state.filter.window = 'all'; }
    refresh();
  });
});

// Sheet utilities
function openSheet(id) { document.getElementById(id).classList.add('open'); }
function closeSheet(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => closeSheet(el.dataset.close)));
document.querySelectorAll('.sheet-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); }));

function showToast(msg, kind = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + kind + ' show';
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// Service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Boot
(async function boot() {
  document.getElementById('today-date').textContent = new Date().toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
  loadUser();
  if (state.user) document.getElementById('user-initials').textContent = state.user.initials;
  applyView();
  await refresh();
  if (!state.user) openSheet('user-sheet');
  setInterval(() => { if (!document.hidden) refresh(); }, 15000);
})();
