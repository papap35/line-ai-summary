import 'dotenv/config';
import express from 'express';
import { messagingApi, middleware as lineMiddleware, SignatureValidationFailed } from '@line/bot-sdk';
import * as db from './database.js';
import { runDailySummary } from './summaryJob.js';

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/webhook', lineMiddleware(lineConfig), async (req, res) => {
  try {
    await Promise.all((req.body.events || []).map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error('Error handling webhook event', err);
    res.status(500).end();
  }
});

// Triggered by Cloud Scheduler. Protected by a shared-secret header since
// Cloud Run is deployed with --allow-unauthenticated for the LINE webhook.
app.post('/api/run-summary', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.header('X-Cron-Secret') !== secret) {
    res.status(401).end();
    return;
  }

  try {
    const result = await runDailySummary();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    console.error('Daily summary failed', err);
    res.status(500).json({ status: 'error' });
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;
  if (event.source.type !== 'group') return;

  const { groupId, userId } = event.source;
  const text = event.message.text;

  let displayName = null;
  try {
    const profile = await lineClient.getGroupMemberProfile(groupId, userId);
    displayName = profile.displayName;
  } catch {
    // profile not available (e.g. user left the group) — store without a name
  }

  await db.saveMessage({ groupId, userId, displayName, message: text });
  console.log(`Saved message from ${userId} in group ${groupId}`);
}

app.use((err, req, res, next) => {
  if (err instanceof SignatureValidationFailed) {
    res.status(400).send('Invalid signature');
    return;
  }
  console.error('Unhandled error', err);
  res.status(500).end();
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
