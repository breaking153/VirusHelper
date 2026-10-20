import { useCallback, useEffect, useRef, useState } from 'react';
import { updater, type AppUpdate } from '../updater';
import { version } from '../../package.json';

export function Updates({
  options,
  busy,
  onBusyChange,
}: {
  options: boolean;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const handle = useRef<AppUpdate | null>(null);

  const checkForUpdates = useCallback(async () => {
    const request = ++generation.current;
    setChecking(true);
    setMessage('正在检查更新…');
    setError(false);
    try {
      const next = await updater.check();
      if (request !== generation.current) {
        void next?.close().catch(() => {});
        return;
      }
      void handle.current?.close().catch(() => {});
      handle.current = next;
      setUpdate(next);
      setMessage(next ? `发现新版本 v${next.version}` : '已是最新版本');
    } catch (reason) {
      if (request === generation.current) {
        setMessage(`检查更新失败：${String(reason)}`);
        setError(true);
      }
    } finally {
      if (request === generation.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!updater.available) return;
    void checkForUpdates();
    return () => {
      generation.current++;
      void handle.current?.close().catch(() => {});
      handle.current = null;
    };
  }, [checkForUpdates]);

  async function install() {
    if (!update || busy || installing || checking) return;
    setInstalling(true);
    onBusyChange(true);
    setError(false);
    try {
      if (!installed) {
        setMessage('正在下载更新…');
        let downloaded = 0;
        let total = 0;
        await update.downloadAndInstall((event) => {
          if (event.event === 'Started') total = event.data.contentLength ?? 0;
          if (event.event === 'Progress') {
            downloaded += event.data.chunkLength;
            setMessage(
              total
                ? `正在下载更新… ${Math.min(100, Math.round((downloaded / total) * 100))}%`
                : `正在下载更新… ${(downloaded / 1024 / 1024).toFixed(1)} MB`,
            );
          }
          if (event.event === 'Finished') setMessage('正在验证签名并安装…');
        });
        setInstalled(true);
      }
      setMessage('更新已安装，正在重启…');
      await updater.relaunch();
    } catch (reason) {
      setMessage(`更新失败：${String(reason)}`);
      setError(true);
    } finally {
      setInstalling(false);
      onBusyChange(false);
    }
  }

  if (!options && !update && !installing) return null;
  return (
    <div className="update-line message" aria-label="软件更新">
      {options && <span>VirusHelper v{version}</span>}
      <span role={error ? 'alert' : 'status'} className={error ? 'error-text' : undefined}>
        {updater.available ? message : '开发预览不检查更新'}
      </span>
      {update && (
        <button
          disabled={busy || installing || checking}
          title={update.body}
          onClick={() => void install()}
        >
          {installed ? '重新启动' : installing ? '更新中…' : '更新并重启'}
        </button>
      )}
      {options && (
        <button
          disabled={!updater.available || checking || installing || installed}
          onClick={() => void checkForUpdates()}
        >
          检查更新
        </button>
      )}
    </div>
  );
}
