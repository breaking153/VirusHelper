import { useEffect, useState } from 'react';
import { native } from '../native';
import type { VtTarget } from '../tableModel';
import type { VirusTotalState } from '../useVirusTotal';

export function VirusTotal({
  targets,
  state: vt,
  options,
}: {
  targets: VtTarget[];
  state: VirusTotalState;
  options: boolean;
}) {
  const [key, setKey] = useState('');
  const [proxy, setProxy] = useState(vt.proxy);
  useEffect(() => setProxy(vt.proxy), [vt.proxy]);
  const { configured, loading, saving, querying, settingsError, pageError } = vt;
  const unique = [...new Map(targets.map((t) => [t.hash, t])).values()];
  const current = unique.length === 1 ? vt.results[unique[0].hash] : undefined;
  const report = current?.report;
  const errors = unique.map((t) => vt.results[t.hash]?.error).filter(Boolean);
  const count = unique.length;
  const completed = unique.filter((t) => vt.results[t.hash]?.state === 'complete').length;
  const summary = report
    ? report.status === 'not-found'
      ? 'VT 未收录此文件'
      : report.status === 'pending'
        ? '暂无检测统计'
        : `检出 ${report.malicious} / ${report.total} · 可疑 ${report.suspicious}${report.lastAnalysisDate ? ` · ${new Date(report.lastAnalysisDate * 1000).toLocaleDateString()}` : ''}`
    : count > 1
      ? `已选 ${targets.length} 个文件 · ${count} 个不同哈希 · 已返回 ${completed} 项`
      : count
        ? '仅查询哈希，不上传文件'
        : '选择已计算 MD5、SHA-1 或 SHA-256 的文件后可查询';
  return (
    <section className="vt" aria-label="VirusTotal 检验">
      <div className="vt-line">
        <span>VirusTotal</span>
        <button disabled={!count || !native.available} onClick={() => void vt.openReports(targets)}>
          {count > 1 ? `网页检验（${count}）` : '免费网页检验'}
        </button>
        <button
          disabled={!count || !native.available || querying || saving || loading || vt.testing}
          onClick={() => void vt.query(targets)}
        >
          {querying ? '查询中…' : count > 1 ? `API 查询（${count}）` : 'API 查询'}
        </button>
        <label className="vt-concurrency">
          并发
          <select
            aria-label="VT 查询并发数"
            title="同时进行的查询数量"
            value={vt.concurrency}
            disabled={querying || loading || saving || vt.testing || !native.available}
            onChange={(e) => vt.setConcurrency(Number(e.target.value))}
          >
            {vt.concurrencyOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <span className="subtle vt-summary" role="status">
          {summary}
        </span>
      </div>
      {querying && (
        <div className="vt-progress" role="status">
          已处理 {vt.progress.completed} / {vt.progress.total} 项{' · '}请求中 {vt.progress.active}{' '}
          项{vt.progress.waiting ? ' · 等待额度后自动继续' : ''}
          <button onClick={vt.cancel} disabled={vt.stopping}>
            {vt.stopping ? '停止中…' : '停止查询'}
          </button>
          <span className="subtle">停止后不再发送后续请求，进行中的请求会完成</span>
        </div>
      )}
      {(errors.length > 0 || pageError) && (
        <p className="message error-text" role="alert">
          {errors.length > 1
            ? `${errors.length} 项查询失败：${errors[0]}`
            : (errors[0] ?? pageError)}
        </p>
      )}
      {options && (
        <div className="vt-settings">
          <form
            className="key-line"
            onSubmit={(event) => {
              event.preventDefault();
              void vt.configureProxy(proxy);
            }}
          >
            <label htmlFor="vt-proxy">VT 代理</label>
            <input
              id="vt-proxy"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={proxy}
              onChange={(event) => setProxy(event.target.value)}
              placeholder="socks5h://127.0.0.1:8890 或 http://主机:端口"
              disabled={saving || loading || querying || vt.testing || !native.available}
            />
            <button
              type="submit"
              disabled={saving || loading || querying || vt.testing || !native.available}
            >
              保存代理
            </button>
            <button
              type="button"
              disabled={
                saving || loading || querying || vt.testing || !native.available || !vt.proxy
              }
              onClick={() => {
                setProxy('');
                void vt.configureProxy('');
              }}
            >
              直连
            </button>
            <button
              type="button"
              disabled={
                saving ||
                loading ||
                querying ||
                vt.testing ||
                !native.available ||
                proxy.trim() !== vt.proxy
              }
              title={
                proxy.trim() !== vt.proxy
                  ? '请先保存代理设置'
                  : '使用已保存的设置测试网络，不发送 API Key'
              }
              onClick={() => void vt.testConnection()}
            >
              {vt.testing ? '测试中…' : '测试连接'}
            </button>
          </form>
          <p className="option-note">
            当前：{vt.proxy || '直连'} · 留空保存为直连，socks5h 由代理解析域名
          </p>
          {vt.networkMessage && (
            <p className="message" role="status">
              {vt.networkMessage}
            </p>
          )}
          {vt.networkError && (
            <p className="message error-text" role="alert">
              {vt.networkError}
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) {
                const value = key;
                setKey('');
                void vt.configure(value);
              }
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
              disabled={saving || loading || querying || vt.testing || !native.available}
            />
            <button
              type="submit"
              disabled={
                saving || loading || querying || vt.testing || !key.trim() || !native.available
              }
            >
              保存 Key
            </button>
            <button
              type="button"
              disabled={
                saving || loading || querying || vt.testing || !configured || !native.available
              }
              onClick={() => {
                setKey('');
                void vt.configure('');
              }}
            >
              清除 Key
            </button>
          </form>
          <p className="option-note">
            {loading ? '正在加载已保存的 Key…' : configured ? 'Key 已保存' : 'Key 未设置'} ·
            系统凭据存储 · 额度由 VT 接口判定 · 服务端返回重试时间时自动等待{' '}
            <button
              className="text-button"
              disabled={!native.available}
              onClick={() => void vt.openInfo('api-key')}
            >
              获取 Key
            </button>
            <button
              className="text-button"
              disabled={!native.available}
              onClick={() => void vt.openInfo('docs')}
            >
              使用限制
            </button>
          </p>
        </div>
      )}
      {settingsError && (
        <p className="message error-text" role="alert">
          {settingsError}
          <button type="button" onClick={vt.reload} disabled={loading || saving}>
            重新加载
          </button>
        </p>
      )}
    </section>
  );
}
