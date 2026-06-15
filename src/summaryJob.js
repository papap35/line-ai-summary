import { messagingApi } from '@line/bot-sdk';
import * as db from './database.js';
import { summarize } from './summarizer.js';

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

  const groupIds = targetGroup ? [targetGroup] : await db.getActiveGroups(dateStr);

  if (groupIds.length === 0) {
    console.log('No active groups today, skipping summary.');
    return { date: dateStr, groups: 0, summarized: 0 };
  }

  let summarized = 0;
  for (const groupId of groupIds) {
    try {
      if (await db.getSummary(groupId, dateStr)) {
        console.log(`Summary already exists for group ${groupId} on ${dateStr}`);
        continue;
      }

      const messages = await db.getTodayMessages(groupId, dateStr);
      console.log(`Summarizing ${messages.length} messages for group ${groupId}`);

      const summaryText = await summarize(groupId, messages, dateStr);
      await db.saveSummary(groupId, summaryText, dateStr);

      const header = `📊 ${dateStr} 每日重點摘要\n${'─'.repeat(20)}\n`;
      await sendLineMessage(groupId, header + summaryText);
      console.log(`Summary sent to group ${groupId}`);
      summarized += 1;
    } catch (err) {
      console.error(`Failed to process group ${groupId}`, err);
    }
  }

  await db.purgeOldMessages(retentionDays);
  return { date: dateStr, groups: groupIds.length, summarized };
}
