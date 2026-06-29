// Demo seed — pre-loads a realistic Grand & Fir 3-week schedule with built-in drift
// so the office view and foreman board are instantly demo-ready.
// Run with: npm run seed:demo (after npm run seed)

import { db, initDb } from './db.js';
import { nanoid } from 'nanoid';

await initDb();
if (!db.data.subs.length) {
  console.error('Base seed not run yet. Run `npm run seed` first.');
  process.exit(1);
}

// Clear schedule items and check-ins, keep subs
db.data.items = [];
db.data.checkIns = [];
db.data.activityLog = [];

const sub = trade => db.data.subs.find(s => s.trade === trade) || db.data.subs[0];
const today = new Date();
const day = offset => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

// ─── Build a realistic 3-week schedule. Some items have already started; some are slipping. ───
const items = [
  // Past — should be done
  { name: 'L1 Framing — North wing', area: 'Units 101-110', trade: 'framing', sub: 'framing', start: -14, end: -6, status: 'done', notes: 'Complete, VB sign-off in file' },
  { name: 'L1 MEP rough-in', area: 'Units 101-110', trade: 'plumbing', sub: 'plumbing', start: -10, end: -3, status: 'done' },

  // Present — currently active
  { name: 'L2 Framing — South wing', area: 'Units 201-208', trade: 'framing', sub: 'framing', start: -5, end: 2, status: 'on_track', notes: 'Mike T. running this' },
  { name: 'L1 Drywall hang', area: 'Units 101-110', trade: 'drywall', sub: 'drywall', start: -3, end: 4, status: 'on_track' },
  { name: 'L2 MEP rough-in', area: 'Units 201-208', trade: 'plumbing', sub: 'plumbing', start: -2, end: 5, status: 'slipping', notes: 'Inspector reschedule pushed start. +2 days behind.' },

  // Should-have-started but blocked
  { name: 'L2 Electrical rough-in', area: 'Units 201-208', trade: 'electrical', sub: 'electrical', start: -1, end: 6, status: 'blocked', notes: 'Waiting on RFI #14 (panel relocation) from Skyline' },

  // Near future
  { name: 'L1 Drywall tape & mud', area: 'Units 101-110', trade: 'drywall', sub: 'drywall', start: 4, end: 9, status: 'planned' },
  { name: 'Window install — North', area: 'Units 101-110', trade: 'glazing', sub: 'glazing', start: 2, end: 4, status: 'planned' },
  { name: 'L3 Framing — South wing', area: 'Units 301-308', trade: 'framing', sub: 'framing', start: 3, end: 11, status: 'planned' },

  // Further out
  { name: 'L1 Paint — primer', area: 'Units 101-110', trade: 'painting', sub: 'painting', start: 10, end: 14, status: 'planned' },
  { name: 'L1 Tile — bathrooms', area: 'Units 101-110', trade: 'tile', sub: 'tile', start: 12, end: 18, status: 'planned' },
  { name: 'Exterior strapping — West', area: 'West elevation', trade: 'general', sub: 'general', start: 5, end: 10, status: 'planned' },
  { name: 'L1 Cabinetry install', area: 'Units 101-110', trade: 'cabinetry', sub: 'cabinetry', start: 16, end: 21, status: 'planned' }
];

items.forEach(i => {
  const item = {
    id: 'sch_' + nanoid(8),
    name: i.name,
    area: i.area,
    trade: i.trade,
    plannedStart: day(i.start),
    plannedEnd: day(i.end),
    costCode: '',
    assignedSubId: sub(i.sub).id,
    notes: i.notes || '',
    status: i.status,
    createdBy: 'Goodtimes',
    createdAt: new Date().toISOString(),
    lastCheckIn: i.status !== 'planned' ? new Date(Date.now() - 8 * 3600_000).toISOString() : null,
    lastCheckInBy: i.status !== 'planned' ? 'Goodtimes' : null
  };
  if (i.status === 'done') item.actualEnd = day(i.end);
  db.data.items.push(item);
});

await db.write();

const stats = {
  total: db.data.items.length,
  on_track: db.data.items.filter(x => x.status === 'on_track').length,
  slipping: db.data.items.filter(x => x.status === 'slipping').length,
  blocked: db.data.items.filter(x => x.status === 'blocked').length,
  done: db.data.items.filter(x => x.status === 'done').length,
  planned: db.data.items.filter(x => x.status === 'planned').length
};

console.log('Demo schedule loaded.\n');
console.log(`Total: ${stats.total}`);
console.log(`  On track:  ${stats.on_track}`);
console.log(`  Slipping:  ${stats.slipping}`);
console.log(`  Blocked:   ${stats.blocked}`);
console.log(`  Done:      ${stats.done}`);
console.log(`  Planned:   ${stats.planned}`);
console.log('\nDemo ready. Open the app — slipping + blocked items will pop in amber/red at top.');
process.exit(0);
