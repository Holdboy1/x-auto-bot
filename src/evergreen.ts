import { db } from './db.js';
import { PERSONA } from './persona.js';
import { publishPost } from './publisher.js';
import { isPostingPaused } from './runtime-flags.js';
import type { TrendItem } from './trends.js';

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const EVERGREEN_TOPICS = [
  { topic: 'por que a maioria das pessoas perde dinheiro em crypto', category: 'crypto' },
  { topic: 'o que ninguem te conta sobre DeFi antes de entrar', category: 'crypto' },
  { topic: 'como Bitcoin mudou a forma de pensar sobre dinheiro', category: 'crypto' },
  { topic: 'o que separa os devs que crescem dos que ficam parados', category: 'tech' },
  { topic: 'IA vai substituir devs ou criar mais oportunidade', category: 'ai' },
  { topic: 'por que a maioria dos projetos Web3 morre no primeiro ano', category: 'web3' },
  { topic: 'o que aprendi errando em crypto que nao conto pra todo mundo', category: 'crypto' },
  { topic: 'modelos de IA ficaram tao bons que assusta', category: 'ai' },
  { topic: 'qual a diferenca entre especular e investir em crypto', category: 'crypto' },
  { topic: 'os 3 erros que iniciantes cometem em DeFi', category: 'crypto' },
  { topic: 'por que Ethereum ainda importa mesmo com concorrentes melhores', category: 'crypto' },
  { topic: 'o que o ciclo atual de AI tem de diferente dos anteriores', category: 'ai' },
] as const;

function initEvergreenTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evergreen_posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      content    TEXT NOT NULL,
      topic      TEXT,
      category   TEXT,
      used       INTEGER DEFAULT 0,
      used_at    TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

async function generateEvergreenText(topic: string): Promise<string | null> {
  const prompt = `Voce escreve posts no X sobre crypto, AI e tech com voz de pessoa real.

ESTILO:
${PERSONA.writingStyle}

EXEMPLOS:
${PERSONA.voiceExamples.map((example) => `"${example}"`).join('\n')}

Gere 1 post sobre: "${topic}"
- Maximo 280 caracteres
- Portugues brasileiro informal
- Deve parecer opiniao pessoal, nao artigo
- Responda APENAS o texto do post, sem aspas, sem explicacao`;

  try {
    const response = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 120,
        temperature: 0.9,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return data.choices?.[0]?.message?.content?.trim()?.replace(/^["']|["']$/g, '') ?? null;
  } catch (error) {
    console.error('Evergreen generation error:', error);
    return null;
  }
}

export async function buildEvergreenStock() {
  initEvergreenTable();

  const existing = db
    .prepare(`SELECT COUNT(*) as total FROM evergreen_posts WHERE used = 0`)
    .get() as { total: number };

  if (existing.total >= 5) {
    console.log(`Evergreen stock OK: ${existing.total} posts available`);
    return;
  }

  const usedTopics = db
    .prepare(`
      SELECT topic
      FROM evergreen_posts
      WHERE used_at >= datetime('now', '-30 days')
    `)
    .all() as Array<{ topic: string }>;

  const usedSet = new Set(usedTopics.map((row) => row.topic));
  const available = EVERGREEN_TOPICS.filter((item) => !usedSet.has(item.topic));
  const toGenerate = available.slice(0, 7);

  for (const item of toGenerate) {
    const text = await generateEvergreenText(item.topic);
    if (!text) {
      continue;
    }

    db.prepare(`
      INSERT INTO evergreen_posts (content, topic, category)
      VALUES (?, ?, ?)
    `).run(text, item.topic, item.category);
  }

  console.log(`Evergreen stock built: ${toGenerate.length} posts added`);
}

export async function useEvergreenPost(): Promise<boolean> {
  initEvergreenTable();

  if (isPostingPaused()) {
    console.log('Posting paused, skipping evergreen publish');
    return false;
  }

  const post = db
    .prepare(`
      SELECT id, content, topic, category
      FROM evergreen_posts
      WHERE used = 0
      ORDER BY RANDOM()
      LIMIT 1
    `)
    .get() as { id: number; content: string; topic: string; category: string } | undefined;

  if (!post) {
    console.log('No evergreen posts available');
    return false;
  }

  await publishPost({
    text: post.content,
    topic: post.topic,
    category: post.category as 'ai' | 'crypto' | 'web3' | 'tech' | 'general',
  });

  db.prepare(`
    UPDATE evergreen_posts
    SET used = 1, used_at = datetime('now')
    WHERE id = ?
  `).run(post.id);

  console.log(`Evergreen post used: "${post.content.slice(0, 60)}..."`);
  return true;
}

export async function getEvergreenFallbackItems(limit = 3): Promise<TrendItem[]> {
  initEvergreenTable();

  let available = db
    .prepare(`
      SELECT id, content, topic, category
      FROM evergreen_posts
      WHERE used = 0
      ORDER BY created_at ASC
      LIMIT ?
    `)
    .all(limit) as Array<{ id: number; content: string; topic: string; category: string }>;

  if (available.length < limit) {
    await buildEvergreenStock();
    available = db
      .prepare(`
        SELECT id, content, topic, category
        FROM evergreen_posts
        WHERE used = 0
        ORDER BY created_at ASC
        LIMIT ?
      `)
      .all(limit) as Array<{ id: number; content: string; topic: string; category: string }>;
  }

  return available.map((post) => ({
    topic: post.topic,
    source: 'Evergreen',
    score: 3,
    summary: post.content,
    category: post.category as TrendItem['category'],
    signal: 'trend',
    angleHint: 'conteudo evergreen de reserva para manter a cadencia sem depender do noticiario',
  }));
}
