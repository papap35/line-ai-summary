import { describe, it, expect, afterEach, vi } from 'vitest';
import { todayString, dayRange } from './database.js';

describe('todayString', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the TIMEZONE (Asia/Taipei) date, not the UTC date', () => {
    // 2026-06-14T17:00:00Z is already 2026-06-15 01:00 in Asia/Taipei (UTC+8).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T17:00:00Z'));

    expect(todayString()).toBe('2026-06-15');
  });
});

describe('dayRange', () => {
  it('returns UTC timestamp bounds for the start and end of the local day', () => {
    const { start, end } = dayRange('2026-06-15');

    // 2026-06-15 00:00 Asia/Taipei (UTC+8) == 2026-06-14 16:00 UTC.
    expect(start.toDate().toISOString()).toBe('2026-06-14T16:00:00.000Z');
    expect(end.toDate().toISOString()).toBe('2026-06-15T16:00:00.000Z');
  });

  it('produces a 24-hour [start, end) range', () => {
    const { start, end } = dayRange('2026-01-01');

    expect(end.toMillis() - start.toMillis()).toBe(24 * 60 * 60 * 1000);
  });
});
