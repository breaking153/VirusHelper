import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVirusTotal } from './useVirusTotal';
import { native } from './native';
import type { VtReport } from './types';
vi.mock('./native', () => ({
  native: {
    available: true,
    vtSettings: vi.fn(),
    configureVt: vi.fn(),
    configureVtProxy: vi.fn(),
    testVtConnection: vi.fn(),
    lookupVt: vi.fn(),
    openVtPage: vi.fn(),
  },
}));
const targets = [1, 2, 3].map((i) => ({
  path: `/file${i}`,
  name: `file${i}`,
  hash: String(i).repeat(64),
}));
const report = (hash: string): VtReport => ({
  hash,
  status: 'found',
  malicious: 0,
  suspicious: 0,
  total: 70,
  lastAnalysisDate: null,
  threatLabel: null,
  threatCategories: [],
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(native.vtSettings).mockResolvedValue({ configured: true, proxy: null });
  vi.mocked(native.lookupVt).mockImplementation(async (hash) => report(hash));
});
afterEach(() => vi.useRealTimers());
async function setup() {
  const hook = renderHook(() => useVirusTotal(vi.fn()));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}
it('queries a fixed snapshot and deduplicates identical hashes', async () => {
  const { result } = await setup();
  await act(async () => {
    await result.current.query([targets[0], { ...targets[0], path: '/copy' }, targets[1]]);
  });
  expect(vi.mocked(native.lookupVt).mock.calls.map(([hash]) => hash)).toEqual([
    targets[0].hash,
    targets[1].hash,
  ]);
  expect(result.current.progress).toEqual({ completed: 2, total: 2, waiting: false, active: 0 });
  expect(result.current.results[targets[0].hash].report?.total).toBe(70);
});
it('uses the server retry time exactly and resumes the same file before advancing', async () => {
  const { result } = await setup();
  vi.useFakeTimers();
  vi.mocked(native.lookupVt)
    .mockResolvedValueOnce(report(targets[0].hash))
    .mockRejectedValueOnce({ code: 'rate-limited', message: '等待额度', retryAfterSeconds: 1 });
  let pending: Promise<void> = Promise.resolve();
  await act(async () => {
    pending = result.current.query(targets.slice(0, 2));
  });
  expect(result.current.progress.waiting).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(999);
  });
  expect(native.lookupVt).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
    await pending;
  });
  expect(vi.mocked(native.lookupVt).mock.calls.map(([hash]) => hash)).toEqual([
    targets[0].hash,
    targets[1].hash,
    targets[1].hash,
  ]);
  expect(result.current.progress.completed).toBe(2);
});
it('sends more than four successful queries without local delays or quotas', async () => {
  const { result } = await setup();
  vi.useFakeTimers();
  const batch = Array.from({ length: 6 }, (_, i) => ({
    path: `/batch-${i}`,
    name: `batch-${i}`,
    hash: String(i).repeat(64),
  }));
  await act(async () => {
    await result.current.query(batch);
  });
  expect(native.lookupVt).toHaveBeenCalledTimes(6);
  expect(vi.getTimerCount()).toBe(0);
  expect(result.current.progress.completed).toBe(6);
});
it('cancels the quota wait without sending another query', async () => {
  const { result } = await setup();
  vi.useFakeTimers();
  vi.mocked(native.lookupVt).mockRejectedValue({
    code: 'rate-limited',
    message: '等待额度',
    retryAfterSeconds: 60,
  });
  let pending: Promise<void> = Promise.resolve();
  await act(async () => {
    pending = result.current.query(targets);
  });
  expect(result.current.querying).toBe(true);
  await act(async () => {
    result.current.cancel();
    await pending;
  });
  expect(native.lookupVt).toHaveBeenCalledTimes(3);
  expect(result.current.querying).toBe(false);
  expect(result.current.results[targets[0].hash].state).toBe('cancelled');
});
it('stops the remaining queue on authentication or daily quota errors', async () => {
  const { result } = await setup();
  vi.mocked(native.lookupVt).mockRejectedValue({
    code: 'rate-limited',
    message: '今日额度不足',
    retryAfterSeconds: null,
  });
  await act(async () => {
    await result.current.query([
      ...targets,
      ...[4, 5, 6].map((i) => ({
        path: `/file${i}`,
        name: `file${i}`,
        hash: String(i).repeat(64),
      })),
    ]);
  });
  expect(native.lookupVt).toHaveBeenCalledTimes(4);
  expect(result.current.results[targets[0].hash].error).toContain('今日额度不足');
});
it('opens one report page for each distinct selected hash', async () => {
  const { result } = await setup();
  await act(async () => {
    await result.current.openReports([targets[0], targets[0], targets[1]]);
  });
  expect(vi.mocked(native.openVtPage).mock.calls).toEqual([
    ['report', targets[0].hash],
    ['report', targets[1].hash],
  ]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const batchTargets = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    path: `/parallel-${i}`,
    name: `parallel-${i}`,
    hash: i.toString(16).repeat(64),
  }));

it('bounds parallel requests and fills free slots while a slower request is still pending', async () => {
  const { result } = await setup();
  const batch = batchTargets(6);
  const replies = batch.map(() => deferred<VtReport>());
  vi.mocked(native.lookupVt).mockImplementation(
    (hash) => replies[batch.findIndex((t) => t.hash === hash)].promise,
  );
  let pending: Promise<void> = Promise.resolve();
  await act(async () => {
    pending = result.current.query(batch);
  });
  expect(native.lookupVt).toHaveBeenCalledTimes(4);
  expect(result.current.progress.active).toBe(4);
  await act(async () => {
    replies[1].resolve(report(batch[1].hash));
  });
  expect(native.lookupVt).toHaveBeenCalledTimes(5);
  expect(result.current.progress.active).toBe(4);
  expect(result.current.results[batch[0].hash].state).toBe('querying');
  await act(async () => {
    replies[3].resolve(report(batch[3].hash));
  });
  expect(native.lookupVt).toHaveBeenCalledTimes(6);
  await act(async () => {
    for (const i of [5, 2, 4, 0]) replies[i].resolve(report(batch[i].hash));
    await pending;
  });
  expect(result.current.progress).toEqual({ completed: 6, total: 6, active: 0, waiting: false });
  for (const target of batch)
    expect(result.current.results[target.hash].report?.hash).toBe(target.hash);
});

it('stops new work while allowing already-started parallel requests to finish', async () => {
  const { result } = await setup();
  const batch = batchTargets(8);
  const replies = batch.map(() => deferred<VtReport>());
  vi.mocked(native.lookupVt).mockImplementation(
    (hash) => replies[batch.findIndex((t) => t.hash === hash)].promise,
  );
  let pending: Promise<void> = Promise.resolve();
  await act(async () => {
    pending = result.current.query(batch);
  });
  act(() => {
    result.current.cancel();
  });
  expect(result.current.stopping).toBe(true);
  await act(async () => {
    for (let i = 0; i < 4; i++) replies[i].resolve(report(batch[i].hash));
    await pending;
  });
  expect(native.lookupVt).toHaveBeenCalledTimes(4);
  expect(result.current.progress.completed).toBe(4);
  expect(result.current.querying).toBe(false);
});

it('pauses every worker on a server retry deadline, including slots freed by successful requests', async () => {
  const { result } = await setup();
  vi.useFakeTimers();
  const batch = batchTargets(6);
  const replies = batch.map(() => deferred<VtReport>());
  const retryReply = deferred<VtReport>();
  let attempts = 0;
  vi.mocked(native.lookupVt).mockImplementation((hash) => {
    const index = batch.findIndex((t) => t.hash === hash);
    return index === 0 && ++attempts > 1 ? retryReply.promise : replies[index].promise;
  });
  let pending: Promise<void> = Promise.resolve();
  await act(async () => {
    pending = result.current.query(batch);
  });
  await act(async () => {
    replies[0].reject({ code: 'rate-limited', message: 'VT HTTP 429', retryAfterSeconds: 1 });
  });
  await act(async () => {
    for (const i of [1, 2, 3]) replies[i].resolve(report(batch[i].hash));
  });
  expect(result.current.progress.waiting).toBe(true);
  expect(native.lookupVt).toHaveBeenCalledTimes(4);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(999);
  });
  expect(native.lookupVt).toHaveBeenCalledTimes(4);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(native.lookupVt).toHaveBeenCalledTimes(7);
  await act(async () => {
    retryReply.resolve(report(batch[0].hash));
    for (const i of [4, 5]) replies[i].resolve(report(batch[i].hash));
    await pending;
  });
  expect(result.current.progress.completed).toBe(6);
});

it('uses the selected concurrency for a new batch', async () => {
  const { result } = await setup();
  act(() => {
    result.current.setConcurrency(2);
  });
  const batch = batchTargets(3);
  const replies = batch.map(() => deferred<VtReport>());
  vi.mocked(native.lookupVt).mockImplementation(
    (hash) => replies[batch.findIndex((t) => t.hash === hash)].promise,
  );
  let pending: Promise<void> = Promise.resolve();
  await act(async () => {
    pending = result.current.query(batch);
  });
  expect(native.lookupVt).toHaveBeenCalledTimes(2);
  act(() => {
    result.current.setConcurrency(16);
  });
  expect(result.current.concurrency).toBe(2);
  await act(async () => {
    for (let i = 0; i < 3; i++) replies[i].resolve(report(batch[i].hash));
    await pending;
  });
});
