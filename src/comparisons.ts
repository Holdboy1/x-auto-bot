import { db } from './db.js';
import { PERSONA } from './persona.js';
import { publishPost } from './publisher.js';
import { isPostingPaused } from './runtime-flags.js';

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const COMPARISON_PAIRS = [
  { a: 'Claude', b: 'GPT-5', category: 'ai', angle: 'qualidade vs custo por token' },
  { a: 'Groq', b: 'OpenAI API', category: 'ai', angle: 'velocidade vs capacidade' },
  { a: 'Cursor', b: 'Claude Code', category: 'ai', angle: 'experiencia de uso e custo' },
  { a: 'DeepSeek', b: 'Claude', category: 'ai', angle: 'custo por qualidade' },
  { a: 'Gemini Flash', b: 'Haiku', category: 'ai', angle: 'opcoes baratas de API' },
  { a: 'Bitcoin', b: 'Ethereum', category: 'crypto', angle: 'reserva de valor vs plataforma' },
  { a: 'Solana', b: 'Ethereum', category: 'crypto', angle: 'velocidade vs descentralizacao' },
  { a: 'DeFi', b: 'CeFi', category: 'crypto', angle: 'autonomia vs facilidade' },
  { a: 'Layer 2', b: 'Solana', category: 'crypto', angle: 'escalabilidade de Ethereum vs L1 nativo' },
  { a: 'Web3', b: 'Web2', category: 'tech', angle: 'controle de dados e monetizacao' },
  { a: 'Self-custody', b: 'Exchange', category: 'crypto', angle: 'seguranca vs conveniencia' },
] as const;

async function generateComparisonPost(pair: (typeof COMPARISON_PAIRS)[number]): Promise<string | null> {
  const prompt = `Voce escreve posts no X sobre crypto, AI e tech com voz de pessoa real.

ESTILO:
${PERSONA.writingStyle}

EXEMPLOS:
${PERSONA.voiceExamples.map((example) => `"${example}"`).join('\n')}

Gere 1 post de comparativo entre "${pair.a}" e "${pair.b}".
Angulo: ${pair.angle}

O post deve:
- Tomar um lado OU apresentar a tensao de forma que gere debate
- Parecer opiniao pessoal baseada em experiencia
- Maximo 280 caracteres
- Portugues brasileiro informal
- Nunca parecer review corporativo
- Responda APENAS o texto do post`;

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
    console.error('Comparison generation error:', error);
    return null;
  }
}

export async function publishComparison() {
  if (isPostingPaused()) {
    console.log('Posting paused, skipping comparison post');
    return;
  }

  const usedPairs = db
    .prepare(`
      SELECT topic
      FROM posts
      WHERE posted_at >= datetime('now', '-7 days')
        AND topic LIKE '%vs%'
    `)
    .all() as Array<{ topic: string }>;

  const usedSet = new Set(usedPairs.map((row) => row.topic));
  const available = COMPARISON_PAIRS.filter((pair) => !usedSet.has(`${pair.a} vs ${pair.b}`));

  if (!available.length) {
    console.log('All comparison pairs used recently');
    return;
  }

  const pair = available[Math.floor(Math.random() * available.length)];
  const text = await generateComparisonPost(pair);
  if (!text) {
    return;
  }

  await publishPost({
    text,
    topic: `${pair.a} vs ${pair.b}`,
    category: pair.category as 'ai' | 'crypto' | 'web3' | 'tech' | 'general',
    angleHint: pair.angle,
  });

  console.log(`Comparison post published: ${pair.a} vs ${pair.b}`);
}
