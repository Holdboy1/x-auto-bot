import { db } from './db.js';
import { PERSONA } from './persona.js';
import { getXClient } from './x-client.js';

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

type IncomingReply = {
  id: string;
  text: string;
  author_id: string;
  author_username: string;
  author_followers: number;
  in_reply_to_tweet_id: string;
  created_at: string;
};

type PostMetrics = {
  impressions: number;
  likes: number;
  replies: number;
  retweets: number;
};

type CommentType =
  | 'question'
  | 'agreement'
  | 'disagreement'
  | 'curious'
  | 'sarcasm'
  | 'shallow'
  | 'spam';

function initRepliesTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS replies_sent (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      reply_tweet_id  TEXT,
      original_tweet_id TEXT,
      replied_to_user TEXT,
      content         TEXT,
      sent_at         TEXT DEFAULT (datetime('now'))
    );
  `);
}

function countRepliesToday(): number {
  const row = db
    .prepare(`
      SELECT COUNT(*) as total
      FROM replies_sent
      WHERE sent_at >= datetime('now', 'start of day')
    `)
    .get() as { total: number };

  return row.total;
}

function alreadyRepliedToUser(tweetId: string, username: string): boolean {
  const row = db
    .prepare(`
      SELECT id
      FROM replies_sent
      WHERE original_tweet_id = ?
        AND replied_to_user = ?
    `)
    .get(tweetId, username);

  return !!row;
}

function lastReplyTime(): Date | null {
  const row = db
    .prepare(`
      SELECT sent_at
      FROM replies_sent
      ORDER BY sent_at DESC
      LIMIT 1
    `)
    .get() as { sent_at: string } | undefined;

  return row ? new Date(`${row.sent_at}Z`) : null;
}

function saveReply(replyId: string, originalId: string, username: string, content: string) {
  db.prepare(`
    INSERT INTO replies_sent (reply_tweet_id, original_tweet_id, replied_to_user, content)
    VALUES (?, ?, ?, ?)
  `).run(replyId, originalId, username, content);
}

function classifyComment(text: string, followerCount: number): CommentType {
  const normalizedText = text.toLowerCase().trim();

  if (followerCount < 50) return 'spam';
  if (/\b(follow|giveaway|airdrop|dm me|click here|t\.me\/)\b/.test(normalizedText)) return 'spam';

  if (text.length < 20) return 'shallow';
  if (/^[😂🔥💯🚀❤️👍]+$/u.test(text.trim())) return 'shallow';

  if (/\?/.test(normalizedText)) return 'question';
  if (/(concordo|exato|verdade|isso mesmo|faz sentido|100%|perfeito|certo)/.test(normalizedText)) return 'agreement';
  if (/(discordo|nao acho|não acho|errado|mas|porem|porém|na verdade|acho que nao|acho que não|diverge)/.test(normalizedText)) return 'disagreement';
  if (/(como assim|pode explicar|conta mais|qual fonte|link|onde vi|mais sobre)/.test(normalizedText)) return 'curious';
  if (/(kkkk|haha|ironico|irônico|serio mesmo|sério mesmo|ta bom|tá bom|claro ne|claro né|com certeza ne|com certeza né)/.test(normalizedText)) return 'sarcasm';

  return 'curious';
}

async function generateReply(
  originalPost: string,
  incomingComment: string,
  commentType: CommentType,
  authorUsername: string,
): Promise<string | null> {
  const toneGuide: Record<CommentType, string> = {
    question: 'responde a pergunta de forma direta e humana, sem enrolar, como se tivesse numa conversa',
    agreement: 'agradece o ponto de forma natural, adiciona mais uma camada de raciocinio ou dado novo',
    disagreement: 'reconhece o ponto de vista diferente sem atacar, argumenta com calma e confianca',
    curious: 'expande o assunto com uma informacao extra relevante, como alguem que conhece o tema de verdade',
    sarcasm: 'responde com leveza e humor seco, sem levar muito a serio, mantendo o tom leve',
    shallow: '',
    spam: '',
  };

  const systemPrompt = `Voce escreve replies no X imitando exatamente a voz desta pessoa.

IDENTIDADE:
${PERSONA.identity}

ESTILO:
${PERSONA.writingStyle}

EXEMPLOS DE VOZ:
${PERSONA.voiceExamples.map((example) => `"${example}"`).join('\n')}

REGRAS ABSOLUTAS:
- Maximo 200 caracteres
- Portugues brasileiro informal
- NUNCA comece com "Boa pergunta", "Excelente ponto", "Com certeza"
- NUNCA soe como atendente ou robo
- NUNCA use lista
- Pode discordar com respeito
- Pode usar humor leve se o contexto pedir
- Responda APENAS o texto do reply, nada mais`;

  const userPrompt = `Post original que voce publicou:
"${originalPost}"

Comentario de @${authorUsername}:
"${incomingComment}"

Tipo do comentario: ${commentType}
Como responder: ${toneGuide[commentType]}

Gere UM reply natural, curto e humano.`;

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
      console.error('Groq reply error:', data.error?.message || response.statusText);
      return null;
    }

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text || text.length < 5) {
      return null;
    }

    return text.replace(/^["']|["']$/g, '').trim();
  } catch (error) {
    console.error('Reply generation error:', error);
    return null;
  }
}

function shouldReply(
  metrics: PostMetrics,
  comment: IncomingReply,
  commentType: CommentType,
): { reply: boolean; reason: string } {
  const maxReplies = Number(process.env.MAX_REPLIES_PER_DAY) || 4;
  const minImpressions = Number(process.env.MIN_IMPRESSIONS_TO_REPLY) || 300;
  const minLikes = Number(process.env.MIN_LIKES_TO_REPLY) || 3;
  const windowHours = Number(process.env.REPLY_WINDOW_HOURS) || 6;
  const minGapMinutes = 90;

  if (countRepliesToday() >= maxReplies) {
    return { reply: false, reason: 'daily limit reached' };
  }

  const last = lastReplyTime();
  if (last) {
    const elapsedMinutes = (Date.now() - last.getTime()) / 60000;
    if (elapsedMinutes < minGapMinutes) {
      return { reply: false, reason: `too soon (${Math.round(elapsedMinutes)}min ago)` };
    }
  }

  if (commentType === 'spam' || commentType === 'shallow') {
    return { reply: false, reason: `comment type: ${commentType}` };
  }

  if (alreadyRepliedToUser(comment.in_reply_to_tweet_id, comment.author_username)) {
    return { reply: false, reason: 'already replied to this user on this post' };
  }

  const commentAgeHours = (Date.now() - new Date(comment.created_at).getTime()) / 3600000;
  if (commentAgeHours > windowHours) {
    return { reply: false, reason: `comment too old (${commentAgeHours.toFixed(1)}h)` };
  }

  const hasImpression = metrics.impressions >= minImpressions;
  const hasLikes = metrics.likes >= minLikes;
  const hasReplies = metrics.replies >= 2;

  if (!hasImpression && !hasLikes && !hasReplies) {
    return { reply: false, reason: 'post has low traction' };
  }

  return { reply: true, reason: 'all filters passed' };
}

export async function processReplies() {
  initRepliesTable();

  const client = getXClient();
  if (!client) {
    return;
  }

  if (!process.env.GROQ_API_KEY) {
    console.log('Skipping replies: GROQ_API_KEY is missing');
    return;
  }

  const myPosts = db
    .prepare(`
      SELECT tweet_id, content, likes, retweets, replies, impressions
      FROM posts
      WHERE tweet_id IS NOT NULL
        AND posted_at >= datetime('now', '-24 hours')
      ORDER BY score DESC
      LIMIT 10
    `)
    .all() as Array<{
      tweet_id: string;
      content: string;
      likes: number;
      retweets: number;
      replies: number;
      impressions: number;
    }>;

  if (!myPosts.length) {
    console.log('No recent posts to check replies for');
    return;
  }

  console.log(`Checking replies for ${myPosts.length} posts...`);

  for (const post of myPosts) {
    if (countRepliesToday() >= (Number(process.env.MAX_REPLIES_PER_DAY) || 4)) {
      console.log('Daily reply limit reached, stopping');
      break;
    }

    try {
      const search = (await client.v2.search(`conversation_id:${post.tweet_id} -from:me`, {
        max_results: 10,
        'tweet.fields': ['created_at', 'author_id', 'text'],
        expansions: ['author_id'],
        'user.fields': ['username', 'public_metrics'],
      })) as unknown as {
        _realData?: {
          data?: Array<{ id: string; text: string; author_id: string; created_at: string }>;
          includes?: {
            users?: Array<{
              id: string;
              username: string;
              public_metrics?: { followers_count: number };
            }>;
          };
        };
      };

      const users = new Map(
        (search._realData?.includes?.users ?? []).map((user) => [user.id, user]),
      );

      const comments: IncomingReply[] = (search._realData?.data ?? []).map((tweet) => ({
        id: tweet.id,
        text: tweet.text,
        author_id: tweet.author_id,
        author_username: users.get(tweet.author_id)?.username ?? 'unknown',
        author_followers: users.get(tweet.author_id)?.public_metrics?.followers_count ?? 0,
        in_reply_to_tweet_id: post.tweet_id,
        created_at: tweet.created_at,
      }));

      const metrics: PostMetrics = {
        impressions: post.impressions,
        likes: post.likes,
        replies: post.replies,
        retweets: post.retweets,
      };

      for (const comment of comments) {
        const type = classifyComment(comment.text, comment.author_followers);
        const decision = shouldReply(metrics, comment, type);

        if (!decision.reply) {
          console.log(`Skip reply to @${comment.author_username}: ${decision.reason}`);
          continue;
        }

        const delayMs = (120 + Math.random() * 360) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        const replyText = await generateReply(post.content, comment.text, type, comment.author_username);
        if (!replyText) {
          continue;
        }

        const tweet = await client.v2.reply(replyText, comment.id);
        saveReply(tweet.data.id, post.tweet_id, comment.author_username, replyText);

        console.log(`Replied to @${comment.author_username} [${type}]: ${replyText.slice(0, 60)}...`);
      }
    } catch (error) {
      console.error(`Error processing replies for ${post.tweet_id}:`, error);
    }
  }
}
