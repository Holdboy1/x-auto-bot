import 'dotenv/config';
import cron from 'node-cron';
import { initDb } from './db.js';
import { collectEngagement } from './engagement.js';
import { generatePosts } from './generator.js';
import { fetchTrends } from './trends.js';
import { dispatchNextPost, enqueuePosts, hasPendingPostsForDay, pruneDuplicatePendingPosts } from './scheduler.js';
import { sendDailyReport, startTelegramPolling } from './telegram.js';
import { missingXEnvVars } from './x-client.js';

function isPostingPaused(): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env.POSTING_PAUSED || '').toLowerCase());
}

function requiredEnvVars(): string[] {
  const required = [...missingXEnvVars(), 'GROQ_API_KEY'];

  return required.filter((key) => !process.env[key]);
}

async function dailyPipeline() {
  console.log('Starting daily pipeline');

  if (isPostingPaused()) {
    console.log('Posting paused by POSTING_PAUSED flag, skipping pipeline');
    return;
  }

  const missing = requiredEnvVars();
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    return;
  }

  const day = new Date().toISOString().slice(0, 10);
  const pruned = pruneDuplicatePendingPosts(day);
  if (pruned) {
    console.log(`Pruned ${pruned} duplicate queued posts for ${day}`);
  }

  if (hasPendingPostsForDay(day)) {
    console.log(`Pending posts already exist for ${day}, skipping regeneration`);
    return;
  }

  const postsPerDay = Number(process.env.POSTS_PER_DAY) || 10;
  const items = await fetchTrends(Math.max(postsPerDay + 4, 12));
  const posts = await generatePosts(items, postsPerDay);

  if (!posts.length) {
    console.error('No posts generated, aborting pipeline');
    return;
  }

  const startHour = Number(process.env.POST_START_HOUR) || 8;
  const endHour = Number(process.env.POST_END_HOUR) || 22;
  enqueuePosts(posts, startHour, endHour);
  console.log(`Queued ${posts.length} posts between ${startHour}:00 and ${endHour}:00`);
}

initDb();

cron.schedule('0 7 * * *', () => {
  void dailyPipeline();
});

cron.schedule('0 */6 * * *', () => {
  void collectEngagement();
});

cron.schedule('* * * * *', () => {
  if (isPostingPaused()) {
    return;
  }

  const day = new Date().toISOString().slice(0, 10);
  const pruned = pruneDuplicatePendingPosts(day);
  if (pruned) {
    console.log(`Pruned ${pruned} duplicate queued posts for ${day}`);
  }
  void dispatchNextPost();
});

cron.schedule('0 23 * * *', () => {
  void sendDailyReport();
});

void startTelegramPolling();

console.log('X Auto-Bot running');

if ((process.env.RUN_ON_START ?? 'true').toLowerCase() === 'true') {
  void dailyPipeline();
}
