import { describe, expect, it } from 'vitest';
import { compareHash, initialJob, jobProgress, jobReducer } from './model';
import type { FileResult, JobSummary } from './types';

export const result: FileResult = {
  path: 'C:/fixtures/abc.txt',
  name: 'abc.txt',
  size: 3,
  status: 'complete',
  hashes: {
    md5: '900150983cd24fb0d6963f7d28e17f72',
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  },
  checks: [],
  error: null,
};
export const summary: JobSummary = {
  total: 1,
  completed: 1,
  errors: 0,
  matched: 0,
  mismatched: 0,
  cancelled: false,
  elapsedMs: 2,
  results: [result],
};

describe('hash comparison', () => {
  it('matches hexadecimal hashes regardless of letter case and surrounding whitespace', () => {
    expect(compareHash(' 900150983CD24FB0D6963F7D28E17F72\n', result.hashes)).toBe('match');
  });
  it('distinguishes a wrong hash from malformed input and empty input', () => {
    expect(compareHash('0'.repeat(32), result.hashes)).toBe('mismatch');
    expect(compareHash('z'.repeat(64), result.hashes)).toBe('invalid');
    expect(compareHash('abc', result.hashes)).toBe('invalid');
    expect(compareHash(' ', result.hashes)).toBe('empty');
  });
});

describe('job lifecycle', () => {
  it('does not report unprocessed cancelled files as 100 percent complete', () => {
    const cancelled = jobReducer(initialJob, {
      type: 'finish',
      summary: { ...summary, total: 2, cancelled: true },
    });
    expect(jobProgress(cancelled)).toBe(50);
    expect(jobProgress(initialJob)).toBe(0);
  });
  it('preserves completed results when cancelled and ignores late progress', () => {
    let state = jobReducer(initialJob, { type: 'begin' });
    state = jobReducer(state, {
      type: 'event',
      event: { type: 'discovered', files: [result], totalBytes: 3 },
    });
    expect(state.rows[0].status).toBe('pending');
    state = jobReducer(state, { type: 'finish', summary: { ...summary, cancelled: true } });
    expect(state.phase).toBe('cancelled');
    expect(state.rows[0].hashes.md5).toBe('900150983cd24fb0d6963f7d28e17f72');
    state = jobReducer(state, {
      type: 'event',
      event: {
        type: 'progress',
        path: result.path,
        bytesProcessed: 1,
        fileBytes: 1,
        totalBytes: 3,
        index: 0,
        total: 1,
      },
    });
    expect(state.phase).toBe('cancelled');
  });
  it('clears stale hashes and summaries when new inputs are selected', () => {
    const done = jobReducer(initialJob, { type: 'finish', summary });
    const reset = jobReducer(done, { type: 'reset' });
    expect(reset.rows).toEqual([]);
    expect(reset.summary).toBeNull();
    const failed = jobReducer(jobReducer(reset, { type: 'begin' }), {
      type: 'error',
      error: '读取失败',
    });
    expect(failed.phase).toBe('error');
    expect(failed.error).toBe('读取失败');
  });
  it('applies a streamed event batch in order and keeps its final progress', () => {
    const state = jobReducer(jobReducer(initialJob, { type: 'begin' }), {
      type: 'events',
      events: [
        { type: 'discovered', files: [result], totalBytes: 3 },
        {
          type: 'progress',
          path: result.path,
          bytesProcessed: 1,
          fileBytes: 1,
          totalBytes: 3,
          index: 0,
          total: 1,
        },
        { type: 'file', result },
        {
          type: 'progress',
          path: result.path,
          bytesProcessed: 3,
          fileBytes: 3,
          totalBytes: 3,
          index: 0,
          total: 1,
        },
      ],
    });
    expect(state.rows[0].status).toBe('complete');
    expect(state.progress?.bytesProcessed).toBe(3);
  });
});
