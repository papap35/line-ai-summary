import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from './logger.js';

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes INFO logs as JSON to stdout with the given meta fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('Saved message', { step: 'save_message', groupId: 'G1' });

    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry).toEqual({ severity: 'INFO', message: 'Saved message', step: 'save_message', groupId: 'G1' });
  });

  it('writes ERROR logs to stderr and serializes Error objects', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('boom');

    logger.error('Failed to process group', { step: 'process_group', groupId: 'G1', err });

    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.severity).toBe('ERROR');
    expect(entry.groupId).toBe('G1');
    expect(entry.err).toEqual({ name: 'Error', message: 'boom', stack: err.stack });
  });
});
