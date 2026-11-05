import { useEffect, useRef, useState } from 'react';
import type { ColumnKey, TableView } from '../tableView';

export interface ColumnMenu {
  column: ColumnKey;
  label: string;
  x: number;
  y: number;
  values: { value: string; count: number }[];
  trigger: HTMLButtonElement;
}

export function ColumnFilterMenu({
  menu,
  view,
  close,
  changed,
}: {
  menu: ColumnMenu;
  view: TableView;
  close: (restoreFocus?: boolean) => void;
  changed: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const allRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [condition, setCondition] = useState(view.filters[menu.column] ?? '');
  const [checked, setChecked] = useState(
    () => new Set(view.valueFilters[menu.column] ?? menu.values.map((item) => item.value)),
  );
  const shown = menu.values.filter((item) =>
    item.value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const selectedCount = shown.filter((item) => checked.has(item.value)).length;
  const all = shown.length > 0 && selectedCount === shown.length;
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = selectedCount > 0 && !all;
  }, [selectedCount, all]);
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    const dismiss = (event: Event) => {
      if (
        event.target instanceof Node &&
        (ref.current?.contains(event.target) || menu.trigger.contains(event.target))
      )
        return;
      closeRef.current();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [menu]);

  const apply = () => {
    const selected = shown.filter((item) => checked.has(item.value)).map((item) => item.value);
    view.applyColumn(
      menu.column,
      condition,
      selected.length === menu.values.length ? null : selected,
    );
    changed();
    close(true);
  };
  const sort = (direction: 'asc' | 'desc' | null) => {
    view.sortColumn(menu.column, direction);
    changed();
    close(true);
  };
  return (
    <form
      ref={ref}
      className="column-filter-menu"
      role="dialog"
      aria-label={`${menu.label}筛选`}
      style={{ left: menu.x, top: menu.y, maxHeight: `calc(100vh - ${menu.y + 8}px)` }}
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          close(true);
        }
      }}
    >
      <div className="filter-sort-actions">
        <button type="button" onClick={() => sort('asc')}>
          ↑ 升序
        </button>
        <button type="button" onClick={() => sort('desc')}>
          ↓ 降序
        </button>
        <button
          type="button"
          disabled={!view.sort || view.sort.column !== menu.column}
          onClick={() => sort(null)}
        >
          取消排序
        </button>
      </div>
      <button
        className="clear-column-filter"
        type="button"
        disabled={!view.columnActive(menu.column)}
        onClick={() => {
          view.applyColumn(menu.column, '', null);
          changed();
          close(true);
        }}
      >
        清除此列筛选
      </button>
      <input
        type="search"
        className="filter-value-search"
        aria-label={`搜索${menu.label}的值`}
        placeholder="搜索"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <label className="filter-select-all">
        <input
          ref={allRef}
          type="checkbox"
          checked={all}
          disabled={!shown.length}
          onChange={() =>
            setChecked((current) => {
              const next = new Set(current);
              for (const item of shown) {
                if (all) next.delete(item.value);
                else next.add(item.value);
              }
              return next;
            })
          }
        />
        {search ? '全选搜索结果' : '全选'}
        <span className="subtle">
          {selectedCount} / {shown.length}
        </span>
      </label>
      <div className="filter-value-list" role="group" aria-label={`${menu.label}的可选值`}>
        {shown.slice(0, 200).map((item) => (
          <label key={item.value} title={item.value}>
            <input
              type="checkbox"
              aria-label={`值：${item.value}`}
              checked={checked.has(item.value)}
              onChange={() =>
                setChecked((current) => {
                  const next = new Set(current);
                  if (next.has(item.value)) next.delete(item.value);
                  else next.add(item.value);
                  return next;
                })
              }
            />
            <span className="filter-value">{item.value || '（空白）'}</span>
            <span className="subtle">{item.count}</span>
          </label>
        ))}
        {!shown.length && <p className="subtle">无匹配项</p>}
        {shown.length > 200 && <p className="subtle">显示前 200 项，请搜索缩小范围</p>}
      </div>
      <details className="filter-condition" open={!!view.filters[menu.column]?.trim()}>
        <summary>{menu.column === 'vt' ? '数字 / 状态筛选' : '文本筛选'}</summary>
        <input
          aria-label={`筛选${menu.label}`}
          placeholder={menu.column === 'vt' ? '如 >0、>=5、未查询' : '包含文本…'}
          value={condition}
          onChange={(event) => setCondition(event.target.value)}
        />
      </details>
      <div className="filter-menu-footer">
        <button type="submit" className="primary">
          确定
        </button>
        <button type="button" onClick={() => close(true)}>
          取消
        </button>
      </div>
    </form>
  );
}
