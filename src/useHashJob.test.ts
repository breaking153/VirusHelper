import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useHashJob } from './useHashJob';
import { native } from './native';
import type { Algorithm, JobEvent, JobRequest, JobSummary } from './types';

vi.mock('./native', () => ({ native: { run: vi.fn(), cancel: vi.fn() } }));
const request = (algorithm: Algorithm): JobRequest => ({
  paths: ['/abc.txt'],
  algorithms: [algorithm],
  checksums: [],
});
const summary: JobSummary = {
  total: 1,
  completed: 0,
  errors: 0,
  matched: 0,
  mismatched: 0,
  cancelled: true,
  elapsedMs: 1,
  results: [],
};
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(native.cancel).mockResolvedValue();
});

it('coalesces rapid configuration changes and waits for both the old job and its cancellation before starting the latest', async () => {
  const first = deferred<JobSummary>();
  const cancellation = deferred<void>();
  vi.mocked(native.run)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue({ ...summary, cancelled: false });
  vi.mocked(native.cancel).mockReturnValue(cancellation.promise);
  const { result } = renderHook(() => useHashJob());
  let finished: Promise<void> = Promise.resolve();
  act(() => {
    finished = result.current.run(request('md5'));
  });
  act(() => {
    void result.current.run(request('sha1'));
    void result.current.run(request('sha256'));
  });
  expect(native.cancel).toHaveBeenCalledTimes(1);
  await act(async () => {
    first.resolve(summary);
    await first.promise;
  });
  expect(native.run).toHaveBeenCalledTimes(1);
  await act(async () => {
    cancellation.resolve();
    await finished;
  });
  expect(native.run).toHaveBeenCalledTimes(2);
  expect(native.run).toHaveBeenLastCalledWith(request('sha256'), expect.any(Function));
  expect(result.current.phase).toBe('done');
});

it('cancels an owned task on unmount so it cannot restart with a queued configuration', async () => {
  const first = deferred<JobSummary>();
  vi.mocked(native.run).mockReturnValue(first.promise);
  vi.mocked(native.cancel).mockImplementation(async () => {
    first.resolve(summary);
  });
  const { result, unmount } = renderHook(() => useHashJob());
  let finished: Promise<void> = Promise.resolve();
  act(() => {
    finished = result.current.run(request('md5'));
  });
  unmount();
  expect(native.cancel).toHaveBeenCalledTimes(1);
  await finished;
  expect(native.run).toHaveBeenCalledTimes(1);
});

it('does not automatically restart a queued recalculation after the user cancels', async () => {
  const first = deferred<JobSummary>();
  vi.mocked(native.run).mockReturnValue(first.promise);
  const { result } = renderHook(() => useHashJob());
  let finished: Promise<void> = Promise.resolve();
  act(() => {
    finished = result.current.run(request('md5'));
  });
  act(() => {
    void result.current.run(request('sha256'));
  });
  await act(async () => {
    await result.current.cancel();
    first.resolve(summary);
    await finished;
  });
  expect(native.run).toHaveBeenCalledTimes(1);
  expect(result.current.phase).toBe('cancelled');
});

it('ignores delayed events from the old task after the replacement task starts', async () => {
  const first = deferred<JobSummary>();
  const second = deferred<JobSummary>();
  let oldEvent: (event: JobEvent) => void = () => {};
  vi.mocked(native.run)
    .mockImplementationOnce((_request, receive) => {
      oldEvent = receive;
      return first.promise;
    })
    .mockImplementationOnce((_request, receive) => {
      receive({
        type: 'discovered',
        files: [{ path: '/abc.txt', name: 'new', size: 3, error: null }],
        totalBytes: 3,
      });
      return second.promise;
    });
  const { result } = renderHook(() => useHashJob());
  let finished: Promise<void> = Promise.resolve();
  act(() => {
    finished = result.current.run(request('md5'));
    void result.current.run(request('sha256'));
  });
  await act(async () => {
    first.resolve(summary);
    await first.promise;
  });
  act(() => {
    oldEvent({
      type: 'discovered',
      files: [{ path: '/abc.txt', name: 'stale', size: 3, error: null }],
      totalBytes: 3,
    });
  });
  await waitFor(() => expect(result.current.rows.map((row) => row.name)).toEqual(['new']));
  await act(async () => {
    second.resolve({ ...summary, cancelled: false });
    await finished;
  });
});

it('allows retrying cancellation after a transient IPC failure', async () => {
  const first = deferred<JobSummary>();
  vi.mocked(native.run).mockReturnValue(first.promise);
  vi.mocked(native.cancel)
    .mockRejectedValueOnce('暂时无法取消')
    .mockImplementationOnce(async () => {
      first.resolve(summary);
    });
  const { result } = renderHook(() => useHashJob());
  let finished: Promise<void> = Promise.resolve();
  act(() => {
    finished = result.current.run(request('md5'));
  });
  await act(async () => {
    await expect(result.current.cancel()).rejects.toBe('暂时无法取消');
  });
  await act(async () => {
    await result.current.cancel();
    await finished;
  });
  expect(native.cancel).toHaveBeenCalledTimes(2);
  expect(result.current.phase).toBe('cancelled');
});
