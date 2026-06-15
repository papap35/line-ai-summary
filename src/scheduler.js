import cron from 'node-cron';
import { messagingApi } from '@line/bot-sdk';
import * as db from './database.js';
import { summarize } from './summarizer.js';

const TIMEZONE = process.env.TIMEZONE || 'Asia/Taipei';

const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

async function sendLineMessage(groupId, text) {
  await lineClient.pushMessage({
    to: groupId,
    messages: [{ type: 'text', text }],
  });
}

export async function runDailySummary() {
  const dateStr = db.todayString();
  const targetGroup = (process.env.TARGET_GROUP_ID || '').trim();
  const retentionDays = parseInt(process.env.MESSAGE_RETENTION_DAYS || '7', 10);

  const groupIds = targetGroup ? [targetGroup] : db.getActiveGroups(dateStr);

  if (groupIds.length === 0) {
    console.log('No active groups today, skipping summary.');
    return;
  }

  for (const groupId of groupIds) {
    try {
      if (db.getSummary(groupId, dateStr)) {
        console.log(`Summary already exists for group ${groupId} on ${dateStr}`);
        continue;
      }

      const messages = db.getTodayMessages(groupId, dateStr);
      console.log(`Summarizing ${messages.length} messages for group ${groupId}`);

      const summaryText = await summarize(groupId, messages, dateStr);
      db.saveSummary(groupId, summaryText, dateStr);

      const header = `📊 ${dateStr} 每日重點摘要\n${'─'.repeat(20)}\n`;
      await sendLineMessage(groupId, header + summaryText);
      console.log(`Summary sent to group ${groupId}`);
    } catch (err) {
      console.error(`Failed to process group ${groupId}`, err);
    }
  }

  db.purgeOldMessages(retentionDays);
}

export function startScheduler() {
  const hour = parseInt(process.env.SUMMARY_HOUR || '20', 10);
  const minute = parseInt(process.env.SUMMARY_MINUTE || '0', 10);

  const cronExpr = `${minute} ${hour} * * *`;
  cron.schedule(cronExpr, runDailySummary, { timezone: TIMEZONE });

  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  console.log(`Scheduler started — daily summary at ${hh}:${mm} (${TIMEZONE})`);
}
