import { useEffect, useState } from 'react';
import { native } from '../native';
import type { VtReport } from '../types';

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

export function VirusTotal({
  hash,
  options,
  openOptions,
}: {
  hash?: string;
  options: boolean;
  openOptions: () => void;
}) {
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(native.available);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [result, setResult] = useState<{ hash: string; report?: VtReport; error?: string } | null>(
    null,
  );
  const [pageError, setPageError] = useState<string | null>(null);
  useEffect(() => {
    if (!native.available) return;
    let disposed = false;
    setLoading(true);
    setSettingsError(null);
    void native
      .vtSettings()
      .then((settings) => {
        if (!disposed) setConfigured(settings.configured);
      })
      .catch((error) => {
        if (!disposed) setSettingsError(message(error));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [loadAttempt]);

  async function configure(value: string) {
    setSaving(true);
    setSettingsError(null);
    setKey('');
    try {
      const settings = await native.configureVt(value);
      setConfigured(settings.configured);
      setResult(null);
    } catch (error) {
      setSettingsError(message(error));
    } finally {
      setSaving(false);
    }
  }
  async function query() {
    if (!hash || querying || loading) return;
    if (!configured) {
      openOptions();
      setSettingsError((current) => current ?? '请先设置 VT API Key');
      return;
    }
    setQuerying(true);
    setResult(null);
    try {
      setResult({ hash, report: await native.lookupVt(hash) });
    } catch (error) {
      setResult({ hash, error: message(error) });
    } finally {
      setQuerying(false);
    }
  }
  async function open(page: 'report' | 'api-key' | 'docs') {
    setPageError(null);
    try {
      await native.openVtPage(page, page === 'report' ? (hash ?? null) : null);
    } catch (error) {
      setPageError(message(error));
    }
  }
  const current = result?.hash === hash ? result : null;
  const report = current?.report;
  return (
    <section className="vt" aria-label="VirusTotal 检验">
      <div className="vt-line">
        <span>VirusTotal</span>
        <button disabled={!hash || !native.available} onClick={() => void open('report')}>
          免费网页检验
        </button>
        <button
          disabled={!hash || !native.available || querying || saving || loading}
          onClick={() => void query()}
        >
          {querying ? '查询中…' : 'API 查询'}
        </button>
        <span className="subtle vt-summary" role="status">
          {report
            ? report.status === 'not-found'
              ? 'VT 未收录此文件'
              : report.status === 'pending'
                ? '暂无检测统计'
                : `检出 ${report.malicious} / ${report.total} · 可疑 ${report.suspicious}${report.lastAnalysisDate ? ` · ${new Date(report.lastAnalysisDate * 1000).toLocaleDateString()}` : ''}`
            : hash
              ? '仅查询哈希，不上传文件'
              : '计算 MD5、SHA-1 或 SHA-256 后可查询'}
        </span>
      </div>
      {(current?.error || pageError) && (
        <p className="message error-text" role="alert">
          {current?.error ?? pageError}
        </p>
      )}
      {options && (
        <div className="vt-settings">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) void configure(key);
            }}
            className="key-line"
          >
            <label htmlFor="vt-key">VT API Key</label>
            <input
              id="vt-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={configured ? '已保存 · 下次启动自动加载' : '粘贴你的 API Key'}
              disabled={saving || loading || !native.available}
            />
            <button type="submit" disabled={saving || loading || !key.trim() || !native.available}>
              保存 Key
            </button>
            <button
              type="button"
              disabled={saving || loading || !configured || !native.available}
              onClick={() => void configure('')}
            >
              清除 Key
            </button>
          </form>
          <p className="option-note">
            {loading ? '正在加载已保存的 Key…' : configured ? 'Key 已保存' : 'Key 未设置'} ·
            系统凭据存储 · 公共 API：4 次/分钟、500 次/天{' '}
            <button
              className="text-button"
              disabled={!native.available}
              onClick={() => void open('api-key')}
            >
              获取 Key
            </button>
            <button
              className="text-button"
              disabled={!native.available}
              onClick={() => void open('docs')}
            >
              使用限制
            </button>
          </p>
        </div>
      )}
      {settingsError && (
        <p className="message error-text" role="alert">
          {settingsError}
          <button
            type="button"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            disabled={loading || saving}
          >
            重新加载
          </button>
        </p>
      )}
    </section>
  );
}
