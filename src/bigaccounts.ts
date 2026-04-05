import { db } from './db.js';
import { PERSONA } from './persona.js';
import { isPostingPaused } from './runtime-flags.js';
import { getXClient } from './x-client.js';

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const TARGET_ACCOUNTS = [
  'VitalikButerin',
  'cz_binance',
  'saylor',
  'APompliano',
  'WatcherGuru',
  'sama',
  'ylecun',
  'karpathy',
  'gdb',
  'AnthropicAI',
];

function getTargetAccounts(): string[] {
  const fromEnv = (process.env.BIG_ACCOUNTS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return fromEnv.length ? fromEnv : [...TARGET_ACCOUNTS];
}

function initBigAccountsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS big_account_replies (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_id   TEXT UNIQUE,
      account    TEXT,
      reply_id   TEXT,
      reply_text TEXT,
      replied_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function alreadyReplied(tweetId: string): boolean {
  const row = db.prepare(`SELECT id FROM big_account_replies WHERE tweet_id = ?`).get(tweetId);
  return !!row;
}

function countBigAccountRepliesToday(): number {
  const row = db
    .prepare(`
      SELECT COUNT(*) as total
      FROM big_account_replies
      WHERE replied_at >= datetime('now', 'start of day')
    `)
    .get() as { total: number };

  return row.total;
}

async function generateBigAccountReply(accountName: string, tweetText: string): Promise<string | null> {
  const prompt = `Voce vai comentar no post de uma conta grande do crypto/AI no X.

SUA VOZ:
${PERSONA.writingStyle}

EXEMPLOS:
${PERSONA.voiceExamples.map((example) => `"${example}"`).join('\n')}

Conta: @${accountName}
Post deles: "${tweetText}"

Gere UM reply curto e inteligente que:
- Adiciona valor ou perspectiva nova
- Parece opiniao genuina, nao bajulacao
- Maximo 180 caracteres
- Portugues brasileiro informal
- NUNCA comece com "Otimo ponto" ou "Concordo totalmente"
- Responda APENAS o texto do reply`;

  try {
    const response = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 100,
        temperature: 0.85,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return data.choices?.[0]?.message?.content?.trim()?.replace(/^["']|["']$/g, '') ?? null;
  } catch (error) {
    console.error('Big account reply generation error:', error);
    return null;
  }
}

export async function engageBigAccounts() {
  initBigAccountsTable();

  if (isPostingPaused()) {
    console.log('Posting paused, skipping big account engagement');
    return;
  }

  const client = getXClient();
  if (!client) {
    return;
  }

  const dailyLimit = Number(process.env.MAX_BIG_ACCOUNT_REPLIES_PER_DAY) || 2;
  if (countBigAccountRepliesToday() >= dailyLimit) {
    console.log('Big account reply limit reached for today');
    return;
  }

  const accounts = getTargetAccounts();
  const account = accounts[Math.floor(Math.random() * accounts.length)];

  try {
    const user = await client.v2.userByUsername(account, { 'user.fields': ['id'] });
    if (!user.data?.id) {
      return;
    }

    const timeline = await client.v2.userTimeline(user.data.id, {
      max_results: 5,
      exclude: ['retweets', 'replies'],
      'tweet.fields': ['created_at', 'public_metrics', 'text'],
    });

    const tweets = timeline.data?.data ?? [];

    for (const tweet of tweets) {
      const ageHours = tweet.created_at ? (Date.now() - new Date(tweet.created_at).getTime()) / 3600000 : 999;
      if (ageHours > 3) continue;

      const metrics = tweet.public_metrics;
      if (!metrics || (metrics.like_count < 50 && metrics.retweet_count < 10)) continue;
      if (alreadyReplied(tweet.id)) continue;

      const delayMs = (5 + Math.random() * 15) * 60 * 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      const replyText = await generateBigAccountReply(account, tweet.text);
      if (!replyText) continue;

      const reply = await client.v2.reply(replyText, tweet.id);

      db.prepare(`
        INSERT OR IGNORE INTO big_account_replies (tweet_id, account, reply_id, reply_text)
        VALUES (?, ?, ?, ?)
      `).run(tweet.id, account, reply.data.id, replyText);

      console.log(`Replied to @${account}: "${replyText.slice(0, 60)}..."`);
      break;
    }
  } catch (error) {
    console.error(`Big account engagement error for @${account}:`, error);
  }
}
