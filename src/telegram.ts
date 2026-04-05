import { db } from './db.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const apiBase = token ? `https://api.telegram.org/bot${token}` : null;

function isTelegramConfigured(): boolean {
  return Boolean(token && chatId && apiBase);
}

async function send(text: string) {
  if (!isTelegramConfigured() || !apiBase) {
    return;
  }

  await fetch(`${apiBase}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  });
}

export async function sendTelegramAlert(text: string) {
  await send(text);
}

function bar(value: number, max: number, len = 10): string {
  const filled = max > 0 ? Math.round((value / max) * len) : 0;
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, len - filled));
}

function pct(current: number, previous: number): string {
  if (previous === 0) {
    return current > 0 ? '+100%' : '0%';
  }

  const diff = ((current - previous) / previous) * 100;
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
}

function sectionEngagement(): string {
  const rows = db
    .prepare(`
      SELECT content, likes, retweets, replies, impressions, score, topic
      FROM posts
      WHERE posted_at >= datetime('now', '-24 hours')
        AND tweet_id IS NOT NULL
      ORDER BY score DESC
    `)
    .all() as {
      content: string;
      likes: number;
      retweets: number;
      replies: number;
      impressions: number;
      score: number;
      topic: string;
    }[];

  if (!rows.length) {
    return '📭 Nenhum post publicado nas ultimas 24h.\n';
  }

  const totals = rows.reduce(
    (acc, row) => ({
      likes: acc.likes + row.likes,
      retweets: acc.retweets + row.retweets,
      replies: acc.replies + row.replies,
      impressions: acc.impressions + row.impressions,
    }),
    { likes: 0, retweets: 0, replies: 0, impressions: 0 },
  );

  const maxScore = rows[0].score || 1;

  let output = '<b>📊 ENGAJAMENTO — ULTIMAS 24H</b>\n';
  output += `❤️ Likes: <b>${totals.likes}</b>  🔁 RTs: <b>${totals.retweets}</b>  💬 Replies: <b>${totals.replies}</b>  👁 Views: <b>${totals.impressions}</b>\n\n`;

  rows.forEach((row, index) => {
    const preview = row.content.slice(0, 55) + (row.content.length > 55 ? '…' : '');
    output += `${index + 1}. <i>${preview}</i>\n`;
    output += `   ${bar(row.score, maxScore)} ❤️${row.likes} 🔁${row.retweets} 💬${row.replies}\n`;
  });

  return output;
}

function sectionGrowth(): string {
  const days = db
    .prepare(`
      SELECT
        date(posted_at) AS day,
        SUM(likes) AS likes,
        SUM(retweets) AS retweets,
        SUM(replies) AS replies,
        SUM(impressions) AS impressions
      FROM posts
      WHERE posted_at >= datetime('now', '-7 days')
        AND tweet_id IS NOT NULL
      GROUP BY day
      ORDER BY day ASC
    `)
    .all() as {
      day: string;
      likes: number;
      retweets: number;
      replies: number;
      impressions: number;
    }[];

  if (days.length < 2) {
    return '📈 Dados insuficientes para evolucao semanal.\n';
  }

  const maxImpressions = Math.max(...days.map((day) => day.impressions), 1);
  let output = '<b>📈 EVOLUCAO SEMANAL</b>\n';

  days.forEach((day) => {
    const engagement = day.likes + day.retweets + day.replies;
    output += `${day.day.slice(5)}  ${bar(day.impressions, maxImpressions, 8)}  👁${day.impressions}  ⚡${engagement}\n`;
  });

  const last = days[days.length - 1];
  const previous = days[days.length - 2];
  const currentEngagement = last.likes + last.retweets + last.replies;
  const previousEngagement = previous.likes + previous.retweets + previous.replies;

  output += `\nOntem vs anteontem → Eng: <b>${pct(currentEngagement, previousEngagement)}</b>  Views: <b>${pct(last.impressions, previous.impressions)}</b>\n`;
  return output;
}

function sectionTopTopics(): string {
  const topics = db
    .prepare(`
      SELECT
        topic,
        COUNT(*) AS posts,
        SUM(likes) AS likes,
        SUM(retweets) AS retweets,
        SUM(impressions) AS impressions,
        AVG(score) AS avg_score
      FROM posts
      WHERE posted_at >= datetime('now', '-7 days')
        AND tweet_id IS NOT NULL
      GROUP BY topic
      ORDER BY avg_score DESC
      LIMIT 5
    `)
    .all() as {
      topic: string;
      posts: number;
      likes: number;
      retweets: number;
      impressions: number;
      avg_score: number;
    }[];

  if (!topics.length) {
    return '🏷 Sem dados de topicos ainda.\n';
  }

  const maxScore = topics[0].avg_score || 1;
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  let output = '<b>🏆 MELHORES TOPICOS DA SEMANA</b>\n';

  topics.forEach((topic, index) => {
    output += `${medals[index]} <b>${topic.topic}</b>  ${bar(topic.avg_score, maxScore, 8)}\n`;
    output += `   ${topic.posts} posts  ❤️${topic.likes}  🔁${topic.retweets}  👁${topic.impressions}\n`;
  });

  return output;
}

function sectionTopPerformers(): string {
  const rows = db
    .prepare(`
      SELECT content, score, topic, posted_at
      FROM posts
      WHERE tweet_id IS NOT NULL
      ORDER BY score DESC
      LIMIT 3
    `)
    .all() as { content: string; score: number; topic: string; posted_at: string }[];

  if (!rows.length) {
    return '⭐ Nenhum top performer ainda.\n';
  }

  const medals = ['🥇', '🥈', '🥉'];
  let output = '<b>⭐ TOP POSTS ALL-TIME</b>\n\n';

  rows.forEach((row, index) => {
    const preview = row.content.slice(0, 80) + (row.content.length > 80 ? '…' : '');
    output += `${medals[index]} <i>${preview}</i>\n`;
    output += `   🏷 ${row.topic}  📅 ${row.posted_at.slice(0, 10)}  🔥 ${row.score.toFixed(1)}\n\n`;
  });

  return output;
}

export async function sendDailyReport() {
  if (!isTelegramConfigured()) {
    return;
  }

  const now = new Date().toLocaleString('pt-BR', {
    timeZone: process.env.TZ || 'America/Fortaleza',
  });

  const separator = '─'.repeat(28);
  const message =
    `🤖 <b>X BOT REPORT</b>\n📅 ${now}\n${separator}\n\n` +
    sectionEngagement() +
    `\n${separator}\n\n` +
    sectionGrowth() +
    `\n${separator}\n\n` +
    sectionTopTopics() +
    `\n${separator}\n\n` +
    sectionTopPerformers();

  await send(message);
  console.log('Daily report sent to Telegram');
}

export async function startTelegramPolling() {
  if (!isTelegramConfigured() || !apiBase || !chatId) {
    console.log('Telegram not configured, skipping polling');
    return;
  }

  let offset = 0;

  const commands: Record<string, () => Promise<void>> = {
    '/stats': async () => sendDailyReport(),
    '/report': async () => sendDailyReport(),
    '/today': async () => send(sectionEngagement()),
    '/topics': async () => send(sectionTopTopics()),
    '/top': async () => send(sectionTopPerformers()),
    '/growth': async () => send(sectionGrowth()),
    '/help': async () =>
      send(
        '<b>🤖 Comandos disponiveis:</b>\n\n' +
          '/stats — Relatorio completo\n' +
          '/today — Engajamento de hoje\n' +
          '/topics — Melhores topicos\n' +
          '/top — Top posts all-time\n' +
          '/growth — Evolucao semanal',
      ),
  };

  async function poll() {
    try {
      const response = await fetch(`${apiBase}/getUpdates?offset=${offset}&timeout=30`);
      const data = (await response.json()) as {
        result: {
          update_id: number;
          message?: { text?: string; chat?: { id?: number | string } };
        }[];
      };

      for (const update of data.result) {
        offset = update.update_id + 1;

        const text = update.message?.text?.trim().toLowerCase();
        const incomingChatId = String(update.message?.chat?.id ?? '');

        if (!text || incomingChatId !== String(chatId)) {
          continue;
        }

        const command = commands[text];
        if (command) {
          await command();
        }
      }
    } catch (error) {
      console.error('Telegram polling error:', error);
    } finally {
      setTimeout(poll, 2000);
    }
  }

  poll();
  console.log('Telegram polling active');
}
