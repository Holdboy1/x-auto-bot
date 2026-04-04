import { TwitterApi } from 'twitter-api-v2';
import { db } from './db.js';

const client = new TwitterApi({
  appKey: process.env.X_API_KEY ?? '',
  appSecret: process.env.X_API_SECRET ?? '',
  accessToken: process.env.X_ACCESS_TOKEN ?? '',
  accessSecret: process.env.X_ACCESS_SECRET ?? '',
});

type StoredPost = {
  id: number;
  tweet_id: string;
};

type ScoreSource = {
  like_count?: number;
  retweet_count?: number;
  reply_count?: number;
  impression_count?: number;
};

function metricValue(value: number | undefined): number {
  return typeof value === 'number' ? value : 0;
}

export async function collectEngagement() {
  const posts = db
    .prepare(`
      SELECT id, tweet_id
      FROM posts
      WHERE tweet_id IS NOT NULL
        AND posted_at >= datetime('now', '-48 hours')
        AND (checked_at IS NULL OR checked_at < datetime('now', '-6 hours'))
    `)
    .all() as StoredPost[];

  console.log(`Checking engagement for ${posts.length} posts`);

  for (const post of posts) {
    try {
      const tweet = await client.v2.singleTweet(post.tweet_id, {
        'tweet.fields': ['public_metrics', 'organic_metrics'],
      });

      const publicMetrics = (tweet.data.public_metrics ?? {}) as ScoreSource;
      const organicMetrics = (tweet.data.organic_metrics ?? {}) as ScoreSource;

      const likes = metricValue(publicMetrics.like_count);
      const retweets = metricValue(publicMetrics.retweet_count);
      const replies = metricValue(publicMetrics.reply_count);
      const impressions =
        metricValue(organicMetrics.impression_count) + metricValue(publicMetrics.impression_count);

      const score = likes * 2 + retweets * 4 + replies * 3 + impressions * 0.01;

      db.prepare(`
        UPDATE posts
        SET likes=?, retweets=?, replies=?, impressions=?, score=?, checked_at=datetime('now')
        WHERE id=?
      `).run(likes, retweets, replies, impressions, score, post.id);

      if (score > 50) {
        const row = db
          .prepare('SELECT content, topic FROM posts WHERE id=?')
          .get(post.id) as { content: string; topic: string } | undefined;

        if (!row) {
          continue;
        }

        const exists = db
          .prepare('SELECT id FROM top_performers WHERE content=?')
          .get(row.content);

        if (!exists) {
          db.prepare(
            'INSERT INTO top_performers (content, score, topic) VALUES (?, ?, ?)',
          ).run(row.content, score, row.topic);

          console.log(`New top performer saved (${score.toFixed(1)})`);
        }
      }
    } catch (error) {
      console.error(`Engagement fetch error for ${post.tweet_id}:`, error);
    }
  }
}
