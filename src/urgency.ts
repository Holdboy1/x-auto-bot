import { db } from './db.js';
import { generatePosts } from './generator.js';
import { publishPost } from './publisher.js';
import { isPostingPaused } from './runtime-flags.js';
import { sendTelegramAlert } from './telegram.js';
import { generateThread } from './threads.js';

export type UrgencyLevel = 'urgent' | 'relevant' | 'evergreen';

export type ScoredItem = {
  topic: string;
  summary: string;
  source: string;
  category: string;
  urgency: UrgencyLevel;
  urgencyScore: number;
  reason: string;
  url?: string;
};

const URGENT_SIGNALS = [
  /bitcoin.*(crash|dump|drop|fell|plunge|surge|spike|rally|ath|all.time)/i,
  /btc.*(down|up|pump|dump|crash|broke|break|support|resistance)/i,
  /crypto.*(hack|exploit|rug|scam|collapse|ban|regulation|etf|approval)/i,
  /market.*(crash|correction|panic|fear|greed|liquidat)/i,
  /\b(gpt|claude|gemini|grok|llama|mistral|deepseek|openai|anthropic|google|meta).*(launch|release|leak|hack|breach|ban|shutdown|update|new|announces)/i,
  /(ai|llm|model).*(leak|leaked|breach|hacked|shutdown|banned|new|launch)/i,
  /(raised|funding|acquisition|ipo|bankrupt|shutdown|hack|breach|outage)/i,
];

const RELEVANT_SIGNALS = [
  /bitcoin|ethereum|solana|defi|web3|blockchain/i,
  /openai|anthropic|google ai|meta ai|mistral|groq/i,
  /ai agent|llm|model|token|crypto|nft/i,
  /startup|funding|product launch|new feature/i,
];

export function scoreUrgency(topic: string, summary: string): {
  level: UrgencyLevel;
  score: number;
  reason: string;
} {
  const text = `${topic} ${summary}`;

  for (const pattern of URGENT_SIGNALS) {
    if (pattern.test(text)) {
      return {
        level: 'urgent',
        score: 85 + Math.floor(Math.random() * 15),
        reason: `matched urgent signal: ${pattern.source.slice(0, 40)}`,
      };
    }
  }

  for (const pattern of RELEVANT_SIGNALS) {
    if (pattern.test(text)) {
      return {
        level: 'relevant',
        score: 40 + Math.floor(Math.random() * 30),
        reason: 'niche topic without urgency signal',
      };
    }
  }

  return {
    level: 'evergreen',
    score: 10 + Math.floor(Math.random() * 20),
    reason: 'no specific signal detected',
  };
}

async function alreadyPostedAbout(topic: string): Promise<boolean> {
  const row = db
    .prepare(`
      SELECT id
      FROM posts
      WHERE content LIKE ?
        AND posted_at >= datetime('now', '-6 hours')
    `)
    .get(`%${topic.slice(0, 20)}%`);

  return !!row;
}

export async function checkUrgentEvents() {
  if (isPostingPaused()) {
    console.log('Posting paused, skipping urgent events');
    return;
  }

  const threshold = Number(process.env.URGENT_SCORE_THRESHOLD) || 85;
  const { fetchTrends } = await import('./trends.js');
  const items = await fetchTrends(12);

  const urgent = items
    .map((item) => {
      const { level, score, reason } = scoreUrgency(item.topic, item.summary);
      return { ...item, urgency: level, urgencyScore: score, reason };
    })
    .filter((item) => item.urgency === 'urgent' && item.urgencyScore >= threshold)
    .sort((left, right) => right.urgencyScore - left.urgencyScore);

  if (!urgent.length) {
    console.log('No urgent events detected');
    return;
  }

  const top = urgent[0];
  console.log(`Urgent event: ${top.topic} (score: ${top.urgencyScore})`);

  if (await alreadyPostedAbout(top.topic)) {
    console.log('Already posted about this event, skipping');
    return;
  }

  await sendTelegramAlert(
    `🚨 <b>EVENTO URGENTE DETECTADO</b>\n\n` +
      `📌 <b>${top.topic}</b>\n` +
      `📝 ${top.summary}\n` +
      `🔥 Score: ${top.urgencyScore}/100\n\n` +
      `Gerando publicacao urgente...`,
  );

  if (top.urgencyScore >= 90) {
    await generateThread(top, 'urgent', Number(process.env.THREAD_SIZE) || 3);
    return;
  }

  const posts = await generatePosts([top], 1);
  if (posts.length) {
    await publishPost(posts[0]);
  }
}
