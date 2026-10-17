import { FileCheck2, Fingerprint, Hash, ShieldCheck } from 'lucide-react';
import { ALGORITHMS, type Algorithm } from '../types';

interface Props {
  mode: 'hash' | 'verify';
  setMode: (mode: 'hash' | 'verify') => void;
  algorithms: Algorithm[];
  setAlgorithms: (items: Algorithm[]) => void;
  locked: boolean;
}

export function Sidebar({ mode, setMode, algorithms, setAlgorithms, locked }: Props) {
  function toggle(id: Algorithm) {
    setAlgorithms(
      algorithms.includes(id) ? algorithms.filter((item) => item !== id) : [...algorithms, id],
    );
  }
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Hash size={26} strokeWidth={2.3} />
        </span>
        <div>
          <strong>VirusHelper</strong>
          <span>文件完整性工具</span>
        </div>
        <span className="version">0.1</span>
      </div>
      <nav className="navigation" aria-label="工作模式">
        <button
          className={mode === 'hash' ? 'nav-item active' : 'nav-item'}
          onClick={() => setMode('hash')}
          aria-current={mode === 'hash' ? 'page' : undefined}
        >
          <Fingerprint size={18} />
          文件哈希
          <span className="nav-dot" />
        </button>
        <button
          className={mode === 'verify' ? 'nav-item active' : 'nav-item'}
          onClick={() => setMode('verify')}
          aria-current={mode === 'verify' ? 'page' : undefined}
        >
          <FileCheck2 size={18} />
          清单校验
          <span className="nav-dot" />
        </button>
      </nav>
      <div className="algorithm-heading">
        <h2>计算算法</h2>
        <span>{algorithms.length} / 8</span>
      </div>
      <fieldset className="algorithm-list" disabled={locked}>
        <legend className="sr-only">选择哈希算法</legend>
        {[...new Set(ALGORITHMS.map((a) => a.group))].map((group) => (
          <div className="algorithm-group" key={group}>
            <p className="group-label">{group}</p>
            {ALGORITHMS.filter((a) => a.group === group).map((a) => (
              <label
                className={`algorithm-option ${algorithms.includes(a.id) ? 'checked' : ''}`}
                key={a.id}
              >
                <input
                  type="checkbox"
                  checked={algorithms.includes(a.id)}
                  onChange={() => toggle(a.id)}
                />
                <span>{a.label}</span>
                {a.note && <small>{a.note}</small>}
              </label>
            ))}
          </div>
        ))}
      </fieldset>
      <p className="algorithm-note">
        一次读取，同时计算多种哈希。
        <br />
        更改算法后，重新计算即可更新结果。
      </p>
      <div className="local-assurance">
        <ShieldCheck size={19} />
        <div>
          <strong>文件始终留在本地</strong>
          <span>离线计算，无需上传</span>
        </div>
      </div>
    </aside>
  );
}
