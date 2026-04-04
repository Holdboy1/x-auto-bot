import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const preferredDbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'bot.db')
  : path.join(process.cwd(), 'bot.db');

function openDatabase() {
  const candidates = [
    preferredDbPath,
    path.join(os.tmpdir(), 'x-auto-bot', 'bot.db'),
  ];

  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(path.dirname(candidate), { recursive: true });
      const database = new Database(candidate);
      return { database, path: candidate };
    } catch (error) {
      lastError = error;
      console.error(`Failed to open database at ${candidate}:`, error);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to open SQLite database');
}

const opened = openDatabase();
export const db = opened.database;
export const DB_PATH = opened.path;

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_id    TEXT,
      content     TEXT NOT NULL,
      topic       TEXT,
      posted_at   TEXT,
      likes       INTEGER DEFAULT 0,
      retweets    INTEGER DEFAULT 0,
      replies     INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      score       REAL DEFAULT 0,
      checked_at  TEXT,
      source_name TEXT,
      source_title TEXT,
      source_url  TEXT,
      angle_hint  TEXT
    );

    CREATE TABLE IF NOT EXISTS top_performers (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      content   TEXT NOT NULL UNIQUE,
      score     REAL,
      topic     TEXT,
      saved_at  TEXT DEFAULT (datetime('now'))
    );
  `);

  const columns = db.prepare(`PRAGMA table_info(posts)`).all() as Array<{ name: string }>;
  const existing = new Set(columns.map((column) => column.name));
  const addColumnIfMissing = (name: string, sqlType: string) => {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${sqlType}`);
    }
  };

  addColumnIfMissing('source_name', 'TEXT');
  addColumnIfMissing('source_title', 'TEXT');
  addColumnIfMissing('source_url', 'TEXT');
  addColumnIfMissing('angle_hint', 'TEXT');

  console.log(`DB initialised at ${DB_PATH}`);
}
