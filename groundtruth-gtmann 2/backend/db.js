import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'data', 'db.json');

const defaultData = {
  items: [],         // schedule items
  checkIns: [],      // daily status check-ins
  subs: [],
  activityLog: []
};

const adapter = new JSONFile(dbPath);
export const db = new Low(adapter, defaultData);

export async function initDb() {
  await db.read();
  db.data ||= defaultData;
  await db.write();
}

export async function logActivity(itemId, type, by, payload = {}) {
  db.data.activityLog.push({
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    itemId, type, by, payload,
    timestamp: new Date().toISOString()
  });
  if (db.data.activityLog.length > 1000) {
    db.data.activityLog = db.data.activityLog.slice(-1000);
  }
  await db.write();
}
