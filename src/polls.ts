import { db } from './db.js';
import { getXClient } from './x-client.js';
import { isPostingPaused } from './runtime-flags.js';

const POLL_TEMPLATES = [
  {
    question: 'qual vai dominar os proximos 12 meses?',
    options: ['Bitcoin acima de 150k', 'Ethereum com novo ATH', 'Altseason em peso', 'Mercado lateral'],
    topic: 'crypto market prediction',
  },
  {
    question: 'qual ferramenta de AI voce mais usa hoje?',
    options: ['Claude', 'ChatGPT', 'Gemini', 'Outra'],
    topic: 'ai tools usage',
  },
  {
    question: 'o que vai mudar mais com AI em 2026?',
    options: ['Desenvolvimento de software', 'Criacao de conteudo', 'Atendimento ao cliente', 'Educacao'],
    topic: 'ai impact prediction',
  },
  {
    question: 'onde voce guarda sua crypto principal?',
    options: ['Hardware wallet', 'Exchange confiavel', 'Self-custody software', 'Ainda nao sei'],
    topic: 'crypto custody',
  },
  {
    question: 'qual narrativa vai dominar o proximo ciclo?',
    options: ['AI + Crypto', 'RWA tokenization', 'DePIN', 'Layer 2 + Gaming'],
    topic: 'crypto narrative',
  },
  {
    question: 'como voce prefere aprender sobre crypto e AI?',
    options: ['Twitter/X', 'YouTube', 'Podcasts', 'Lendo artigos'],
    topic: 'learning preferences',
  },
] as const;

function usedPollRecently(topic: string): boolean {
  const row = db
    .prepare(`
      SELECT id
      FROM posts
      WHERE topic = ?
        AND posted_at >= datetime('now', '-30 days')
    `)
    .get(topic);

  return !!row;
}

export async function publishWeeklyPoll() {
  if (isPostingPaused()) {
    console.log('Posting paused, skipping weekly poll');
    return;
  }

  const client = getXClient();
  if (!client) {
    return;
  }

  const available = POLL_TEMPLATES.filter((poll) => !usedPollRecently(poll.topic));
  if (!available.length) {
    console.log('All poll templates used recently');
    return;
  }

  const template = available[Math.floor(Math.random() * available.length)];

  try {
    const tweet = await client.v2.tweet({
      text: template.question,
      poll: {
        options: [...template.options],
        duration_minutes: 1440,
      },
    });

    db.prepare(`
      INSERT INTO posts (tweet_id, content, topic, posted_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(tweet.data.id, template.question, template.topic);

    console.log(`Poll published: "${template.question}"`);
  } catch (error) {
    console.error('Poll publish error:', error);
  }
}
