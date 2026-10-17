import { useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  File,
  FileUp,
  FolderOpen,
  LoaderCircle,
  X,
} from 'lucide-react';
import { formatBytes } from '../model';
import type { FileRow } from '../types';

export function StatusBadge({ row, active }: { row: FileRow; active: boolean }) {
  if (row.status === 'error')
    return (
      <span className="badge error">
        <AlertCircle size={12} />
        读取失败
      </span>
    );
  if (row.status === 'cancelled')
    return (
      <span className="badge muted">
        <X size={12} />
        已取消
      </span>
    );
  if (row.status === 'pending')
    return active ? (
      <span className="badge processing">
        <LoaderCircle size={12} className="spin" />
        计算中
      </span>
    ) : (
      <span className="badge muted">
        <Circle size={10} />
        等待中
      </span>
    );
  if (row.checks.some((check) => !check.matches))
    return (
      <span className="badge error">
        <AlertCircle size={12} />
        不匹配
      </span>
    );
  return (
    <span className="badge success">
      <Check size={12} />
      {row.checks.length ? '校验通过' : '已完成'}
    </span>
  );
}

interface Props {
  rows: FileRow[];
  selected: string | null;
  select: (path: string) => void;
  activePath?: string;
  busy: boolean;
  dragging: boolean;
  addFiles: () => void;
  disabled: boolean;
}

export function FileList({
  rows,
  selected,
  select,
  activePath,
  busy,
  dragging,
  addFiles,
  disabled,
}: Props) {
  const [requestedPage, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / 100));
  const page = Math.min(requestedPage, pageCount - 1);
  const visibleRows = rows.slice(page * 100, (page + 1) * 100);
  return (
    <section className={`file-panel ${dragging ? 'dragging' : ''}`} aria-label="文件队列">
      <div className="panel-heading">
        <h2>
          文件队列 <span className="count">{rows.length}</span>
        </h2>
        <span className="subtle">{rows.length ? '选择文件查看完整哈希' : '支持文件与文件夹'}</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty-queue">
          <div className="drop-illustration">
            <div className="paper-back" />
            <div className="paper-front">
              <FingerprintGraphic />
            </div>
            <span className="upload-dot">
              <FileUp size={17} />
            </span>
          </div>
          <h3>{dragging ? '松开以添加文件' : busy ? '正在扫描文件…' : '将文件拖到这里'}</h3>
          <p>
            添加文件或文件夹，开始一次完整性检查。
            <br />
            无论文件大小，都在你的设备上完成。
          </p>
          <button className="button secondary" onClick={addFiles} disabled={disabled}>
            <FolderOpen size={16} />
            选择本地文件
          </button>
          <span className="drop-note">
            批量处理 <span>·</span> 大文件支持 <span>·</span> 8 种算法
          </span>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="file-table">
            <thead>
              <tr>
                <th scope="col">文件名称</th>
                <th scope="col" className="size-column">
                  大小
                </th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.path} className={row.path === selected ? 'selected' : ''}>
                  <td>
                    <button
                      className="file-select"
                      onClick={() => select(row.path)}
                      aria-pressed={row.path === selected}
                    >
                      <span className="file-symbol">
                        <File size={20} />
                      </span>
                      <span className="file-text">
                        <strong>{row.name}</strong>
                        <span title={row.path}>{row.path}</span>
                      </span>
                    </button>
                  </td>
                  <td className="size-column mono subtle">{formatBytes(row.size)}</td>
                  <td>
                    <StatusBadge row={row} active={busy && activePath === row.path} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pageCount > 1 && (
        <div className="pagination">
          <span>
            第 {page + 1} / {pageCount} 页 · 每页 100 个文件
          </span>
          <div>
            <button
              className="icon-button small"
              aria-label="上一页"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              className="icon-button small"
              aria-label="下一页"
              disabled={page === pageCount - 1}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
      <div className="queue-footnote">
        <span className="tiny-dot" />
        {dragging ? '松开鼠标，文件将加入队列' : '拖入更多文件，或通过上方按钮添加'}
      </div>
    </section>
  );
}

function FingerprintGraphic() {
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" fill="none" aria-hidden="true">
      <path
        d="M13 20c0-14 23-14 23 0v9M8 19C8 1 41 2 41 21M18 29V20c0-7 12-7 12 0v12M24 20v10c0 6-3 10-5 12M7 27c0 6-1 9-3 12M13 26c0 6-1 12-4 16M35 36c0 4-1 6-2 8M29 37c0 3-1 5-2 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
