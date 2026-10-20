import { useCallback, useEffect, useState } from 'react';
import { HashTable } from './components/HashTable';
import { VirusTotal } from './components/VirusTotal';
import { Updates } from './components/Updates';
import { baseName, compareHash, jobProgress } from './model';
import { native } from './native';
import { ALGORITHMS, type Algorithm, type ChecksumTarget, type FileRow } from './types';
import { useHashJob } from './useHashJob';

function initialTheme(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem('virushelper-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* Optional preference. */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export default function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [options, setOptions] = useState(false);
  const [algorithms, setAlgorithms] = useState<Algorithm[]>(['md5']);
  const [paths, setPaths] = useState<string[]>([]);
  const [checksums, setChecksums] = useState<ChecksumTarget[]>([]);
  const [manifest, setManifest] = useState<string | null>(null);
  const [hint, setHint] = useState<Algorithm | ''>('');
  const [exportAlgorithm, setExportAlgorithm] = useState<Algorithm>('md5');
  const [selection, setSelection] = useState<{ path: string; algorithm: Algorithm | null } | null>(
    null,
  );
  const [expected, setExpected] = useState('');
  const [working, setWorking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const job = useHashJob();
  const locked = job.busy || working || updating;
  const disabled = locked || !native.available;
  const resetJob = job.reset;
  const runJob = job.run;
  const cancelJob = job.cancel;

  useEffect(() => {
    if (!native.available) return;
    setCancelling(false);
    if (!paths.length || !algorithms.length) {
      void cancelJob().catch((error) => setNotice({ text: errorMessage(error), error: true }));
      return;
    }
    setNotice(null);
    void runJob({ paths, algorithms, checksums });
  }, [paths, algorithms, checksums, runJob, cancelJob]);

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
      setSelection(null);
      setNotice(null);
      resetJob();
    },
    [resetJob],
  );

  useEffect(() => {
    if (!native.available) return;
    let disposed = false;
    void native
      .startupPaths()
      .then((added) => {
        if (!disposed && added.length) setPaths((current) => [...new Set([...current, ...added])]);
      })
      .catch((error) => {
        if (!disposed) setNotice({ text: errorMessage(error), error: true });
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!native.available) return;
    let disposed = false;
    const listener = native.listenDrop((type, dropped) => {
      if (disposed || locked) return;
      setDragging(type === 'enter' || type === 'over');
      if (type === 'drop' && dropped?.length) {
        setWorking(true);
        void addPaths(dropped)
          .catch((error) => setNotice({ text: errorMessage(error), error: true }))
          .finally(() => setWorking(false));
      }
    });
    void listener.catch((error) => {
      if (!disposed) setNotice({ text: `拖放初始化失败：${errorMessage(error)}`, error: true });
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
      setNotice({ text: errorMessage(error), error: true });
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
      setSelection(null);
      resetJob();
      setAlgorithms((current) => [
        ...new Set([...current, ...imported.targets.map((target) => target.algorithm)]),
      ]);
    });
  const clear = () =>
    void perform(async () => {
      await native.clear();
      setPaths([]);
      setChecksums([]);
      setManifest(null);
      setSelection(null);
      setExpected('');
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
      await cancelJob();
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
      setCancelling(false);
    }
  };
  const copy = async (text: string) => {
    try {
      await native.copy(text);
      setNotice({ text: '已复制到剪贴板' });
    } catch (error) {
      setNotice({ text: `复制失败：${errorMessage(error)}`, error: true });
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
  const selectedRow = rows.find((row) => row.path === selection?.path) ?? rows[0];
  const selectedAlgorithm =
    selection &&
    selectedRow &&
    selection.path === selectedRow.path &&
    selection.algorithm &&
    selectedRow.hashes[selection.algorithm]
      ? selection.algorithm
      : ALGORITHMS.find((a) => selectedRow?.hashes[a.id])?.id;
  const selectedHash = selectedAlgorithm ? selectedRow?.hashes[selectedAlgorithm] : undefined;
  const vtHash = selectedRow?.hashes.sha256 ?? selectedRow?.hashes.sha1 ?? selectedRow?.hashes.md5;
  const comparison = compareHash(expected, selectedRow?.hashes ?? {});
  const comparisonText = {
    empty: '',
    match: '哈希一致',
    invalid: '请输入完整的十六进制哈希',
    mismatch: '未找到匹配的哈希',
  }[comparison];
  const computedAlgorithms = ALGORITHMS.filter((a) => job.rows.some((row) => row.hashes[a.id]));
  const selectedExport = computedAlgorithms.some((a) => a.id === exportAlgorithm)
    ? exportAlgorithm
    : (computedAlgorithms[0]?.id ?? exportAlgorithm);
  const status =
    job.phase === 'scanning'
      ? '正在扫描文件…'
      : job.busy
        ? '正在计算…'
        : job.phase === 'cancelled'
          ? '已取消'
          : job.phase === 'error'
            ? '计算失败'
            : job.summary
              ? '计算完成'
              : paths.length
                ? `已添加 ${paths.length} 个路径`
                : '等待添加文件';

  return (
    <main className={`utility ${dragging ? 'dragging' : ''}`}>
      <div className="toolbar" aria-label="文件操作">
        <button onClick={pickFiles} disabled={disabled}>
          添加文件
        </button>
        <button onClick={pickFolder} disabled={disabled}>
          添加文件夹
        </button>
        <button onClick={importManifest} disabled={disabled}>
          导入清单
        </button>
        <button onClick={clear} disabled={disabled || !paths.length}>
          清空
        </button>
        <span className="toolbar-spacer" />
        {job.busy ? (
          <button onClick={() => void cancel()} disabled={cancelling}>
            {cancelling ? '取消中…' : '取消计算'}
          </button>
        ) : (
          <button
            className="primary"
            onClick={start}
            disabled={disabled || !paths.length || !algorithms.length}
          >
            重新计算
          </button>
        )}
        <button
          aria-expanded={options}
          aria-controls="options"
          onClick={() => setOptions(!options)}
        >
          选项
        </button>
      </div>
      {!native.available && <p className="message">浏览器预览 · 请在桌面应用中添加本地文件</p>}
      {manifest && (
        <p className="message" title={manifest}>
          清单：{baseName(manifest)} · {checksums.length} 条记录
        </p>
      )}
      {!algorithms.length && <p className="message error-text">请至少选择一种计算算法</p>}
      {(notice || job.error) && (
        <div
          className={`message ${notice?.error || job.error ? 'error-text' : ''}`}
          role={notice?.error || job.error ? 'alert' : 'status'}
        >
          <span>{notice?.text ?? job.error}</span>
          {notice && !job.error && (
            <button className="dismiss" aria-label="关闭提示" onClick={() => setNotice(null)}>
              ×
            </button>
          )}
        </div>
      )}
      <HashTable
        rows={rows}
        selectedPath={selectedRow?.path}
        selectedAlgorithm={selectedAlgorithm}
        select={(path, algorithm) => setSelection({ path, algorithm })}
        copy={(text) => void copy(text)}
        busy={job.busy}
        activePath={job.progress?.path}
      />
      <div className="selection-line" title={selectedRow?.path}>
        {selectedRow ? selectedRow.path : '拖放文件或文件夹到此窗口，或点击“添加文件”'}
        <span>双击哈希复制</span>
      </div>
      <div className="compare-line">
        <label htmlFor="expected-hash">哈希比对</label>
        <input
          id="expected-hash"
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          aria-label="预期哈希"
          placeholder="粘贴预期哈希值"
          spellCheck={false}
        />
        <button
          disabled={!selectedHash || !native.available}
          onClick={() => selectedHash && void copy(selectedHash)}
        >
          复制哈希
        </button>
        <button
          disabled={!selectedHash || !native.available}
          onClick={() =>
            void copy(
              ALGORITHMS.filter((a) => selectedRow?.hashes[a.id])
                .map((a) => `${a.label}: ${selectedRow!.hashes[a.id]}`)
                .join('\n'),
            )
          }
        >
          复制全部
        </button>
      </div>
      {comparisonText && (
        <p
          className={`message ${comparison === 'match' ? 'success-text' : 'error-text'}`}
          role="status"
        >
          {comparisonText}
        </p>
      )}
      <VirusTotal hash={vtHash} options={options} openOptions={() => setOptions(true)} />
      {options && (
        <section id="options" className="options" aria-label="计算选项">
          <fieldset disabled={working || updating} className="algorithms">
            <legend>计算算法</legend>
            {ALGORITHMS.map((a) => (
              <label key={a.id}>
                <input
                  type="checkbox"
                  checked={algorithms.includes(a.id)}
                  onChange={() =>
                    setAlgorithms((current) =>
                      current.includes(a.id)
                        ? current.filter((id) => id !== a.id)
                        : [...current, a.id],
                    )
                  }
                />
                {a.label}
              </label>
            ))}
          </fieldset>
          <div className="option-line">
            <label>
              清单算法{' '}
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
            <label>
              主题{' '}
              <select value={theme} onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
          </div>
        </section>
      )}
      <Updates options={options} busy={job.busy || working} onBusyChange={setUpdating} />
      <div className="results-line">
        <span>
          {job.summary
            ? `${job.summary.completed} 个完成 · ${job.summary.matched} 个匹配 · ${job.summary.mismatched} 个不匹配 · ${job.summary.errors} 个错误`
            : `${rows.length} 个文件 · ${algorithms.length} 种算法`}
        </span>
        <div className="export-controls">
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
            disabled={disabled || !computedAlgorithms.length}
            onClick={() =>
              void perform(async () => {
                const saved = await native.export(selectedExport);
                if (saved) setNotice({ text: `校验清单已保存：${saved}` });
              })
            }
          >
            导出清单
          </button>
        </div>
      </div>
      <footer className="statusbar">
        <span role="status">{status}</span>
        <span>{job.summary && `${(job.summary.elapsedMs / 1000).toFixed(2)} 秒`}</span>
        <progress max={100} value={jobProgress(job)} aria-label="任务进度" />
      </footer>
    </main>
  );
}
