import type { GeneratedPost } from './generator.js';
import { db } from './db.js';
import { fetchRemoteImage } from './media.js';
import { getXClient } from './x-client.js';

export async function publishPost(post: GeneratedPost) {
  const client = getXClient();
  if (!client) {
    return null;
  }

  try {
    let mediaIds: [string] | undefined;

    if (post.imageUrl) {
      const image = await fetchRemoteImage(post.imageUrl);
      if (image) {
        try {
          const mediaId = await client.v2.uploadMedia(image.buffer, {
            media_type: image.mimeType,
            media_category: 'tweet_image',
          });
          mediaIds = [mediaId];
        } catch (error) {
          console.error(`Media upload failed for ${post.imageUrl}:`, error);
        }
      }
    }

    const tweet = await client.v2.tweet({
      text: post.text,
      ...(mediaIds ? { media: { media_ids: mediaIds } } : {}),
    });

    db.prepare(`
      INSERT INTO posts (tweet_id, content, topic, posted_at, source_name, source_title, source_url, angle_hint, image_url)
      VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?)
    `).run(
      tweet.data.id,
      post.text,
      post.topic,
      post.sourceName || null,
      post.sourceTitle || null,
      post.sourceUrl || null,
      post.angleHint || null,
      post.imageUrl || null,
    );

    console.log(`Posted [${post.topic}]${mediaIds ? ' with image' : ''}: ${post.text.slice(0, 60)}...`);
    return tweet.data.id;
  } catch (error) {
    console.error('Publish error:', error);
    return null;
  }
}
