import { db } from './db.js';
import { EXPLAINER_PERSONA, PERSONA, getMood, getVoiceMode } from './persona.js';
import type { TrendItem } from './trends.js';

export type GeneratedPost = {
  text: string;
  topic: string;
  category?: TrendItem['category'];
  sourceName?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  angleHint?: string;
  imageUrl?: string;
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

function getItemForPost(post: GeneratedPost, items: TrendItem[]): TrendItem | undefined {
  const candidates = [post.sourceTitle, post.topic]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  return items.find((item) =>
    candidates.some(
      (candidate) =>
        item.topic.toLowerCase().includes(candidate) || candidate.includes(item.topic.toLowerCase()),
    ),
  );
}

function sanitizePosts(posts: GeneratedPost[], count: number, items: TrendItem[]): GeneratedPost[] {
  const fallbackItem = items[0];
  let cryptoCount = 0;

  return posts
    .filter((post) => typeof post?.text === 'string' && post.text.trim())
    .map((post) => {
      const matchedItem = getItemForPost(post, items) || fallbackItem;
      return {
        text: post.text.trim().slice(0, 280),
        topic: (post.topic || matchedItem?.topic || 'general').trim(),
        category: post.category || matchedItem?.category || 'general',
        sourceName: post.sourceName || matchedItem?.source,
        sourceTitle: post.sourceTitle || matchedItem?.topic,
        sourceUrl: post.sourceUrl || matchedItem?.url,
        angleHint: post.angleHint || matchedItem?.angleHint,
        imageUrl: post.imageUrl || matchedItem?.imageUrl,
      };
    })
    .filter((post) => {
      if (post.category !== 'crypto') {
        return true;
      }

      cryptoCount += 1;
      return cryptoCount <= 1;
    })
    .slice(0, count);
}

export async function generatePosts(items: TrendItem[], count = 10): Promise<GeneratedPost[]> {
  const { mood, debateFormat } = getMood();
  const topPerformers = getTopPerformersContext();
  const recentPosts = getRecentPostsContext();
  const prioritizedItems = [...items].sort((a, b) => {
    const aPriority = a.category === 'ai' ? 2 : a.category === 'crypto' ? 0 : 1;
    const bPriority = b.category === 'ai' ? 2 : b.category === 'crypto' ? 0 : 1;
    return bPriority - aPriority || b.score - a.score;
  });
  const formattedItems = prioritizedItems
    .map((item, index) => {
      const voiceMode = getVoiceMode(item.category, item.topic, item.summary);
      return `${index + 1}. titulo: ${item.topic}\nfonte: ${item.source}\nresumo: ${item.summary}\ncategoria: ${item.category}\nsinal: ${item.signal}\nangulo sugerido: ${item.angleHint}\nmodo de voz: ${voiceMode.mode}\norientacao de voz: ${voiceMode.guidance}\nurl: ${item.url || 'n/a'}`;
    })
    .join('\n\n');

  const systemPrompt = `Voce escreve posts no X imitando a voz de uma pessoa real.

IDENTIDADE DO DONO:
${PERSONA.identity}

ESTILO DE ESCRITA:
${PERSONA.writingStyle}

EXEMPLOS REAIS DE VOZ:
${PERSONA.voiceExamples.map((example) => `"${example}"`).join('\n')}

SEGUNDO ELEMENTO DE VOZ:
${EXPLAINER_PERSONA.writingStyle}

EXEMPLOS DO MODO EXPLICADOR-BUILDER:
${EXPLAINER_PERSONA.voiceExamples.map((example) => `"${example}"`).join('\n')}

REGRAS ABSOLUTAS:
- Escreva SEMPRE em portugues brasileiro informal
- NUNCA soe como bot, robo, jornalista ou post corporativo
- NUNCA use estruturas como "Sabia que", "Descubra", "E importante"
- NUNCA enumere pontos
- Cada post deve parecer que foi digitado na hora, com opiniao real
- Responda APENAS com JSON valido, sem markdown, sem explicacao

Formato:
[{"text":"conteudo do post","topic":"nome do topico","category":"ai|crypto|web3|tech|general","sourceName":"fonte","sourceTitle":"titulo-fonte","sourceUrl":"url","angleHint":"angulo usado","imageUrl":"url da imagem se existir"}]`;

  const userPrompt = `Humor agora: ${mood}
Formato de debate para usar em pelo menos 3 posts: ${debateFormat}

Itens de noticia e tendencia de hoje:
${formattedItems}

Gere exatamente ${count} posts unicos sobre esses itens.
- Priorize AI acima dos outros temas
- Crypto pode aparecer no maximo 1 vez no lote do dia
- Se tiver que escolher, prefira AI e tech antes de crypto
- Pelo menos 3 deles devem ser no formato de debate/engajamento acima
- Cada post precisa nascer de um item especifico de noticia ou tendencia
- Nao resuma a manchete. transforme o fato em leitura propria
- Respeite o modo de voz sugerido em cada item
- Quando o item for AI de produto, launch, leak ou incidente, puxe mais para explicador-builder
- Se a noticia pedir, puxe segunda ordem, comportamento de mercado ou tese
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
    const posts = sanitizePosts(parsed, count, items);

    console.log(`Generated ${posts.length} posts via Groq`);
    return posts;
  } catch (error) {
    console.error('Post generation error:', error);
    return [];
  }
}
