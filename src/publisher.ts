import { TwitterApi } from 'twitter-api-v2';
import type { GeneratedPost } from './generator.js';
import { db } from './db.js';

const client = new TwitterApi({
  appKey: process.env.X_API_KEY ?? '',
  appSecret: process.env.X_API_SECRET ?? '',
  accessToken: process.env.X_ACCESS_TOKEN ?? '',
  accessSecret: process.env.X_ACCESS_SECRET ?? '',
});

export async function publishPost(post: GeneratedPost) {
  try {
    const tweet = await client.v2.tweet(post.text);

    db.prepare(`
      INSERT INTO posts (tweet_id, content, topic, posted_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(tweet.data.id, post.text, post.topic);

    console.log(`Posted [${post.topic}]: ${post.text.slice(0, 60)}...`);
    return tweet.data.id;
  } catch (error) {
    console.error('Publish error:', error);
    return null;
  }
}
