import type { GeneratedPost } from './generator.js';
import { db } from './db.js';
import { getXClient } from './x-client.js';

export async function publishPost(post: GeneratedPost) {
  const client = getXClient();
  if (!client) {
    return null;
  }

  try {
    const tweet = await client.v2.tweet(post.text);

    db.prepare(`
      INSERT INTO posts (tweet_id, content, topic, posted_at, source_name, source_title, source_url, angle_hint)
      VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?)
    `).run(
      tweet.data.id,
      post.text,
      post.topic,
      post.sourceName || null,
      post.sourceTitle || null,
      post.sourceUrl || null,
      post.angleHint || null,
    );

    console.log(`Posted [${post.topic}]: ${post.text.slice(0, 60)}...`);
    return tweet.data.id;
  } catch (error) {
    console.error('Publish error:', error);
    return null;
  }
}
