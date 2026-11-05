import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { formatBytes } from '../model';
import { algorithmLabel } from '../types';
import { copyEntries, fileFormatLabel, vtHash, vtTargets, type HashEntry } from '../tableModel';
import type { VtResult } from '../useVirusTotal';
import { ColumnFilterMenu, type ColumnMenu } from './ColumnFilterMenu';
import {
  TABLE_COLUMNS,
  entryStatus,
  vtStatus as vtStatusLabel,
  threatLabel,
  type TableView,
} from '../tableView';

const PAGE_SIZE = 100;
interface Props {
  entries: HashEntry[];
  totalCount: number;
  view: TableView;
  selectedIds: string[];
  select: (ids: string[]) => void;
  copy: (text: string) => void;
  vt: (action: 'web' | 'api', entries: HashEntry[]) => void;
  vtResults: Record<string, VtResult>;
  apiBusy: boolean;
  available: boolean;
  busy: boolean;
  activePath?: string;
}

export function HashTable({
  entries,
  totalCount,
  view,
  selectedIds,
  select,
  copy,
  vt,
  vtResults,
  apiBusy,
  available,
  busy,
  activePath,
}: Props) {
  const [page, setPage] = useState(0);
  const [columnMenu, setColumnMenu] = useState<ColumnMenu | null>(null);
  const closeColumnMenu = (restoreFocus = false) => {
    const trigger = columnMenu?.trigger;
    setColumnMenu(null);
    if (restoreFocus) trigger?.focus();
  };
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[]; origin: string } | null>(
    null,
  );
  const anchor = useRef<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const allRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const selected = new Set(selectedIds);
  const chosen = entries.filter((e) => selected.has(e.id));
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const all = entries.length > 0 && chosen.length === entries.length;
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = chosen.length > 0 && !all;
  }, [chosen.length, all]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setMenu(null);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [menu]);

  function choose(
    id: string,
    modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean },
    toggle = false,
  ) {
    const anchorId = anchor.current ?? selectedIds[0];
    const from = anchorId ? entries.findIndex((e) => e.id === anchorId) : -1;
    const to = entries.findIndex((e) => e.id === id);
    if (modifiers.shiftKey && from >= 0) {
      const range = entries.slice(Math.min(from, to), Math.max(from, to) + 1).map((e) => e.id);
      select(
        modifiers.metaKey || modifiers.ctrlKey ? [...new Set([...selectedIds, ...range])] : range,
      );
    } else {
      anchor.current = id;
      select(
        toggle || modifiers.metaKey || modifiers.ctrlKey
          ? selected.has(id)
            ? selectedIds.filter((key) => key !== id)
            : [...selectedIds, id]
          : [id],
      );
    }
  }
  function context(event: MouseEvent | KeyboardEvent, entry: HashEntry) {
    event.preventDefault();
    setColumnMenu(null);
    const ids = selected.has(entry.id) ? selectedIds : [entry.id];
    if (!selected.has(entry.id)) {
      select(ids);
      anchor.current = entry.id;
    }
    const rect = rowRefs.current.get(entry.id)?.getBoundingClientRect();
    const x = 'clientX' in event ? event.clientX : (rect?.left ?? 8) + 40;
    const y = 'clientY' in event ? event.clientY : (rect?.bottom ?? 8);
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 260)),
      y: Math.max(8, Math.min(y, window.innerHeight - 360)),
      ids,
      origin: entry.id,
    });
  }
  function close() {
    const origin = menu?.origin;
    setMenu(null);
    if (origin) rowRefs.current.get(origin)?.focus();
  }
  function keyboard(event: KeyboardEvent<HTMLTableRowElement>, entry: HashEntry, index: number) {
    if (event.target instanceof HTMLInputElement) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      select(entries.map((e) => e.id));
    } else if (mod && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      const text = copyEntries(chosen, event.shiftKey ? 'table' : 'checksums', vtResults);
      if (text && available) copy(text);
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      context(event, entry);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(entry.id, event);
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? entries.length - 1
            : Math.max(
                0,
                Math.min(entries.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
              );
      choose(entries[next].id, { shiftKey: event.shiftKey });
      setPage(Math.floor(next / PAGE_SIZE));
      setTimeout(() => rowRefs.current.get(entries[next].id)?.focus(), 0);
    } else if (event.key === 'Escape') {
      select([]);
      anchor.current = null;
    }
  }
  const menuIds = new Set(menu?.ids ?? []);
  const menuEntries = menu ? entries.filter((e) => menuIds.has(e.id)) : [];
  const vtCount = new Set(vtTargets(menuEntries).map((t) => t.hash)).size;
  const menuCopy = (format: Parameters<typeof copyEntries>[1]) => {
    const text = copyEntries(menuEntries, format, vtResults);
    close();
    if (text) copy(text);
  };
  return (
    <div className="table-area">
      <div className="table-controls">
        <strong>哈希结果</strong>
        <span className="subtle">
          已选 {chosen.length} / {entries.length} 行{view.filtered ? ` · 共 ${totalCount} 行` : ''}
        </span>
        <button disabled={!entries.length} onClick={() => select(entries.map((e) => e.id))}>
          全选
        </button>
        <button disabled={!chosen.length} onClick={() => select([])}>
          取消选择
        </button>
        <button
          disabled={!view.filtered && !view.sort}
          onClick={() => {
            view.reset();
            setColumnMenu(null);
            setPage(0);
            setMenu(null);
          }}
        >
          重置筛选与排序
        </button>
        <span className="toolbar-spacer" />
        <button
          disabled={!chosen.length || !available}
          onClick={() => copy(copyEntries(chosen, 'table', vtResults))}
        >
          复制表格
        </button>
      </div>
      <div className="table-scroll">
        <table
          role="grid"
          aria-label="文件哈希"
          aria-multiselectable="true"
          aria-rowcount={entries.length + 1}
        >
          <colgroup>
            <col className="selection-column" />
            <col className="filename-column" />
            <col className="format-column" />
            <col className="algorithm-column" />
            <col className="hash-column" />
            <col className="state-column" />
            <col className="vt-column" />
            <col className="threat-column" />
          </colgroup>
          <thead>
            <tr>
              <th>
                <input
                  ref={allRef}
                  type="checkbox"
                  aria-label={`选择全部 ${entries.length} 行`}
                  checked={all}
                  disabled={!entries.length}
                  onChange={() => select(all ? [] : entries.map((e) => e.id))}
                />
              </th>
              {TABLE_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    view.sort?.column === column.key
                      ? view.sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <div className="column-heading">
                    <button
                      className="column-sort"
                      aria-label={`按${column.label}排序`}
                      title="点击切换：升序 → 降序 → 原始顺序"
                      onClick={() => {
                        view.toggleSort(column.key);
                        setPage(0);
                        setMenu(null);
                        setColumnMenu(null);
                      }}
                    >
                      {column.label}
                      {view.sort?.column === column.key && (
                        <span aria-hidden="true">
                          {view.sort.direction === 'asc' ? ' ↑' : ' ↓'}
                        </span>
                      )}
                    </button>
                    <button
                      className={`column-filter-toggle${view.columnActive(column.key) ? ' active' : ''}`}
                      aria-label={`筛选${column.label}`}
                      aria-haspopup="dialog"
                      aria-expanded={columnMenu?.column === column.key}
                      title={
                        view.columnActive(column.key)
                          ? `${column.label}：已筛选`
                          : `筛选${column.label}`
                      }
                      onClick={(event) => {
                        if (columnMenu?.column === column.key) {
                          closeColumnMenu();
                          return;
                        }
                        const trigger = event.currentTarget;
                        const rect = trigger.getBoundingClientRect();
                        setMenu(null);
                        setColumnMenu({
                          column: column.key,
                          label: column.label,
                          trigger,
                          x: Math.max(8, Math.min(rect.right - 290, window.innerWidth - 298)),
                          y: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 440)),
                          values: view.values(column.key),
                        });
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                        {view.columnActive(column.key) ? (
                          <path d="M2 3h12L9 8v5H7V8Z" fill="currentColor" />
                        ) : (
                          <path d="m4 6 4 4 4-4Z" fill="currentColor" />
                        )}
                      </svg>
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!entries.length ? (
              <tr>
                <td colSpan={8} className="empty-cell">
                  {totalCount ? '没有符合筛选条件的结果' : '添加文件后自动计算'}
                </td>
              </tr>
            ) : (
              entries
                .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
                .map((entry, offset) => {
                  const { file, algorithm, hash, id } = entry;
                  const check = file.checks.find((c) => c.algorithm === algorithm);
                  const status = entryStatus(entry, busy, activePath);
                  const result = vtResults[vtHash(file) ?? ''];
                  const vtStatus = vtStatusLabel(entry, vtResults);
                  const threat = threatLabel(entry, vtResults);
                  return (
                    <tr
                      key={id}
                      ref={(node) => {
                        if (node) rowRefs.current.set(id, node);
                        else rowRefs.current.delete(id);
                      }}
                      aria-selected={selected.has(id)}
                      aria-rowindex={currentPage * PAGE_SIZE + offset + 2}
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
                      onClick={(e) => choose(id, e)}
                      onContextMenu={(e) => context(e, entry)}
                      onKeyDown={(e) => keyboard(e, entry, currentPage * PAGE_SIZE + offset)}
                    >
                      <td className="selection-cell" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`选择 ${file.name} ${algorithm ? algorithmLabel(algorithm) : '待计算'}`}
                          checked={selected.has(id)}
                          onChange={(e) =>
                            choose(
                              id,
                              { shiftKey: (e.nativeEvent as globalThis.MouseEvent).shiftKey },
                              true,
                            )
                          }
                        />
                      </td>
                      <td
                        className="filename-cell"
                        title={`${file.path} · ${formatBytes(file.size)}`}
                        onDoubleClick={() => available && copy(file.name)}
                      >
                        {file.name}
                      </td>
                      <td
                        className="format-cell"
                        title={`${fileFormatLabel(file)} · 基于文件内容（最多前 64 KiB）`}
                        onDoubleClick={() => available && copy(fileFormatLabel(file))}
                      >
                        {fileFormatLabel(file)}
                      </td>
                      <td
                        onDoubleClick={() =>
                          available && copy(algorithm ? algorithmLabel(algorithm) : '—')
                        }
                      >
                        {algorithm ? algorithmLabel(algorithm) : '—'}
                      </td>
                      <td
                        className={hash ? 'hash-value' : 'subtle'}
                        title={check ? `预期：${check.expected}` : (hash ?? status)}
                        onDoubleClick={() => hash && available && copy(hash)}
                      >
                        {hash ?? status}
                      </td>
                      <td
                        className="state-cell"
                        title={status}
                        onDoubleClick={() => available && copy(status)}
                      >
                        {check && (
                          <span
                            className="check-mark"
                            aria-label={check.matches ? '与清单一致' : '与清单不符'}
                          >
                            {check.matches ? '✓' : '✗'}
                          </span>
                        )}
                        {status}
                      </td>
                      <td
                        className={`vt-cell ${result?.report?.malicious ? 'error-text' : ''}`}
                        onDoubleClick={() => available && copy(vtStatus)}
                        title={
                          result?.error ??
                          (result?.report
                            ? `恶意 ${result.report.malicious} · 可疑 ${result.report.suspicious} · 总数 ${result.report.total}`
                            : vtStatus)
                        }
                      >
                        {vtStatus}
                      </td>
                      <td
                        className="threat-cell"
                        onDoubleClick={() => available && copy(threat)}
                        title={
                          result?.report
                            ? `建议标签：${result.report.threatLabel || '未提供'}\n分类：${result.report.threatCategories?.join(' / ') || '未提供'}`
                            : threat
                        }
                      >
                        {threat}
                      </td>
                    </tr>
                  );
                })
            )}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span className="subtle">勾选多行 · Cmd/Ctrl 多选 · Shift 连选 · 右键操作</span>
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
      {columnMenu && (
        <ColumnFilterMenu
          key={columnMenu.column}
          menu={columnMenu}
          view={view}
          close={closeColumnMenu}
          changed={() => {
            setPage(0);
            setMenu(null);
          }}
        />
      )}
      {menu && (
        <div
          className="result-menu"
          role="menu"
          aria-label="结果快捷操作"
          ref={menuRef}
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Tab') {
              if (e.key === 'Escape') e.preventDefault();
              close();
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              const items = [
                ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
                  []),
              ];
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              items[
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? items.length - 1
                    : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
              ]?.focus();
            }
          }}
        >
          <div className="menu-caption">已选 {menuEntries.length} 行</div>
          <button
            role="menuitem"
            disabled={!available || !menuEntries.some((e) => e.hash)}
            onClick={() => menuCopy('hashes')}
          >
            复制所选哈希
          </button>
          <button role="menuitem" disabled={!available} onClick={() => menuCopy('table')}>
            复制为表格 <kbd>⇧ ⌘/Ctrl C</kbd>
          </button>
          <button
            role="menuitem"
            disabled={!available || !menuEntries.some((e) => e.hash)}
            onClick={() => menuCopy('checksums')}
          >
            复制校验行 <kbd>⌘/Ctrl C</kbd>
          </button>
          <button role="menuitem" disabled={!available} onClick={() => menuCopy('paths')}>
            复制文件路径
          </button>
          <div role="separator" />
          <button
            role="menuitem"
            disabled={!available || !vtCount}
            onClick={() => {
              close();
              vt('web', menuEntries);
            }}
          >
            VT 网页检验（{vtCount}）
          </button>
          <button
            role="menuitem"
            disabled={!available || !vtCount || apiBusy}
            onClick={() => {
              close();
              vt('api', menuEntries);
            }}
          >
            VT API 查询（{vtCount}）
          </button>
          <button
            role="menuitem"
            disabled={!available || !vtCount}
            onClick={() => menuCopy('vt-links')}
          >
            复制 VT 报告链接
          </button>
          <div role="separator" />
          <button
            role="menuitem"
            onClick={() => {
              select(entries.map((e) => e.id));
              close();
            }}
          >
            全选所有行 <kbd>⌘/Ctrl A</kbd>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              select([]);
              close();
            }}
          >
            取消选择
          </button>
        </div>
      )}
    </div>
  );
}
