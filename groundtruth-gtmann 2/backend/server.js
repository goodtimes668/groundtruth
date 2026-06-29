import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { nanoid } from 'nanoid';
import { db, initDb, logActivity } from './db.js';
import { notifyStatusChange, notifyDailyDrift } from './slack.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

await initDb();

// ─── Helpers ─────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);
const daysDiff = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
function computeDrift(item) {
  // Drift = how many days behind planned end.
  // Flag rules: user-set status (done/blocked/slipping) wins; otherwise compute from dates.
  const todayStr = today();
  const item2 = { ...item };
  if (item.status === 'done') {
    item2.daysShift = 0;
    item2.flag = 'done';
    return item2;
  }
  if (item.status === 'blocked') {
    item2.daysShift = Math.max(0, daysDiff(todayStr, item.plannedStart));
    item2.flag = 'blocked';
    return item2;
  }
  const todayBeyondEnd = daysDiff(todayStr, item.plannedEnd);
  const todayBeyondStart = daysDiff(todayStr, item.plannedStart);
  if (item.status === 'slipping') {
    item2.daysShift = Math.max(1, todayBeyondEnd);
    item2.flag = 'slipping';
    return item2;
  }
  if (todayBeyondEnd > 0) {
    item2.daysShift = todayBeyondEnd;
    item2.flag = 'slipping';
  } else if (todayBeyondStart > 0 && (item.status === 'planned' || item.status === 'on_track')) {
    item2.daysShift = 0;
    item2.flag = 'should_have_started';
  } else {
    item2.daysShift = 0;
    item2.flag = 'on_track';
  }
  return item2;
}

// ─── Health ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const items = db.data.items;
  const enriched = items.map(computeDrift);
  res.json({
    name: 'GroundTruth — GT Mann',
    status: 'ok',
    items: items.length,
    slipping: enriched.filter(i => i.flag === 'slipping').length,
    blocked: enriched.filter(i => i.flag === 'blocked').length,
    timestamp: new Date().toISOString()
  });
});

// ─── Subs ────────────────────────────────────────────────────────────────────
app.get('/api/subs', (req, res) => res.json(db.data.subs));
app.post('/api/subs', async (req, res) => {
  const { name, trade, slackUserId = null } = req.body;
  if (!name || !trade) return res.status(400).json({ error: 'name and trade required' });
  const sub = { id: 'sub_' + nanoid(8), name, trade, slackUserId, createdAt: new Date().toISOString() };
  db.data.subs.push(sub);
  await db.write();
  res.json(sub);
});

// ─── Schedule items ──────────────────────────────────────────────────────────
app.get('/api/schedule', (req, res) => {
  const { trade, area, status, flag, window } = req.query;
  let items = db.data.items.map(computeDrift);
  if (trade) items = items.filter(i => i.trade === trade);
  if (area) items = items.filter(i => (i.area || '').includes(area));
  if (status) items = items.filter(i => i.status === status);
  if (flag) items = items.filter(i => i.flag === flag);
  if (window) {
    const days = parseInt(window);
    const todayStr = today();
    const future = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    items = items.filter(i =>
      (i.plannedStart >= todayStr && i.plannedStart <= future) ||
      (i.plannedEnd >= todayStr && i.plannedEnd <= future) ||
      (i.plannedStart <= todayStr && i.plannedEnd >= todayStr)
    );
  }
  // Sort by plannedStart asc, then by flag severity
  const flagOrder = { blocked: 0, slipping: 1, should_have_started: 2, on_track: 3, done: 4 };
  items.sort((a, b) => {
    if (a.plannedStart !== b.plannedStart) return a.plannedStart.localeCompare(b.plannedStart);
    return (flagOrder[a.flag] ?? 9) - (flagOrder[b.flag] ?? 9);
  });
  res.json(items);
});

app.post('/api/schedule', async (req, res) => {
  const { name, area = '', trade, plannedStart, plannedEnd, costCode = '', assignedSubId = null, notes = '', createdBy = 'unknown' } = req.body;
  if (!name || !trade || !plannedStart || !plannedEnd) return res.status(400).json({ error: 'name, trade, plannedStart, plannedEnd required' });
  const item = {
    id: 'sch_' + nanoid(8),
    name, area, trade, plannedStart, plannedEnd, costCode,
    assignedSubId, notes,
    status: 'planned',
    createdBy,
    createdAt: new Date().toISOString(),
    lastCheckIn: null, lastCheckInBy: null
  };
  db.data.items.push(item);
  await db.write();
  await logActivity(item.id, 'created', createdBy, { name });
  res.json(item);
});

app.post('/api/schedule/bulk', async (req, res) => {
  const { items, createdBy = 'unknown' } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  const created = [];
  for (const row of items) {
    if (!row.name || !row.trade || !row.plannedStart || !row.plannedEnd) continue;
    const item = {
      id: 'sch_' + nanoid(8),
      name: row.name,
      area: row.area || '',
      trade: row.trade,
      plannedStart: row.plannedStart,
      plannedEnd: row.plannedEnd,
      costCode: row.costCode || '',
      assignedSubId: row.assignedSubId || null,
      notes: '',
      status: 'planned',
      createdBy,
      createdAt: new Date().toISOString(),
      lastCheckIn: null, lastCheckInBy: null
    };
    db.data.items.push(item);
    created.push(item);
  }
  await db.write();
  await logActivity(null, 'bulk_import', createdBy, { count: created.length });
  res.json({ count: created.length, items: created });
});

app.patch('/api/schedule/:id', async (req, res) => {
  const item = db.data.items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  const fields = ['name', 'area', 'trade', 'plannedStart', 'plannedEnd', 'costCode', 'assignedSubId', 'notes'];
  const before = {};
  fields.forEach(f => {
    if (f in req.body) { before[f] = item[f]; item[f] = req.body[f]; }
  });
  await db.write();
  await logActivity(item.id, 'edited', req.body.updatedBy || 'unknown', { before });
  res.json(item);
});

app.delete('/api/schedule/:id', async (req, res) => {
  const idx = db.data.items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  db.data.items.splice(idx, 1);
  await db.write();
  res.json({ ok: true });
});

// Status check-in
app.post('/api/schedule/:id/check-in', async (req, res) => {
  const item = db.data.items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  const valid = ['planned', 'in_progress', 'on_track', 'slipping', 'blocked', 'done'];
  const { status, by = 'unknown', notes } = req.body;
  if (!valid.includes(status)) return res.status(400).json({ error: 'invalid status' });

  const oldStatus = item.status;
  item.status = status;
  if (notes !== undefined) item.notes = notes;
  if (status === 'done') item.actualEnd = new Date().toISOString().slice(0, 10);
  item.lastCheckIn = new Date().toISOString();
  item.lastCheckInBy = by;

  db.data.checkIns.push({
    id: 'ci_' + nanoid(8),
    itemId: item.id,
    timestamp: new Date().toISOString(),
    by, status, notes: notes || ''
  });
  await db.write();
  await logActivity(item.id, 'status_changed', by, { from: oldStatus, to: status, notes });

  const sub = item.assignedSubId ? db.data.subs.find(s => s.id === item.assignedSubId) : null;
  if (oldStatus !== status) {
    notifyStatusChange(item, oldStatus, status, by, sub).catch(err => console.error(err));
  }
  res.json(computeDrift(item));
});

// ─── Drift & look-ahead ──────────────────────────────────────────────────────
app.get('/api/drift', (req, res) => {
  const items = db.data.items.map(computeDrift);
  const slipping = items.filter(i => i.flag === 'slipping');
  const blocked = items.filter(i => i.flag === 'blocked');
  const shouldHaveStarted = items.filter(i => i.flag === 'should_have_started');
  res.json({
    date: today(),
    slipping, blocked, shouldHaveStarted,
    totalDaysSlipped: slipping.reduce((sum, i) => sum + i.daysShift, 0)
  });
});

app.get('/api/look-ahead', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const todayStr = today();
  const future = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  let items = db.data.items.map(computeDrift);
  items = items.filter(i =>
    i.status !== 'done' && (
      (i.plannedStart >= todayStr && i.plannedStart <= future) ||
      (i.plannedStart <= todayStr && i.plannedEnd >= todayStr)
    )
  );
  // Group by day for the look-ahead grid
  const byDay = {};
  for (let d = 0; d <= days; d++) {
    const ds = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
    byDay[ds] = items.filter(i => i.plannedStart <= ds && i.plannedEnd >= ds);
  }
  items.sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));
  res.json({ days, items, byDay });
});

// Post a daily drift summary to Slack
app.post('/api/drift/post', async (req, res) => {
  const items = db.data.items.map(computeDrift);
  const summary = {
    date: today(),
    slipping: items.filter(i => i.flag === 'slipping'),
    blocked: items.filter(i => i.flag === 'blocked')
  };
  await notifyDailyDrift(summary);
  res.json({ ok: true, posted: summary.slipping.length + summary.blocked.length });
});

// CSV export (for owner meetings)
app.get('/api/export.csv', (req, res) => {
  const items = db.data.items.map(computeDrift);
  const subs = db.data.subs;
  const header = ['Name', 'Area', 'Trade', 'Sub', 'Cost Code', 'Planned Start', 'Planned End', 'Status', 'Days Shift', 'Last Check-In', 'Notes'];
  const rows = items.map(i => {
    const sub = subs.find(s => s.id === i.assignedSubId);
    return [
      i.name, i.area, i.trade, sub ? sub.name : '', i.costCode || '',
      i.plannedStart, i.plannedEnd, i.status, i.daysShift,
      i.lastCheckIn ? new Date(i.lastCheckIn).toLocaleString('en-CA') : '',
      (i.notes || '').replace(/[\r\n]+/g, ' ')
    ];
  });
  const escape = v => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map(r => r.map(escape).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="groundtruth-${today()}.csv"`);
  res.send(csv);
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`[groundtruth] listening on port ${PORT}`));
