import 'dotenv/config';
import cron from 'node-cron';
import { initDb } from './db.js';
import { collectEngagement } from './engagement.js';
import { generatePosts } from './generator.js';
import { publishPost } from './publisher.js';
import { fetchTrends } from './trends.js';
import { sendDailyReport, startTelegramPolling } from './telegram.js';
import { missingXEnvVars } from './x-client.js';

function requiredEnvVars(): string[] {
  const required = [...missingXEnvVars(), 'GROQ_API_KEY'];

  return required.filter((key) => !process.env[key]);
}

async function dailyPipeline() {
  console.log('Starting daily pipeline');

  const missing = requiredEnvVars();
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    return;
  }

  const topics = await fetchTrends();
  const posts = await generatePosts(topics, Number(process.env.POSTS_PER_DAY) || 10);

  if (!posts.length) {
    console.error('No posts generated, aborting pipeline');
    return;
  }

  const startHour = Number(process.env.POST_START_HOUR) || 8;
  const endHour = Number(process.env.POST_END_HOUR) || 22;
  const gapMinutes = ((endHour - startHour) * 60) / posts.length;

  posts.forEach((post, index) => {
    const delayMs = index * gapMinutes * 60 * 1000;
    setTimeout(() => {
      void publishPost(post);
    }, delayMs);
  });

  console.log(`Scheduled ${posts.length} posts every ~${Math.round(gapMinutes)} minutes`);
}

initDb();

cron.schedule('0 7 * * *', () => {
  void dailyPipeline();
});

cron.schedule('0 */6 * * *', () => {
  void collectEngagement();
});

cron.schedule('0 23 * * *', () => {
  void sendDailyReport();
});

void startTelegramPolling();

console.log('X Auto-Bot running');

if ((process.env.RUN_ON_START ?? 'true').toLowerCase() === 'true') {
  void dailyPipeline();
}
