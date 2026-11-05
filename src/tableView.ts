import { useMemo, useState } from 'react';
import { algorithmLabel } from './types';
import { fileFormatLabel, vtHash, vtThreatValue, type HashEntry } from './tableModel';
import type { VtResult } from './useVirusTotal';

export const TABLE_COLUMNS = [
  { key: 'name', label: '文件名' },
  { key: 'format', label: '文件格式' },
  { key: 'algorithm', label: '算法' },
  { key: 'hash', label: '哈希值' },
  { key: 'status', label: '状态' },
  { key: 'vt', label: 'VirusTotal' },
  { key: 'threat', label: 'VT 威胁类型' },
] as const;
export type ColumnKey = (typeof TABLE_COLUMNS)[number]['key'];
export type ColumnFilters = Partial<Record<ColumnKey, string>>;
export type ColumnValueFilters = Partial<Record<ColumnKey, string[]>>;
export type TableSort = { column: ColumnKey; direction: 'asc' | 'desc' } | null;
type Reports = Readonly<Record<string, VtResult>>;

export function entryStatus(entry: HashEntry, busy: boolean, activePath?: string): string {
  const { file, algorithm, hash } = entry;
  const check = file.checks.find((value) => value.algorithm === algorithm);
  return (
    file.error ??
    (file.status === 'cancelled'
      ? '已取消'
      : file.status === 'pending'
        ? busy && activePath === file.path
          ? '正在计算…'
          : '等待计算'
        : hash
          ? check
            ? check.matches
              ? '校验一致'
              : '校验不符'
            : '已完成'
          : '无计算结果')
  );
}

export function vtStatus(entry: HashEntry, results: Reports): string {
  const hash = vtHash(entry.file);
  if (!hash) return '—';
  const result = results[hash];
  if (!result) return '未查询';
  if (result.state === 'querying') return '查询中…';
  if (result.state === 'waiting') return '等待额度';
  if (result.state === 'cancelled') return '已停止';
  if (result.error || result.state === 'error') return '查询失败';
  if (result.report?.status === 'not-found') return '未收录';
  if (result.report?.status !== 'found') return '暂无统计';
  return `${result.report.malicious} / ${result.report.total}`;
}

export function threatLabel(entry: HashEntry, results: Reports): string {
  const result = results[vtHash(entry.file) ?? ''];
  const report = result?.report;
  return (
    vtThreatValue(report) ||
    (report && report.status !== 'not-found' ? '未提供' : vtStatus(entry, results))
  );
}

export function columnText(
  entry: HashEntry,
  column: ColumnKey,
  results: Reports,
  busy = false,
  activePath?: string,
): string {
  switch (column) {
    case 'name':
      return entry.file.name;
    case 'format':
      return fileFormatLabel(entry.file);
    case 'algorithm':
      return entry.algorithm ? algorithmLabel(entry.algorithm) : '—';
    case 'hash':
      return entry.hash ?? entryStatus(entry, busy, activePath);
    case 'status':
      return entryStatus(entry, busy, activePath);
    case 'vt':
      return vtStatus(entry, results);
    case 'threat':
      return threatLabel(entry, results);
  }
}

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const normalized = (value: string) => value.trim().toLocaleLowerCase();
export function filterAndSortEntries(
  entries: HashEntry[],
  filters: ColumnFilters,
  sort: TableSort,
  results: Reports,
  busy = false,
  activePath?: string,
  valueFilters: ColumnValueFilters = {},
): HashEntry[] {
  const active = Object.entries(filters).filter(([, value]) => value?.trim()) as [
    ColumnKey,
    string,
  ][];
  const checked = Object.entries(valueFilters) as [ColumnKey, string[]][];
  const filtered = entries.filter(
    (entry) =>
      checked.every(([column, values]) =>
        values.includes(columnText(entry, column, results, busy, activePath)),
      ) &&
      active.every(([column, query]) => {
        const text = columnText(entry, column, results, busy, activePath);
        if (column === 'vt') {
          const comparison = query.trim().match(/^(>=|<=|!=|>|<|=|≥|≤)?\s*(\d+)$/);
          if (comparison) {
            const report = results[vtHash(entry.file) ?? '']?.report;
            if (report?.status !== 'found') return false;
            const value = Number(comparison[2]);
            switch (comparison[1] ?? '=') {
              case '>':
                return report.malicious > value;
              case '>=':
              case '≥':
                return report.malicious >= value;
              case '<':
                return report.malicious < value;
              case '<=':
              case '≤':
                return report.malicious <= value;
              case '!=':
                return report.malicious !== value;
              default:
                return report.malicious === value;
            }
          }
          return normalized(text)
            .replaceAll(' ', '')
            .includes(normalized(query).replaceAll(' ', ''));
        }
        // Search both VT's suggested label and its original category values.
        const categories =
          column === 'threat'
            ? (results[vtHash(entry.file) ?? '']?.report?.threatCategories ?? [])
            : [];
        return normalized([text, ...categories].join(' ')).includes(normalized(query));
      }),
  );
  if (!sort) return filtered;
  const direction = sort.direction === 'asc' ? 1 : -1;
  return filtered.sort((a, b) => {
    if (sort.column === 'vt') {
      const left = results[vtHash(a.file) ?? '']?.report;
      const right = results[vtHash(b.file) ?? '']?.report;
      const leftKnown = left?.status === 'found';
      const rightKnown = right?.status === 'found';
      if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
      if (leftKnown && rightKnown)
        return direction * (left.malicious - right.malicious || left.total - right.total);
    }
    if (sort.column === 'threat') {
      const hasThreat = (entry: HashEntry) => {
        const report = results[vtHash(entry.file) ?? '']?.report;
        return !!(report?.threatLabel || report?.threatCategories?.length);
      };
      const left = hasThreat(a),
        right = hasThreat(b);
      if (left !== right) return left ? -1 : 1;
    }
    if (sort.column === 'hash') {
      const left = a.hash ?? '',
        right = b.hash ?? '';
      return direction * (left < right ? -1 : left > right ? 1 : 0);
    }
    return (
      direction *
      collator.compare(
        columnText(a, sort.column, results, busy, activePath),
        columnText(b, sort.column, results, busy, activePath),
      )
    );
  });
}

export function useTableView(
  entries: HashEntry[],
  results: Reports,
  busy = false,
  activePath?: string,
) {
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<TableSort>(null);
  const [valueFilters, setValueFilters] = useState<ColumnValueFilters>({});
  const visible = useMemo(
    () => filterAndSortEntries(entries, filters, sort, results, busy, activePath, valueFilters),
    [entries, filters, sort, results, busy, activePath, valueFilters],
  );
  return {
    entries: visible,
    filters,
    sort,
    valueFilters,
    filtered:
      Object.values(filters).some((value) => value?.trim()) || Object.keys(valueFilters).length > 0,
    columnActive: (column: ColumnKey) =>
      !!filters[column]?.trim() || valueFilters[column] !== undefined,
    values: (column: ColumnKey) => {
      const otherText = { ...filters };
      delete otherText[column];
      const otherValues = { ...valueFilters };
      delete otherValues[column];
      const candidates = filterAndSortEntries(
        entries,
        otherText,
        null,
        results,
        busy,
        activePath,
        otherValues,
      );
      const counts = new Map<string, number>();
      for (const entry of candidates) {
        const value = columnText(entry, column, results, busy, activePath);
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return [...counts]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => collator.compare(a.value, b.value));
    },
    applyColumn: (column: ColumnKey, text: string, values: string[] | null) => {
      setFilters((current) => ({ ...current, [column]: text }));
      setValueFilters((current) => {
        const next = { ...current };
        if (values === null) delete next[column];
        else next[column] = values;
        return next;
      });
    },
    sortColumn: (column: ColumnKey, direction: 'asc' | 'desc' | null) =>
      setSort(direction ? { column, direction } : null),
    toggleSort: (column: ColumnKey) =>
      setSort((current) =>
        current?.column === column
          ? current.direction === 'asc'
            ? { column, direction: 'desc' }
            : null
          : { column, direction: 'asc' },
      ),
    reset: () => {
      setFilters({});
      setValueFilters({});
      setSort(null);
    },
  };
}
export type TableView = ReturnType<typeof useTableView>;
