import { useEffect, useRef, useState } from 'react';
import { native } from './native';
import type { VtReport } from './types';
import type { VtTarget } from './tableModel';

const CONCURRENCY_OPTIONS = [1, 2, 4, 8, 16] as const;

export interface VtResult {
  state: 'querying' | 'waiting' | 'complete' | 'error' | 'cancelled';
  report?: VtReport;
  error?: string;
}
function message(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const retry =
      'retryAfterSeconds' in error && typeof error.retryAfterSeconds === 'number'
        ? `（${error.retryAfterSeconds} 秒后重试）`
        : '';
    return `${String(error.message)}${retry}`;
  }
  return String(error);
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

export function useVirusTotal(openOptions: () => void) {
  const [configured, setConfigured] = useState(false);
  const [proxy, setProxy] = useState('');
  const [testing, setTesting] = useState(false);
  const [networkMessage, setNetworkMessage] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [loading, setLoading] = useState(native.available);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [concurrency, setConcurrency] = useState(4);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, VtResult>>({});
  const [progress, setProgress] = useState({ completed: 0, total: 0, waiting: false, active: 0 });
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!native.available) return;
    let disposed = false;
    setLoading(true);
    setSettingsError(null);
    void native
      .vtSettings()
      .then((s) => {
        if (!disposed) {
          setConfigured(s.configured);
          setProxy(s.proxy ?? '');
        }
      })
      .catch((e) => {
        if (!disposed) setSettingsError(message(e));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [loadAttempt]);

  async function configure(value: string) {
    if (controller.current || testing || saving || loading) return;
    setSaving(true);
    setSettingsError(null);
    try {
      const s = await native.configureVt(value);
      setConfigured(s.configured);
      setProxy(s.proxy ?? '');
      setResults({});
    } catch (e) {
      setSettingsError(message(e));
    } finally {
      setSaving(false);
    }
  }
  async function configureProxy(value: string) {
    if (controller.current || testing || saving || loading || !native.available) return;
    setSaving(true);
    setNetworkError(null);
    setNetworkMessage(null);
    try {
      const settings = await native.configureVtProxy(value.trim());
      setProxy(settings.proxy ?? '');
      setConfigured(settings.configured);
      setNetworkMessage(settings.proxy ? 'VT 代理已保存' : '已切换为直连');
    } catch (error) {
      setNetworkError(message(error));
    } finally {
      setSaving(false);
    }
  }
  async function testConnection() {
    if (controller.current || testing || saving || loading || !native.available) return;
    setTesting(true);
    setNetworkError(null);
    setNetworkMessage(null);
    try {
      setNetworkMessage(await native.testVtConnection());
    } catch (error) {
      setNetworkError(message(error));
    } finally {
      setTesting(false);
    }
  }
  async function query(targets: VtTarget[]) {
    if (controller.current || loading || saving || testing || !targets.length || !native.available)
      return;
    if (!configured) {
      openOptions();
      setSettingsError((e) => e ?? '请先设置 VT API Key');
      return;
    }
    const batch = [...new Map(targets.map((t) => [t.hash, t])).values()];
    const abort = new AbortController();
    controller.current = abort;
    setQuerying(true);
    const result = (hash: string, value: VtResult) => {
      if (mounted.current) setResults((current) => ({ ...current, [hash]: value }));
    };
    let next = 0;
    let completed = 0;
    let active = 0;
    let resumeAt = 0;
    const publish = () => {
      if (mounted.current)
        setProgress({
          completed,
          total: batch.length,
          active,
          waiting: !abort.signal.aborted && resumeAt > Date.now(),
        });
    };
    publish();
    async function worker() {
      while (!abort.signal.aborted && next < batch.length) {
        const target = batch[next++];
        for (let attempt = 0; ; attempt++) {
          // All workers share VT's retry deadline. Requests already in flight
          // may finish; no worker starts another request before the deadline.
          while (!abort.signal.aborted && resumeAt > Date.now()) {
            result(target.hash, { state: 'waiting' });
            publish();
            await delay(resumeAt - Date.now(), abort.signal);
          }
          if (abort.signal.aborted) {
            result(target.hash, { state: 'cancelled' });
            return;
          }
          active++;
          result(target.hash, { state: 'querying' });
          publish();
          let retryRequest = false;
          try {
            const report = await native.lookupVt(target.hash);
            result(target.hash, { state: 'complete', report });
            completed++;
          } catch (e) {
            const code = e && typeof e === 'object' && 'code' in e ? e.code : '';
            const retry =
              e && typeof e === 'object' && 'retryAfterSeconds' in e ? e.retryAfterSeconds : null;
            if (
              code === 'rate-limited' &&
              batch.length > 1 &&
              typeof retry === 'number' &&
              retry >= 0 &&
              retry <= 120 &&
              attempt < 2 &&
              !abort.signal.aborted
            ) {
              resumeAt = Math.max(resumeAt, Date.now() + retry * 1000);
              result(target.hash, { state: 'waiting' });
              retryRequest = true;
            } else {
              result(target.hash, { state: 'error', error: message(e) });
              completed++;
              if (
                ['rate-limited', 'authentication', 'missing-key', 'settings-changed'].includes(
                  String(code),
                )
              ) {
                abort.abort();
              }
            }
          } finally {
            active--;
            publish();
          }
          if (!retryRequest) break;
        }
      }
    }
    try {
      await Promise.all(
        Array.from({ length: Math.min(concurrency, batch.length) }, () => worker()),
      );
    } finally {
      controller.current = null;
      if (mounted.current) {
        setQuerying(false);
        setProgress({ completed, total: batch.length, waiting: false, active: 0 });
      }
    }
  }

  async function openReports(targets: VtTarget[]) {
    setPageError(null);
    for (const hash of new Set(targets.map((t) => t.hash))) {
      try {
        await native.openVtPage('report', hash);
      } catch (e) {
        setPageError(message(e));
        break;
      }
    }
  }
  async function openInfo(page: 'api-key' | 'docs') {
    setPageError(null);
    try {
      await native.openVtPage(page, null);
    } catch (e) {
      setPageError(message(e));
    }
  }
  return {
    configured,
    proxy,
    testing,
    networkMessage,
    networkError,
    configureProxy,
    testConnection,
    loading,
    saving,
    querying,
    stopping: controller.current?.signal.aborted ?? false,
    concurrency,
    concurrencyOptions: CONCURRENCY_OPTIONS,
    setConcurrency: (value: number) => {
      if (!controller.current && CONCURRENCY_OPTIONS.some((n) => n === value))
        setConcurrency(value);
    },
    settingsError,
    pageError,
    results,
    progress,
    configure,
    query,
    openReports,
    openInfo,
    cancel: () => {
      controller.current?.abort();
      setProgress((current) => ({ ...current, waiting: false }));
    },
    reload: () => setLoadAttempt((n) => n + 1),
  };
}
export type VirusTotalState = ReturnType<typeof useVirusTotal>;
