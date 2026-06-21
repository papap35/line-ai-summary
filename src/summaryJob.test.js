import { describe, it, expect, vi, beforeEach } from 'vitest';

const { pushMessage } = vi.hoisted(() => ({ pushMessage: vi.fn() }));

vi.mock('@line/bot-sdk', () => ({
  messagingApi: {
    MessagingApiClient: vi.fn().mockImplementation(function MessagingApiClient() {
      this.pushMessage = pushMessage;
    }),
  },
}));

vi.mock('./database.js', () => ({
  todayString: vi.fn(() => '2026-06-15'),
  getActiveGroups: vi.fn(),
  getSummary: vi.fn(),
  getTodayMessages: vi.fn(),
  getGroupSettings: vi.fn(),
  saveSummary: vi.fn(),
  purgeOldMessages: vi.fn(),
}));

vi.mock('./summarizer.js', () => ({
  summarize: vi.fn(),
}));

import * as db from './database.js';
import { summarize } from './summarizer.js';
import { runDailySummary } from './summaryJob.js';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TARGET_GROUP_ID;
  delete process.env.ADMIN_USER_ID;
  delete process.env.ADMIN_GROUP_ID;
  db.todayString.mockReturnValue('2026-06-15');
  db.purgeOldMessages.mockResolvedValue();
  db.getGroupSettings.mockResolvedValue(null);
});

describe('runDailySummary', () => {
  it('returns early without purging when no groups are active', async () => {
    db.getActiveGroups.mockResolvedValue([]);

    const result = await runDailySummary();

    expect(result).toEqual({ date: '2026-06-15', groups: 0, summarized: 0, failed: 0 });
    expect(db.purgeOldMessages).not.toHaveBeenCalled();
  });

  it('skips a group that already has a summary for the day', async () => {
    db.getActiveGroups.mockResolvedValue(['G1']);
    db.getSummary.mockResolvedValue('existing summary');

    const result = await runDailySummary();

    expect(summarize).not.toHaveBeenCalled();
    expect(pushMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ date: '2026-06-15', groups: 1, summarized: 0, failed: 0 });
    expect(db.purgeOldMessages).toHaveBeenCalledTimes(1);
  });

  it('keeps processing other groups when one group fails', async () => {
    db.getActiveGroups.mockResolvedValue(['G1', 'G2']);
    db.getSummary.mockResolvedValue(null);
    db.getTodayMessages.mockImplementation((groupId) => {
      if (groupId === 'G1') throw new Error('boom');
      return Promise.resolve([]);
    });
    summarize.mockResolvedValue('summary text');

    const result = await runDailySummary();

    expect(result).toEqual({ date: '2026-06-15', groups: 2, summarized: 1, failed: 1 });
    expect(db.saveSummary).toHaveBeenCalledTimes(1);
    expect(db.saveSummary).toHaveBeenCalledWith('G2', 'summary text', '2026-06-15');
    // Only the G2 summary push — no admin target configured.
    expect(pushMessage).toHaveBeenCalledTimes(1);
  });

  it('notifies ADMIN_USER_ID/ADMIN_GROUP_ID when a group fails', async () => {
    process.env.ADMIN_USER_ID = 'Uadmin';
    process.env.ADMIN_GROUP_ID = 'Cadmin';
    db.getActiveGroups.mockResolvedValue(['G1']);
    db.getSummary.mockResolvedValue(null);
    db.getTodayMessages.mockRejectedValue(new Error('boom'));

    const result = await runDailySummary();

    expect(result).toEqual({ date: '2026-06-15', groups: 1, summarized: 0, failed: 1 });
    expect(pushMessage).toHaveBeenCalledTimes(2);
    const recipients = pushMessage.mock.calls.map(([arg]) => arg.to);
    expect(recipients).toEqual(['Uadmin', 'Cadmin']);
    expect(pushMessage.mock.calls[0][0].messages[0].text).toContain('G1');
    expect(pushMessage.mock.calls[0][0].messages[0].text).toContain('boom');
  });

  it('passes the group\'s customPromptSuffix from getGroupSettings to summarize', async () => {
    db.getActiveGroups.mockResolvedValue(['G1']);
    db.getSummary.mockResolvedValue(null);
    db.getTodayMessages.mockResolvedValue([]);
    db.getGroupSettings.mockResolvedValue({ customPromptSuffix: '請特別注意待辦事項' });
    summarize.mockResolvedValue('summary text');

    await runDailySummary();

    expect(summarize).toHaveBeenCalledWith('G1', [], '2026-06-15', {
      customPromptSuffix: '請特別注意待辦事項',
    });
  });

  it('only processes TARGET_GROUP_ID when set, skipping getActiveGroups', async () => {
    process.env.TARGET_GROUP_ID = 'G9';
    db.getSummary.mockResolvedValue(null);
    db.getTodayMessages.mockResolvedValue([]);
    summarize.mockResolvedValue('summary text');

    const result = await runDailySummary();

    expect(db.getActiveGroups).not.toHaveBeenCalled();
    expect(result).toEqual({ date: '2026-06-15', groups: 1, summarized: 1, failed: 0 });
    expect(db.saveSummary).toHaveBeenCalledWith('G9', 'summary text', '2026-06-15');
  });
});
