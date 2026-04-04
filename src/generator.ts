import { db } from './db.js';
import { PERSONA, getMood } from './persona.js';

export type GeneratedPost = {
  text: string;
  topic: string;
};

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function getTopPerformersContext(): string {
  const rows = db
    .prepare('SELECT content FROM top_performers ORDER BY score DESC LIMIT 8')
    .all() as { content: string }[];

  if (!rows.length) {
    return '';
  }

  return `\nPosts anteriores que mais engajaram. Aprenda o estilo e evolua a partir deles:\n${rows
    .map((row) => `"${row.content}"`)
    .join('\n')}`;
}

function getRecentPostsContext(): string {
  const rows = db
    .prepare(`
      SELECT content
      FROM posts
      WHERE posted_at >= datetime('now', '-24 hours')
      ORDER BY posted_at DESC
      LIMIT 10
    `)
    .all() as { content: string }[];

  if (!rows.length) {
    return '';
  }

  return `\nPosts ja publicados hoje. NUNCA repita o mesmo assunto ou estrutura:\n${rows
    .map((row) => `"${row.content}"`)
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
  const { mood, debateFormat } = getMood();
  const topPerformers = getTopPerformersContext();
  const recentPosts = getRecentPostsContext();

  const systemPrompt = `Voce escreve posts no X imitando a voz de uma pessoa real.

IDENTIDADE DO DONO:
${PERSONA.identity}

ESTILO DE ESCRITA:
${PERSONA.writingStyle}

EXEMPLOS REAIS DE VOZ:
${PERSONA.voiceExamples.map((example) => `"${example}"`).join('\n')}

REGRAS ABSOLUTAS:
- Escreva SEMPRE em portugues brasileiro informal
- NUNCA soe como bot, robo, jornalista ou post corporativo
- NUNCA use estruturas como "Sabia que", "Descubra", "E importante"
- NUNCA enumere pontos
- Cada post deve parecer que foi digitado na hora, com opiniao real
- Responda APENAS com JSON valido, sem markdown, sem explicacao

Formato:
[{"text":"conteudo do post","topic":"nome do topico"}]`;

  const userPrompt = `Humor agora: ${mood}
Formato de debate para usar em pelo menos 3 posts: ${debateFormat}

Topicos em alta hoje: ${topics.join(', ')}

Gere exatamente ${count} posts unicos sobre esses topicos.
- Pelo menos 3 deles devem ser no formato de debate/engajamento acima
- Frases curtas e naturais
- Pode usar pergunta retorica
- Hashtag so quando ajudar
- No maximo 280 caracteres
${topPerformers}
${recentPosts}`;

  try {
    const response = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 2500,
        temperature: 0.92,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
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
