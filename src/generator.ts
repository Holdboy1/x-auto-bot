import { db } from './db.js';

export type GeneratedPost = {
  text: string;
  topic: string;
};

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function getTopPerformersContext(): string {
  const rows = db
    .prepare('SELECT content FROM top_performers ORDER BY score DESC LIMIT 5')
    .all() as { content: string }[];

  if (!rows.length) {
    return '';
  }

  return `\nTop posts that performed best recently. Use them only as style reference, not as templates:\n${rows
    .map((row) => `- ${row.content}`)
    .join('\n')}`;
}

function sanitizePosts(posts: GeneratedPost[], count: number, topics: string[]): GeneratedPost[] {
  const fallbackTopic = topics[0] ?? 'general';

  return posts
    .filter((post) => typeof post?.text === 'string' && post.text.trim())
    .slice(0, count)
    .map((post) => ({
      text: post.text.trim().slice(0, 280),
      topic: (post.topic || fallbackTopic).trim(),
    }));
}

export async function generatePosts(topics: string[], count = 10): Promise<GeneratedPost[]> {
  const topPerformers = getTopPerformersContext();

  const prompt = `You are a crypto/web3/tech Twitter influencer with a sharp, insightful voice.
Generate exactly ${count} tweets about these trending topics: ${topics.join(', ')}.

Rules:
- Max 280 characters each
- Mix formats: hot takes, stats, questions, thread teasers, alpha insights
- 2-3 relevant hashtags per tweet
- Max 2 emojis per tweet
- Vary tone: bullish, analytical, provocative
- English only
- Never repeat the same structure twice
${topPerformers}

Respond ONLY with a valid JSON array, no markdown, no extra text:
[{"text":"tweet content","topic":"topic name"},...]`;

  try {
    const response = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 2000,
        temperature: 0.85,
        messages: [
          {
            role: 'system',
            content:
              'You are a crypto/web3/tech Twitter influencer. Always respond with valid JSON only, no markdown, no explanation.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!response.ok || data.error) {
      console.error('Groq generation error:', data.error?.message || response.statusText);
      return [];
    }

    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      console.error('Groq returned an empty response');
      return [];
    }

    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean) as GeneratedPost[];
    const posts = sanitizePosts(parsed, count, topics);

    console.log(`Generated ${posts.length} posts via Groq`);
    return posts;
  } catch (error) {
    console.error('Post generation error:', error);
    return [];
  }
}
