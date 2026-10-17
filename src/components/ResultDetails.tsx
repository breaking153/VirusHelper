import { useState } from 'react';
import { AlertCircle, Check, Copy, Fingerprint, ShieldCheck } from 'lucide-react';
import { compareHash, formatBytes } from '../model';
import { ALGORITHMS, type FileRow } from '../types';
import { StatusBadge } from './FileList';

export function ResultDetails({ row, copy }: { row?: FileRow; copy: (text: string) => void }) {
  const [expected, setExpected] = useState('');
  const comparison = compareHash(expected, row?.hashes ?? {});
  const hashes = ALGORITHMS.filter((algorithm) => row?.hashes[algorithm.id]);
  return (
    <aside className="details-panel" aria-label="哈希详情">
      <div className="panel-heading">
        <h2>哈希详情</h2>
        <Fingerprint size={17} className="subtle" />
      </div>
      {!row ? (
        <div className="empty-details">
          <div className="detail-empty-icon">
            <Fingerprint size={34} strokeWidth={1.3} />
          </div>
          <h3>让每个字节都有据可循</h3>
          <p>
            计算完成后，选择一个文件
            <br />
            查看、复制或比对哈希值。
          </p>
        </div>
      ) : (
        <div className="details-content">
          <div className="selected-file">
            <h3 title={row.name}>{row.name}</h3>
            <div>
              <span className="mono subtle">{formatBytes(row.size)}</span>
              <StatusBadge row={row} active={false} />
            </div>
            <p title={row.path}>{row.path}</p>
          </div>
          {row.error && (
            <div className="inline-error">
              <AlertCircle size={16} />
              <span>{row.error}</span>
            </div>
          )}
          {hashes.length ? (
            <>
              <div className="section-title">
                <h3>
                  计算结果 <span>{hashes.length}</span>
                </h3>
                <button
                  className="text-button"
                  onClick={() =>
                    copy(hashes.map((a) => `${a.label}: ${row.hashes[a.id]}`).join('\n'))
                  }
                >
                  <Copy size={12} />
                  复制全部
                </button>
              </div>
              <div className="hash-list">
                {hashes.map((algorithm) => {
                  const check = row.checks.find((c) => c.algorithm === algorithm.id);
                  return (
                    <div
                      className={`hash-item ${check && !check.matches ? 'hash-mismatch' : ''}`}
                      key={algorithm.id}
                    >
                      <div className="hash-label">
                        <span>{algorithm.label}</span>
                        <button
                          className="icon-button small"
                          aria-label={`复制 ${algorithm.label}`}
                          title="复制哈希"
                          onClick={() => copy(row.hashes[algorithm.id]!)}
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                      <code>{row.hashes[algorithm.id]}</code>
                      {check && (
                        <p
                          className={
                            check.matches ? 'check-result success-text' : 'check-result error-text'
                          }
                        >
                          {check.matches ? (
                            <>
                              <Check size={12} />
                              与清单一致
                            </>
                          ) : (
                            <>
                              <AlertCircle size={12} />
                              与清单不符
                            </>
                          )}
                        </p>
                      )}
                      {check && !check.matches && (
                        <p className="expected-hash">预期：{check.expected}</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="manual-verify">
                <div className="section-title">
                  <h3>
                    <ShieldCheck size={15} />
                    快速比对
                  </h3>
                  <span className="subtle">自动识别已计算算法</span>
                </div>
                <label htmlFor="expected-hash" className="sr-only">
                  预期哈希
                </label>
                <textarea
                  id="expected-hash"
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  placeholder="粘贴预期哈希值…"
                  spellCheck={false}
                  rows={3}
                />
                <div className={`comparison ${comparison}`} role="status">
                  {comparison === 'empty' ? (
                    '与此文件的所有已计算哈希比对'
                  ) : comparison === 'match' ? (
                    <>
                      <Check size={14} />
                      哈希一致
                    </>
                  ) : comparison === 'invalid' ? (
                    <>
                      <AlertCircle size={14} />
                      请输入完整的十六进制哈希
                    </>
                  ) : (
                    <>
                      <AlertCircle size={14} />
                      未找到匹配的哈希
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="detail-pending">
              {row.status === 'cancelled'
                ? '此文件尚未完成计算，可重新开始。'
                : row.status === 'error'
                  ? '请检查文件权限或文件是否存在后重试。'
                  : '计算完成后，哈希值会显示在这里。'}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
