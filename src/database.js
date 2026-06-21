import { Firestore, Timestamp } from '@google-cloud/firestore';
import { DateTime } from 'luxon';

const TIMEZONE = process.env.TIMEZONE || 'Asia/Taipei';

const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
});

const messagesCol = firestore.collection('messages');
const summariesCol = firestore.collection('summaries');
const activityCol = firestore.collection('groupActivity');
const groupSettingsCol = firestore.collection('groupSettings');

export function todayString() {
  return DateTime.now().setZone(TIMEZONE).toISODate();
}

// [start, end) bounds for the given local date, as Firestore Timestamps.
export function dayRange(dateStr) {
  const start = DateTime.fromISO(dateStr, { zone: TIMEZONE }).startOf('day').toUTC();
  const end = start.plus({ days: 1 });
  return {
    start: Timestamp.fromDate(start.toJSDate()),
    end: Timestamp.fromDate(end.toJSDate()),
  };
}

export async function saveMessage({ groupId, userId, displayName, message, messageType = 'text' }) {
  const now = Timestamp.now();
  const dateStr = todayString();

  await messagesCol.add({
    groupId,
    userId: userId ?? null,
    displayName: displayName ?? null,
    message,
    messageType,
    timestamp: now,
  });

  // One doc per group per day lets getActiveGroups avoid a DISTINCT-style scan.
  await activityCol.doc(`${dateStr}__${groupId}`).set(
    { groupId, date: dateStr, updatedAt: now },
    { merge: true }
  );
}

export async function getTodayMessages(groupId, dateStr = todayString()) {
  const { start, end } = dayRange(dateStr);
  const snapshot = await messagesCol
    .where('groupId', '==', groupId)
    .where('timestamp', '>=', start)
    .where('timestamp', '<', end)
    .orderBy('timestamp', 'asc')
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      user_id: data.userId,
      display_name: data.displayName,
      message: data.message,
      timestamp: data.timestamp.toDate().toISOString(),
    };
  });
}

export async function getActiveGroups(dateStr = todayString()) {
  const snapshot = await activityCol.where('date', '==', dateStr).get();
  return snapshot.docs.map((doc) => doc.data().groupId);
}

export async function saveSummary(groupId, summary, dateStr = todayString()) {
  await summariesCol.doc(`${groupId}__${dateStr}`).set({
    groupId,
    date: dateStr,
    summary,
    createdAt: Timestamp.now(),
  });
}

export async function getSummary(groupId, dateStr = todayString()) {
  const doc = await summariesCol.doc(`${groupId}__${dateStr}`).get();
  return doc.exists ? doc.data().summary : null;
}

export async function getGroupSettings(groupId) {
  const doc = await groupSettingsCol.doc(groupId).get();
  return doc.exists ? doc.data() : null;
}

export async function saveGroupSettings(groupId, settings) {
  await groupSettingsCol.doc(groupId).set(
    { groupId, ...settings, updatedAt: Timestamp.now() },
    { merge: true }
  );
}

async function deleteInBatches(query, batchSize = 400) {
  let snapshot = await query.limit(batchSize).get();
  while (!snapshot.empty) {
    const batch = firestore.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    snapshot = await query.limit(batchSize).get();
  }
}

export async function purgeOldMessages(retentionDays = 7) {
  const cutoff = DateTime.now().minus({ days: retentionDays });
  const cutoffTimestamp = Timestamp.fromDate(cutoff.toUTC().toJSDate());
  const cutoffDateStr = cutoff.setZone(TIMEZONE).toISODate();

  await deleteInBatches(messagesCol.where('timestamp', '<', cutoffTimestamp));
  await deleteInBatches(activityCol.where('date', '<', cutoffDateStr));
}
