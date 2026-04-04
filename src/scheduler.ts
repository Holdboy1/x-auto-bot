import { buildTopicFingerprint } from './content-rules.js';
import { db } from './db.js';
import type { GeneratedPost } from './generator.js';
import { publishPost } from './publisher.js';

type PendingPostRow = GeneratedPost & {
  id: number;
  scheduled_for: string;
};

type ScheduleBucket = {
  name: 'morning' | 'afternoon' | 'night';
  weight: number;
  start: Date;
  end: Date;
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

function roundCountAllocation(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => (total * weight) / weightSum);
  const base = raw.map((value) => Math.floor(value));
  let assigned = base.reduce((sum, value) => sum + value, 0);

  const fractionalOrder = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (const item of fractionalOrder) {
    if (assigned >= total) {
      break;
    }

    base[item.index] += 1;
    assigned += 1;
  }

  return base;
}

function buildScheduleBuckets(now: Date, startHour: number, endHour: number): ScheduleBucket[] {
  const minimumStart = getScheduleStart(now, startHour);
  const morningEndHour = Math.min(12, endHour);
  const afternoonEndHour = Math.min(18, endHour);

  const rawBuckets: ScheduleBucket[] = [
    {
      name: 'morning',
      weight: 2,
      start: new Date(now),
      end: new Date(now),
    },
    {
      name: 'afternoon',
      weight: 5,
      start: new Date(now),
      end: new Date(now),
    },
    {
      name: 'night',
      weight: 3,
      start: new Date(now),
      end: new Date(now),
    },
  ];

  rawBuckets[0].start.setHours(startHour, 0, 0, 0);
  rawBuckets[0].end.setHours(morningEndHour, 0, 0, 0);
  rawBuckets[1].start.setHours(Math.max(startHour, 12), 0, 0, 0);
  rawBuckets[1].end.setHours(afternoonEndHour, 0, 0, 0);
  rawBuckets[2].start.setHours(Math.max(startHour, 18), 0, 0, 0);
  rawBuckets[2].end.setHours(endHour, 0, 0, 0);

  return rawBuckets
    .map((bucket) => ({
      ...bucket,
      start: bucket.start < minimumStart ? new Date(minimumStart) : bucket.start,
    }))
    .filter((bucket) => bucket.end > bucket.start);
}

function getScheduledDates(totalPosts: number, now: Date, startHour: number, endHour: number): Date[] {
  const buckets = buildScheduleBuckets(now, startHour, endHour);

  if (!buckets.length) {
    const fallbackStart = getScheduleStart(now, startHour);
    return Array.from({ length: totalPosts }, (_, index) => new Date(fallbackStart.getTime() + index * 90 * 60 * 1000));
  }

  const allocations = roundCountAllocation(
    totalPosts,
    buckets.map((bucket) => bucket.weight),
  );

  const scheduledDates: Date[] = [];

  buckets.forEach((bucket, bucketIndex) => {
    const bucketPosts = allocations[bucketIndex] ?? 0;
    if (bucketPosts <= 0) {
      return;
    }

    const bucketDuration = bucket.end.getTime() - bucket.start.getTime();
    const gapMs = bucketDuration / bucketPosts;

    for (let index = 0; index < bucketPosts; index += 1) {
      scheduledDates.push(new Date(bucket.start.getTime() + gapMs * index));
    }
  });

  return scheduledDates.slice(0, totalPosts);
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

export function pruneDuplicatePendingPosts(day: string): number {
  const rows = db
    .prepare(
      `SELECT id, topic, source_title, source_url, content
       FROM pending_posts
       WHERE created_for_day = ?
         AND status = 'queued'
       ORDER BY scheduled_for ASC, id ASC`,
    )
    .all(day) as Array<{
      id: number;
      topic?: string;
      source_title?: string;
      source_url?: string;
      content?: string;
    }>;

  const seenSubjects = new Set<string>();
  const duplicateIds: number[] = [];

  for (const row of rows) {
    const subjectKey = buildTopicFingerprint(row.topic, row.source_title, row.source_url, row.content);
    if (!subjectKey) {
      continue;
    }

    if (seenSubjects.has(subjectKey)) {
      duplicateIds.push(row.id);
      continue;
    }

    seenSubjects.add(subjectKey);
  }

  if (!duplicateIds.length) {
    return 0;
  }

  const markDuplicate = db.prepare(
    `UPDATE pending_posts
     SET status = 'failed', failed_at = datetime('now'), failure_reason = 'pruned duplicate subject'
     WHERE id = ?`,
  );

  const transaction = db.transaction(() => {
    duplicateIds.forEach((id) => markDuplicate.run(id));
  });

  transaction();
  return duplicateIds.length;
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
  const existingRows = db
    .prepare(
      `SELECT topic, source_title, source_url
       FROM pending_posts
       WHERE created_for_day = ?
         AND status IN ('queued', 'publishing', 'published')`,
    )
    .all(day) as Array<{ topic?: string; source_title?: string; source_url?: string }>;
  const existingSubjects = new Set(
    existingRows
      .map((row) => buildTopicFingerprint(row.topic, row.source_title, row.source_url))
      .filter(Boolean),
  );
  const uniquePosts = posts.filter((post) => {
    const subjectKey = buildTopicFingerprint(post.topic, post.sourceTitle, post.sourceUrl);
    if (!subjectKey || existingSubjects.has(subjectKey)) {
      return false;
    }

    existingSubjects.add(subjectKey);
    return true;
  });

  if (!uniquePosts.length) {
    console.log(`Skipped enqueue for ${day}; all posts were duplicates of queued/published subjects`);
    return;
  }

  const scheduledDates = getScheduledDates(uniquePosts.length, now, startHour, endHour);
  const insert = db.prepare(`
    INSERT INTO pending_posts (
      content, topic, scheduled_for, status, created_for_day,
      source_name, source_title, source_url, angle_hint, image_url
    ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    uniquePosts.forEach((post, index) => {
      const scheduledDate = scheduledDates[index] || new Date(now.getTime() + (index + 1) * 90 * 60 * 1000);
      insert.run(
        post.text,
        post.topic,
        toSqliteDate(scheduledDate),
        day,
        post.sourceName || null,
        post.sourceTitle || null,
        post.sourceUrl || null,
        post.angleHint || null,
        post.imageUrl || null,
      );
    });
  });

  transaction();
  console.log(`Queued ${uniquePosts.length} posts for ${day} with buckets 2/5/3`);
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
               angle_hint as angleHint, image_url as imageUrl, scheduled_for
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
