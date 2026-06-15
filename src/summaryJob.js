import { messagingApi } from '@line/bot-sdk';
import * as db from './database.js';
import { summarize } from './summarizer.js';
import { logger } from './logger.js';

const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

async function sendLineMessage(to, text) {
  await lineClient.pushMessage({
    to,
    messages: [{ type: 'text', text }],
  });
}

// Pushes a failure report to ADMIN_USER_ID / ADMIN_GROUP_ID (if configured)
// so failures surface in LINE instead of only in Cloud Logging.
async function notifyAdmins(dateStr, text) {
  const targets = [process.env.ADMIN_USER_ID, process.env.ADMIN_GROUP_ID]
    .map((id) => (id || '').trim())
    .filter(Boolean);

  for (const to of targets) {
    try {
      await sendLineMessage(to, text);
    } catch (err) {
      logger.error('Failed to notify admin', { step: 'notify_admin', to, dateStr, err });
    }
  }
}

export async function runDailySummary() {
  const dateStr = db.todayString();
  const targetGroup = (process.env.TARGET_GROUP_ID || '').trim();
  const retentionDays = parseInt(process.env.MESSAGE_RETENTION_DAYS || '7', 10);

  const groupIds = targetGroup ? [targetGroup] : await db.getActiveGroups(dateStr);

  if (groupIds.length === 0) {
    logger.info('No active groups, skipping summary', { step: 'run_daily_summary', dateStr });
    return { date: dateStr, groups: 0, summarized: 0, failed: 0 };
  }

  let summarized = 0;
  const failures = [];
  for (const groupId of groupIds) {
    try {
      if (await db.getSummary(groupId, dateStr)) {
        logger.info('Summary already exists, skipping', { step: 'skip_existing', groupId, dateStr });
        continue;
      }

      const messages = await db.getTodayMessages(groupId, dateStr);
      logger.info('Summarizing messages', { step: 'summarize', groupId, dateStr, messageCount: messages.length });

      const summaryText = await summarize(groupId, messages, dateStr);
      await db.saveSummary(groupId, summaryText, dateStr);

      const header = `📊 ${dateStr} 每日重點摘要\n${'─'.repeat(20)}\n`;
      await sendLineMessage(groupId, header + summaryText);
      logger.info('Summary sent', { step: 'push_summary', groupId, dateStr });
      summarized += 1;
    } catch (err) {
      logger.error('Failed to process group', { step: 'process_group', groupId, dateStr, err });
      failures.push({ groupId, err });
    }
  }

  if (failures.length > 0) {
    const lines = failures.map(({ groupId, err }) => `・${groupId}: ${err.message}`);
    await notifyAdmins(dateStr, `⚠️ ${dateStr} 每日摘要有 ${failures.length} 個群組執行失敗：\n${lines.join('\n')}`);
  }

  await db.purgeOldMessages(retentionDays);
  return { date: dateStr, groups: groupIds.length, summarized, failed: failures.length };
}
