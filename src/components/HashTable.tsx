import { useMemo, useState } from 'react';
import { ALGORITHMS, type Algorithm, type FileRow } from '../types';
import { checksumLine, formatBytes } from '../model';

const PAGE_SIZE = 100;
interface Props {
  rows: FileRow[];
  selectedPath?: string;
  selectedAlgorithm?: Algorithm;
  select: (path: string, algorithm: Algorithm | null) => void;
  copy: (text: string) => void;
  busy: boolean;
  activePath?: string;
}

export function HashTable({
  rows,
  selectedPath,
  selectedAlgorithm,
  select,
  copy,
  busy,
  activePath,
}: Props) {
  const [page, setPage] = useState(0);
  const entries = useMemo(
    () =>
      rows.flatMap<{ file: FileRow; algorithm?: (typeof ALGORITHMS)[number] }>((file) => {
        const hashes = ALGORITHMS.filter((a) => file.hashes[a.id]);
        return hashes.length
          ? hashes.map((algorithm) => ({ file, algorithm }))
          : [{ file, algorithm: undefined }];
      }),
    [rows],
  );
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  return (
    <div className="table-area">
      <div className="table-scroll">
        <table aria-label="文件哈希">
          <thead>
            <tr>
              <th>文件名</th>
              <th>算法</th>
              <th>哈希值</th>
            </tr>
          </thead>
          <tbody>
            {!entries.length ? (
              <tr>
                <td colSpan={3} className="empty-cell">
                  添加文件后自动计算
                </td>
              </tr>
            ) : (
              entries
                .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
                .map(({ file, algorithm }) => {
                  const hash = algorithm && file.hashes[algorithm.id];
                  const check = file.checks.find((c) => c.algorithm === algorithm?.id);
                  const selected =
                    file.path === selectedPath && algorithm?.id === selectedAlgorithm;
                  const status =
                    file.error ??
                    (file.status === 'cancelled'
                      ? '已取消'
                      : file.status === 'pending'
                        ? busy && activePath === file.path
                          ? '正在计算…'
                          : '等待计算'
                        : '无计算结果');
                  const line = hash ? checksumLine(hash, file.name) : '';
                  return (
                    <tr
                      key={`${file.path}:${algorithm?.id ?? 'pending'}`}
                      aria-selected={selected}
                      tabIndex={0}
                      className={
                        check
                          ? check.matches
                            ? 'matched'
                            : 'mismatched'
                          : file.error
                            ? 'failed'
                            : ''
                      }
                      onClick={() => select(file.path, algorithm?.id ?? null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          select(file.path, algorithm?.id ?? null);
                        }
                      }}
                    >
                      <td
                        title={`${file.path} · ${formatBytes(file.size)}`}
                        onDoubleClick={() => line && copy(line)}
                      >
                        {file.name}
                      </td>
                      <td onDoubleClick={() => line && copy(line)}>{algorithm?.label ?? '—'}</td>
                      <td
                        className={hash ? 'hash-value' : 'subtle'}
                        title={
                          check
                            ? `${check.matches ? '与清单一致' : '与清单不符'}；预期：${check.expected}`
                            : (hash ?? status)
                        }
                        onDoubleClick={() => hash && copy(hash)}
                      >
                        {check && (
                          <span
                            className="check-mark"
                            aria-label={check.matches ? '与清单一致' : '与清单不符'}
                          >
                            {check.matches ? '✓' : '✗'}
                          </span>
                        )}
                        {hash ?? status}
                      </td>
                    </tr>
                  );
                })
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="pagination" aria-label="哈希结果分页">
          <span>
            {currentPage + 1} / {pages} 页 · {entries.length} 行
          </span>
          <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            上一页
          </button>
          <button disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>
            下一页
          </button>
        </nav>
      )}
    </div>
  );
}
