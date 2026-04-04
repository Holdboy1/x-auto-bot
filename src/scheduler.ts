import { db } from './db.js';
import type { GeneratedPost } from './generator.js';
import { publishPost } from './publisher.js';

type PendingPostRow = GeneratedPost & {
  id: number;
  scheduled_for: string;
};

let dispatchInFlight = false;

function toSqliteDate(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

export function hasPendingPostsForDay(day: string): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) as total
       FROM pending_posts
       WHERE created_for_day = ?
         AND status IN ('queued', 'publishing')`,
    )
    .get(day) as { total: number };

  return row.total > 0;
}

export function enqueuePosts(posts: GeneratedPost[], startHour: number, endHour: number, now = new Date()): void {
  if (!posts.length) {
    return;
  }

  const day = now.toISOString().slice(0, 10);
  const start = new Date(now);
  start.setHours(startHour, 0, 0, 0);

  const end = new Date(now);
  end.setHours(endHour, 0, 0, 0);

  const gapMinutes = ((end.getTime() - start.getTime()) / 60000) / posts.length;
  const insert = db.prepare(`
    INSERT INTO pending_posts (
      content, topic, scheduled_for, status, created_for_day,
      source_name, source_title, source_url, angle_hint
    ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    posts.forEach((post, index) => {
      const scheduledDate = new Date(start.getTime() + index * gapMinutes * 60 * 1000);
      insert.run(
        post.text,
        post.topic,
        toSqliteDate(scheduledDate),
        day,
        post.sourceName || null,
        post.sourceTitle || null,
        post.sourceUrl || null,
        post.angleHint || null,
      );
    });
  });

  transaction();
  console.log(`Queued ${posts.length} posts for ${day}`);
}

export async function dispatchNextPost(): Promise<void> {
  if (dispatchInFlight) {
    return;
  }

  dispatchInFlight = true;

  try {
    const next = db
      .prepare(`
        SELECT id, content as text, topic, source_name as sourceName,
               source_title as sourceTitle, source_url as sourceUrl,
               angle_hint as angleHint, scheduled_for
        FROM pending_posts
        WHERE status = 'queued'
          AND scheduled_for <= datetime('now')
        ORDER BY scheduled_for ASC
        LIMIT 1
      `)
      .get() as PendingPostRow | undefined;

    if (!next) {
      return;
    }

    db.prepare(`UPDATE pending_posts SET status='publishing' WHERE id=?`).run(next.id);

    const tweetId = await publishPost(next);

    if (tweetId) {
      db.prepare(`
        UPDATE pending_posts
        SET status='published', tweet_id=?, published_at=datetime('now')
        WHERE id=?
      `).run(tweetId, next.id);
    } else {
      db.prepare(`
        UPDATE pending_posts
        SET status='failed', failed_at=datetime('now'), failure_reason=?
        WHERE id=?
      `).run('publishPost returned null', next.id);
    }
  } finally {
    dispatchInFlight = false;
  }
}
