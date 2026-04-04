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

function getScheduleStart(now: Date, requestedStartHour: number): Date {
  const requestedStart = new Date(now);
  requestedStart.setHours(requestedStartHour, 0, 0, 0);

  const minimumStart = new Date(now.getTime() + 5 * 60 * 1000);
  return requestedStart > minimumStart ? requestedStart : minimumStart;
}

function getMinimumGapMinutes(): number {
  const postsPerDay = Number(process.env.POSTS_PER_DAY) || 10;
  const startHour = Number(process.env.POST_START_HOUR) || 8;
  const endHour = Number(process.env.POST_END_HOUR) || 22;
  const windowMinutes = Math.max(60, (endHour - startHour) * 60);
  return Math.max(30, Math.floor(windowMinutes / postsPerDay));
}

function publishedTooRecently(): boolean {
  const row = db
    .prepare(
      `SELECT published_at
       FROM pending_posts
       WHERE status = 'published'
         AND published_at IS NOT NULL
       ORDER BY published_at DESC
       LIMIT 1`,
    )
    .get() as { published_at?: string } | undefined;

  if (!row?.published_at) {
    return false;
  }

  const lastPublishedAt = new Date(`${row.published_at}Z`);
  const elapsedMinutes = (Date.now() - lastPublishedAt.getTime()) / 60000;
  return elapsedMinutes < getMinimumGapMinutes();
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
  const start = getScheduleStart(now, startHour);

  const end = new Date(now);
  end.setHours(endHour, 0, 0, 0);

  if (end <= start) {
    end.setTime(start.getTime() + posts.length * 90 * 60 * 1000);
  }

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
  console.log(`Queued ${posts.length} posts for ${day} starting at ${toSqliteDate(start)}`);
}

export async function dispatchNextPost(): Promise<void> {
  if (dispatchInFlight) {
    return;
  }

  dispatchInFlight = true;

  try {
    if (publishedTooRecently()) {
      return;
    }

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
