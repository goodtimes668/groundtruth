// Seed subs. Run with: npm run seed
import { db, initDb } from './db.js';
import { nanoid } from 'nanoid';

await initDb();

const subs = [
  { name: 'Crown Framing', trade: 'framing' },
  { name: 'Pacific Drywall', trade: 'drywall' },
  { name: 'Coast Electric', trade: 'electrical' },
  { name: 'Westshore Plumbing', trade: 'plumbing' },
  { name: 'Island HVAC', trade: 'hvac' },
  { name: 'Premier Paint', trade: 'painting' },
  { name: 'Apex Tile', trade: 'tile' },
  { name: 'Vancouver Glass', trade: 'glazing' },
  { name: 'BC Millwork', trade: 'cabinetry' },
  { name: 'In-house', trade: 'general' }
];

db.data.subs = subs.map(s => ({
  id: 'sub_' + nanoid(8),
  name: s.name,
  trade: s.trade,
  slackUserId: null,
  createdAt: new Date().toISOString()
}));

await db.write();
console.log(`Seeded ${db.data.subs.length} subs. Now run \`npm run seed:demo\` or add real schedule items via the app.`);
process.exit(0);
