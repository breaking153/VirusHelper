import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronRight,
  Download,
  FileCheck2,
  FilePlus2,
  FolderPlus,
  Info,
  LoaderCircle,
  Moon,
  Play,
  ShieldCheck,
  Square,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { FileList } from './components/FileList';
import { ResultDetails } from './components/ResultDetails';
import { baseName, formatBytes, jobProgress } from './model';
import { native } from './native';
import { ALGORITHMS, type Algorithm, type ChecksumTarget, type FileRow } from './types';
import { useHashJob } from './useHashJob';

function initialTheme(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem('virushelper-theme');
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* A storage restriction should not prevent local hashing. */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const [mode, setMode] = useState<'hash' | 'verify'>('hash');
  const [theme, setTheme] = useState(initialTheme);
  const [algorithms, setAlgorithms] = useState<Algorithm[]>(['sha256', 'blake3', 'md5']);
  const [paths, setPaths] = useState<string[]>([]);
  const [checksums, setChecksums] = useState<ChecksumTarget[]>([]);
  const [manifest, setManifest] = useState<string | null>(null);
  const [hint, setHint] = useState<Algorithm | ''>('');
  const [exportAlgorithm, setExportAlgorithm] = useState<Algorithm>('sha256');
  const [selected, setSelected] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const job = useHashJob();
  const locked = job.busy || working;
  const resetJob = job.reset;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('virushelper-theme', theme);
    } catch {
      /* Optional preference. */
    }
  }, [theme]);

  const addPaths = useCallback(
    async (added: string[]) => {
      if (!added.length) return;
      await native.clear();
      setPaths((current) => [...new Set([...current, ...added])]);
      setSelected(null);
      setNotice(null);
      resetJob();
    },
    [resetJob],
  );

  useEffect(() => {
    if (!native.available) return;
    let disposed = false;
    const listener = native.listenDrop((type, dropped) => {
      if (disposed || locked) return;
      setDragging(type === 'enter' || type === 'over');
      if (type === 'drop' && dropped?.length) {
        setWorking(true);
        void addPaths(dropped)
          .catch((e) => setNotice({ text: String(e), error: true }))
          .finally(() => setWorking(false));
      }
    });
    void listener.catch((e) => {
      if (!disposed) setNotice({ text: `拖放初始化失败：${String(e)}`, error: true });
    });
    return () => {
      disposed = true;
      void listener.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [addPaths, locked]);

  async function perform(action: () => Promise<void>) {
    if (locked) return;
    setWorking(true);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice({ text: String(error), error: true });
    } finally {
      setWorking(false);
    }
  }
  const pickFiles = () =>
    void perform(async () => {
      await addPaths(await native.pickFiles());
    });
  const pickFolder = () =>
    void perform(async () => {
      const folder = await native.pickFolder();
      if (folder) await addPaths([folder]);
    });
  const importManifest = () =>
    void perform(async () => {
      const imported = await native.pickManifest(hint || null);
      if (!imported) return;
      await native.clear();
      setPaths([...new Set(imported.targets.map((target) => target.path))]);
      setChecksums(imported.targets);
      setManifest(imported.path);
      setSelected(null);
      resetJob();
      setAlgorithms((current) => [
        ...new Set([...current, ...imported.targets.map((target) => target.algorithm)]),
      ]);
      setMode('verify');
    });
  const clear = () =>
    void perform(async () => {
      await native.clear();
      setPaths([]);
      setChecksums([]);
      setManifest(null);
      setSelected(null);
      resetJob();
    });
  const start = () => {
    if (locked || !paths.length || !algorithms.length) return;
    setNotice(null);
    setCancelling(false);
    void job.run({ paths, algorithms, checksums });
  };
  const cancel = async () => {
    setCancelling(true);
    try {
      await native.cancel();
    } catch (error) {
      setNotice({ text: String(error), error: true });
      setCancelling(false);
    }
  };
  const copy = async (text: string) => {
    try {
      await native.copy(text);
      setNotice({ text: '已复制到剪贴板' });
    } catch (error) {
      setNotice({ text: `复制失败：${String(error)}`, error: true });
    }
  };

  const queued: FileRow[] = paths.map((path) => ({
    path,
    name: baseName(path),
    size: 0,
    status: 'pending',
    hashes: {},
    checks: [],
    error: null,
  }));
  const rows =
    job.phase === 'idle' || (job.phase === 'error' && !job.rows.length) ? queued : job.rows;
  const selectedRow = rows.find((row) => row.path === selected) ?? rows[0];
  const computedAlgorithms = ALGORITHMS.filter((a) => job.rows.some((row) => row.hashes[a.id]));
  const selectedExport = computedAlgorithms.some((a) => a.id === exportAlgorithm)
    ? exportAlgorithm
    : (computedAlgorithms[0]?.id ?? exportAlgorithm);
  const exportable = job.rows.some((row) => row.hashes[selectedExport]);
  const finished = job.rows.filter((row) => row.status !== 'pending').length;
  const progress = jobProgress(job);
  const status =
    job.phase === 'scanning'
      ? '正在扫描文件…'
      : job.busy
        ? `正在计算 ${Math.min(finished + 1, rows.length)} / ${rows.length}`
        : job.phase === 'cancelled'
          ? '已取消'
          : job.phase === 'error'
            ? '计算失败'
            : job.summary
              ? '计算完成'
              : paths.length
                ? `已添加 ${paths.length} 个路径`
                : '等待添加文件';
  const disabled = locked || !native.available;

  return (
    <div className="app-shell">
      <Sidebar
        mode={mode}
        setMode={setMode}
        algorithms={algorithms}
        setAlgorithms={setAlgorithms}
        locked={locked}
      />
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            工作台
            <ChevronRight size={13} />
            <span>文件完整性</span>
          </div>
          <div className="topbar-actions">
            <span className="offline-pill">
              <span className="tiny-dot" />
              离线工作空间
            </span>
            <span className="vertical-rule" />
            <button
              className="icon-button"
              aria-label={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
              title="切换主题"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            >
              {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
            </button>
          </div>
        </header>
        <div className="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">FILE INTEGRITY</p>
              <h1>
                {mode === 'hash' ? '文件哈希' : '清单校验'}
                <span className="title-dot">.</span>
              </h1>
              <p>
                {mode === 'hash'
                  ? '为文件生成数字指纹，确认每一次传输都完整无误。'
                  : '导入校验清单，批量确认文件是否与预期一致。'}
              </p>
            </div>
            <span className="privacy-note">
              <ShieldCheck size={17} />
              本地处理，安心校验
            </span>
          </div>
          {!native.available && (
            <div className="preview-banner">
              <Info size={16} />
              浏览器界面预览 · 请在桌面应用中添加本地文件
            </div>
          )}
          {mode === 'verify' && (
            <div className="manifest-bar">
              <FileCheck2 size={21} />
              <div>
                <strong>{manifest ? baseName(manifest) : '导入已有的校验清单'}</strong>
                <p>
                  {manifest
                    ? `${checksums.length} 条校验记录 · ${manifest}`
                    : '支持 GNU checksum 与 SFV 格式；相对路径以清单所在目录为准。'}
                </p>
              </div>
              <label className="hint-select">
                <span>清单算法</span>
                <select
                  value={hint}
                  onChange={(e) => setHint(e.target.value as Algorithm | '')}
                  disabled={locked}
                >
                  <option value="">自动识别</option>
                  {ALGORITHMS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button secondary" onClick={importManifest} disabled={disabled}>
                选择清单
              </button>
            </div>
          )}
          <div className="toolbar">
            <div className="toolbar-group">
              <button className="button secondary" onClick={pickFiles} disabled={disabled}>
                <FilePlus2 size={16} />
                添加文件
              </button>
              <button className="button secondary" onClick={pickFolder} disabled={disabled}>
                <FolderPlus size={16} />
                添加文件夹
              </button>
              <button className="button quiet" onClick={importManifest} disabled={disabled}>
                <FileCheck2 size={16} />
                导入清单
              </button>
            </div>
            <div className="toolbar-group">
              <button
                className="icon-button"
                title="清空队列"
                aria-label="清空队列"
                onClick={clear}
                disabled={disabled || !paths.length}
              >
                <Trash2 size={16} />
              </button>
              <span className="vertical-rule" />
              {job.busy ? (
                <button
                  className="button cancel"
                  onClick={() => void cancel()}
                  disabled={cancelling}
                  aria-label="取消计算"
                >
                  <Square size={13} fill="currentColor" />
                  {cancelling ? '取消中…' : '取消计算'}
                </button>
              ) : (
                <button
                  className="button primary"
                  onClick={start}
                  disabled={disabled || !paths.length || !algorithms.length}
                >
                  <Play size={14} fill="currentColor" />
                  {job.summary ? '重新计算' : '开始计算'}
                </button>
              )}
            </div>
          </div>
          {!algorithms.length && (
            <p className="selection-warning">
              <AlertCircle size={14} />
              请至少选择一种计算算法
            </p>
          )}
          {(notice || job.error) && (
            <div
              className={`notification ${notice?.error || job.error ? 'is-error' : ''}`}
              role={notice?.error || job.error ? 'alert' : 'status'}
            >
              {notice?.error || job.error ? <AlertCircle size={16} /> : <Check size={16} />}
              <span>{notice?.text ?? job.error}</span>
              {notice && !job.error && (
                <button
                  className="icon-button small"
                  aria-label="关闭提示"
                  onClick={() => setNotice(null)}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          <div className="workspace">
            <FileList
              rows={rows}
              selected={selectedRow?.path ?? null}
              select={setSelected}
              activePath={job.progress?.path}
              busy={job.busy}
              dragging={dragging}
              addFiles={pickFiles}
              disabled={disabled}
            />
            <ResultDetails
              key={selectedRow?.path ?? 'empty'}
              row={selectedRow}
              copy={(text) => void copy(text)}
            />
          </div>
          <div className="results-bar">
            <div className="result-counters">
              <span>
                <span className="counter-dot success-dot" />
                完成{' '}
                <strong>
                  {job.summary?.completed ?? job.rows.filter((r) => r.status === 'complete').length}
                </strong>
              </span>
              {job.summary && (
                <>
                  <span>
                    匹配 <strong>{job.summary.matched}</strong>
                  </span>
                  <span className={job.summary.mismatched ? 'error-text' : ''}>
                    不匹配 <strong>{job.summary.mismatched}</strong>
                  </span>
                  <span className={job.summary.errors ? 'error-text' : ''}>
                    错误 <strong>{job.summary.errors}</strong>
                  </span>
                </>
              )}
            </div>
            <div className="export-group">
              <select
                aria-label="导出算法"
                value={selectedExport}
                onChange={(e) => setExportAlgorithm(e.target.value as Algorithm)}
                disabled={locked || !computedAlgorithms.length}
              >
                {(computedAlgorithms.length ? computedAlgorithms : ALGORITHMS).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <button
                className="button quiet"
                disabled={disabled || !exportable}
                onClick={() =>
                  void perform(async () => {
                    const saved = await native.export(selectedExport);
                    if (saved) setNotice({ text: `校验清单已保存：${saved}` });
                  })
                }
              >
                <Download size={15} />
                导出清单
              </button>
            </div>
          </div>
        </div>
        <footer className="statusbar">
          <div className="status-main">
            {job.busy ? <LoaderCircle size={14} className="spin" /> : <span className="tiny-dot" />}
            <span role="status">{status}</span>
            {job.summary && (
              <span className="subtle">用时 {(job.summary.elapsedMs / 1000).toFixed(2)} 秒</span>
            )}
          </div>
          <div className="status-progress">
            <span className="mono">
              {job.busy && job.progress
                ? `${formatBytes(job.progress.bytesProcessed)} / ${formatBytes(job.progress.totalBytes)}`
                : `${algorithms.length} 种算法`}
            </span>
            <progress max={100} value={progress} aria-label="任务进度" />
          </div>
        </footer>
      </main>
    </div>
  );
}
