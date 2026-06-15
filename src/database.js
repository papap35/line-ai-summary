import Database from 'better-sqlite3';
import { DateTime } from 'luxon';

const DB_PATH = process.env.DB_PATH || 'messages.db';
const TIMEZONE = process.env.TIMEZONE || 'Asia/Taipei';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    user_id TEXT,
    display_name TEXT,
    message TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_messages_group_time ON messages (group_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_summaries_group_date ON summaries (group_id, date);
`);

const SQLITE_TS_FORMAT = 'yyyy-MM-dd HH:mm:ss';

// SQLite's CURRENT_TIMESTAMP is UTC in "yyyy-MM-dd HH:mm:ss" form, so range
// bounds must be formatted the same way for string comparison to stay correct.
function dayRangeUtc(dateStr) {
  const start = DateTime.fromISO(dateStr, { zone: TIMEZONE }).startOf('day').toUTC();
  const end = start.plus({ days: 1 });
  return {
    start: start.toFormat(SQLITE_TS_FORMAT),
    end: end.toFormat(SQLITE_TS_FORMAT),
  };
}

export function todayString() {
  return DateTime.now().setZone(TIMEZONE).toISODate();
}

export function saveMessage({ groupId, userId, displayName, message }) {
  db.prepare(
    `INSERT INTO messages (group_id, user_id, display_name, message) VALUES (?, ?, ?, ?)`
  ).run(groupId, userId ?? null, displayName ?? null, message);
}

export function getTodayMessages(groupId, dateStr = todayString()) {
  const { start, end } = dayRangeUtc(dateStr);
  return db
    .prepare(
      `SELECT user_id, display_name, message, timestamp FROM messages
       WHERE group_id = ? AND timestamp >= ? AND timestamp < ?
       ORDER BY timestamp ASC`
    )
    .all(groupId, start, end);
}

export function getActiveGroups(dateStr = todayString()) {
  const { start, end } = dayRangeUtc(dateStr);
  const rows = db
    .prepare(
      `SELECT DISTINCT group_id FROM messages WHERE timestamp >= ? AND timestamp < ?`
    )
    .all(start, end);
  return rows.map((r) => r.group_id);
}

export function saveSummary(groupId, summary, dateStr = todayString()) {
  db.prepare(
    `INSERT INTO summaries (group_id, summary, date) VALUES (?, ?, ?)`
  ).run(groupId, summary, dateStr);
}

export function getSummary(groupId, dateStr = todayString()) {
  const row = db
    .prepare(
      `SELECT summary FROM summaries WHERE group_id = ? AND date = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(groupId, dateStr);
  return row ? row.summary : null;
}

export function purgeOldMessages(retentionDays = 7) {
  const cutoff = DateTime.now().minus({ days: retentionDays }).toUTC().toFormat(SQLITE_TS_FORMAT);
  db.prepare(`DELETE FROM messages WHERE timestamp < ?`).run(cutoff);
}
