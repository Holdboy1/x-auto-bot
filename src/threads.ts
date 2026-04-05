import { db } from './db.js';
import { PERSONA, getMood } from './persona.js';
import { getXClient } from './x-client.js';
import type { TrendItem } from './trends.js';

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

type ThreadContext = 'urgent' | 'daily' | 'weekly_recap' | 'comparison';

type ThreadPost = {
  text: string;
  topic: string;
  isFirst: boolean;
  threadIndex: number;
};

export async function generateThread(
  item: TrendItem & { urgencyScore?: number },
  context: ThreadContext = 'daily',
  threadSize = Number(process.env.THREAD_SIZE) || 3,
): Promise<ThreadPost[]> {
  const { mood } = getMood();

  const contextGuide: Record<ThreadContext, string> = {
    urgent:
      'evento acontecendo agora. primeiro post reage imediatamente, os seguintes aprofundam o impacto e terminam com leitura propria',
    daily:
      'assunto relevante do dia. abre com gancho forte, desenvolve com dado ou argumento, fecha com opiniao ou pergunta',
    weekly_recap:
      'resumo da semana. lista os 3 maiores acontecimentos de forma natural, sem parecer newsletter',
    comparison:
      'comparativo entre dois projetos, modelos ou narrativas. abre a tensao, desenvolve cada lado, fecha com leitura propria',
  };

  const systemPrompt = `Voce escreve threads no X imitando a voz desta pessoa.

IDENTIDADE:
${PERSONA.identity}

ESTILO:
${PERSONA.writingStyle}

EXEMPLOS DE VOZ:
${PERSONA.voiceExamples.map((example) => `"${example}"`).join('\n')}

REGRAS ABSOLUTAS:
- Cada post da thread maximo 280 caracteres
- Portugues brasileiro informal
- O primeiro post tem que prender
- Posts seguintes aprofundam sem repetir o que ja foi dito
- NUNCA numere os posts
- NUNCA comece posts seguintes com "Alem disso" ou "Tambem"
- Thread deve parecer pensamento fluindo, nao roteiro
- Responda APENAS com JSON valido`;

  const userPrompt = `Contexto da thread: ${contextGuide[context]}
Humor: ${mood}

Topico: ${item.topic}
Resumo: ${item.summary}
Fonte: ${item.source}

Gere uma thread de ${threadSize} posts sobre este topico.

Formato:
[
  {"text": "primeiro post", "isFirst": true, "threadIndex": 0},
  {"text": "segundo post", "isFirst": false, "threadIndex": 1},
  {"text": "terceiro post", "isFirst": false, "threadIndex": 2}
]`;

  try {
    const response = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 800,
        temperature: 0.88,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message: string };
    };

    if (!response.ok || data.error) {
      console.error('Thread generation error:', data.error?.message || response.statusText);
      return [];
    }

    const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const posts = JSON.parse(clean) as ThreadPost[];
    const withTopic = posts.map((post) => ({ ...post, topic: item.topic }));

    await publishThread(withTopic);
    console.log(`Thread published: ${withTopic.length} posts about "${item.topic}"`);
    return withTopic;
  } catch (error) {
    console.error('Thread generation error:', error);
    return [];
  }
}

async function publishThread(posts: ThreadPost[]) {
  const client = getXClient();
  if (!client) {
    return;
  }

  let lastTweetId: string | null = null;

  for (const post of posts) {
    try {
      if (lastTweetId) {
        const delay = (30 + Math.random() * 60) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      let tweetId: string;

      if (lastTweetId) {
        const replyTweet = await client.v2.reply(post.text, lastTweetId);
        tweetId = replyTweet.data.id;
      } else {
        const rootTweet = await client.v2.tweet({ text: post.text });
        tweetId = rootTweet.data.id;
      }

      lastTweetId = tweetId;

      db.prepare(`
        INSERT INTO posts (tweet_id, content, topic, posted_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(tweetId, post.text, post.topic);

      console.log(`Thread post [${post.threadIndex + 1}]: ${post.text.slice(0, 60)}...`);
    } catch (error) {
      console.error(`Thread post ${post.threadIndex} failed:`, error);
      break;
    }
  }
}

export async function generateWeeklyRecap() {
  const topTopics = db
    .prepare(`
      SELECT topic, SUM(likes + retweets * 2 + replies * 3) as total_eng
      FROM posts
      WHERE posted_at >= datetime('now', '-7 days')
        AND tweet_id IS NOT NULL
      GROUP BY topic
      ORDER BY total_eng DESC
      LIMIT 3
    `)
    .all() as Array<{ topic: string; total_eng: number }>;

  if (topTopics.length < 2) {
    console.log('Not enough data for weekly recap');
    return;
  }

  const recapItem: TrendItem = {
    topic: 'Recap da semana',
    source: 'Weekly',
    score: 10,
    summary: `Os maiores assuntos da semana foram: ${topTopics.map((topic) => topic.topic).join(', ')}`,
    category: 'general',
    signal: 'trend',
    angleHint: 'resume os maiores acontecimentos da semana de forma natural e opinativa',
  };

  await generateThread(recapItem, 'weekly_recap', Number(process.env.THREAD_SIZE) || 3);
  console.log('Weekly recap published');
}
