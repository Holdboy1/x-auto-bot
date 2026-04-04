import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'bot.db')
  : path.join(process.cwd(), 'bot.db');

export const db = new Database(DB_PATH);

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
      checked_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS top_performers (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      content   TEXT NOT NULL UNIQUE,
      score     REAL,
      topic     TEXT,
      saved_at  TEXT DEFAULT (datetime('now'))
    );
  `);

  console.log(`DB initialised at ${DB_PATH}`);
}
