import 'dotenv/config';
import cron from 'node-cron';
import { initDb } from './db.js';
import { collectEngagement } from './engagement.js';
import { getEvergreenFallbackItems } from './evergreen.js';
import { isPostingPaused } from './runtime-flags.js';
import { fetchTrends } from './trends.js';
import { dispatchNextPost, enqueuePosts, hasPendingPostsForDay, pruneDuplicatePendingPosts } from './scheduler.js';
import { sendDailyReport, startTelegramPolling } from './telegram.js';
import { missingXEnvVars } from './x-client.js';

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
  let items = await fetchTrends(Math.max(postsPerDay + 4, 12));
  if (!items.length) {
    console.error('No trend items available, aborting pipeline');
    return;
  }

  if (items.length < 5) {
    console.log(`Only ${items.length} items available, adding evergreen fallback items`);
    const evergreenItems = await getEvergreenFallbackItems(Math.min(3, postsPerDay - items.length));
    items = [...items, ...evergreenItems];
  }

  const startHour = Number(process.env.POST_START_HOUR) || 8;
  const endHour = Number(process.env.POST_END_HOUR) || 22;
  enqueuePosts(items.slice(0, postsPerDay), startHour, endHour);
  console.log(`Queued up to ${Math.min(items.length, postsPerDay)} official post slots between ${startHour}:00 and ${endHour}:00`);
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
