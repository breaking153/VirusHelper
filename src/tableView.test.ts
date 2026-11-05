import { expect, it } from 'vitest';
import { hashEntries } from './tableModel';
import { TABLE_COLUMNS, filterAndSortEntries, threatLabel, type ColumnKey } from './tableView';
import type { FileRow } from './types';
import type { VtResult } from './useVirusTotal';

const rows: FileRow[] = ['sample10.exe', 'sample2.exe', 'sample1.txt', 'unknown.bin'].map(
  (name, i) => ({
    name,
    path: `/files/${name}`,
    size: 3,
    status: 'complete',
    fileFormat: i < 2 ? 'PE32 EXE' : 'UTF-8 文本',
    hashes: { sha256: String(i + 1).repeat(64) },
    checks: [],
    error: null,
  }),
);
const entries = hashEntries(rows);
const report = (
  index: number,
  malicious: number,
  label: string | null,
  categories: string[],
): VtResult => ({
  state: 'complete',
  report: {
    hash: entries[index].hash!,
    status: 'found',
    malicious,
    suspicious: 0,
    total: 70,
    lastAnalysisDate: null,
    threatLabel: label,
    threatCategories: categories,
  },
});
const results: Record<string, VtResult> = {
  [entries[0].hash!]: report(0, 2, 'trojan.generic/a', ['trojan', 'downloader']),
  [entries[1].hash!]: report(1, 10, 'ransomware.test', ['ransomware']),
  [entries[2].hash!]: report(2, 0, null, []),
};
const names = (values: typeof entries) => values.map((entry) => entry.file.name);

it('sorts natural filenames in both directions and preserves original order for equal keys', () => {
  expect(
    names(filterAndSortEntries(entries, {}, { column: 'name', direction: 'asc' }, results)),
  ).toEqual(['sample1.txt', 'sample2.exe', 'sample10.exe', 'unknown.bin']);
  expect(
    names(filterAndSortEntries(entries, {}, { column: 'name', direction: 'desc' }, results)),
  ).toEqual(['unknown.bin', 'sample10.exe', 'sample2.exe', 'sample1.txt']);
  expect(
    filterAndSortEntries(entries, {}, { column: 'algorithm', direction: 'asc' }, results),
  ).toEqual(entries);
  expect(names(filterAndSortEntries(entries, {}, null, results))).toEqual(
    rows.map((row) => row.name),
  );
});

it('filters every data column and combines filters with AND using the displayed content', () => {
  const queries: Record<ColumnKey, string> = {
    name: 'SAMPLE2',
    format: 'pe32',
    algorithm: 'sha-256',
    hash: '222222',
    status: '已完成',
    vt: '>=10',
    threat: 'RANSOMWARE',
  };
  for (const { key } of TABLE_COLUMNS) {
    expect(filterAndSortEntries(entries, { [key]: queries[key] }, null, results)).toContainEqual(
      entries[1],
    );
  }
  expect(filterAndSortEntries(entries, queries, null, results)).toEqual([entries[1]]);
  expect(
    filterAndSortEntries(entries, { format: 'UTF-8', threat: 'trojan' }, null, results),
  ).toEqual([]);
  expect(filterAndSortEntries(entries, { threat: 'downloader' }, null, results)).toEqual([
    entries[0],
  ]);
});

it('sorts VT numerically, keeps unknown results last in either direction and supports counts or ratios', () => {
  expect(
    names(filterAndSortEntries(entries, {}, { column: 'vt', direction: 'asc' }, results)),
  ).toEqual(['sample1.txt', 'sample10.exe', 'sample2.exe', 'unknown.bin']);
  expect(
    names(filterAndSortEntries(entries, {}, { column: 'vt', direction: 'desc' }, results)),
  ).toEqual(['sample2.exe', 'sample10.exe', 'sample1.txt', 'unknown.bin']);
  expect(filterAndSortEntries(entries, { vt: '0' }, null, results)).toEqual([entries[2]]);
  expect(filterAndSortEntries(entries, { vt: '>0' }, null, results)).toEqual(entries.slice(0, 2));
  expect(filterAndSortEntries(entries, { vt: '≤2' }, null, results)).toEqual([
    entries[0],
    entries[2],
  ]);
  expect(filterAndSortEntries(entries, { vt: '2/70' }, null, results)).toEqual([entries[0]]);
  expect(filterAndSortEntries(entries, { vt: '未查询' }, null, results)).toEqual([entries[3]]);
});

it('updates status and threat filtering from live results without inventing a threat for missing classification', () => {
  const updated = { ...results, [entries[3].hash!]: report(3, 5, null, ['trojan']) };
  expect(filterAndSortEntries(entries, { threat: 'trojan' }, null, updated)).toEqual([
    entries[0],
    entries[3],
  ]);
  expect(threatLabel(entries[3], updated)).toBe('trojan');
  expect(threatLabel(entries[2], results)).toBe('未提供');
  expect(threatLabel(entries[3], results)).toBe('未查询');
  const pending = hashEntries([{ ...rows[0], status: 'pending', hashes: {} }]);
  expect(
    filterAndSortEntries(pending, { status: '正在计算' }, null, {}, true, rows[0].path),
  ).toEqual(pending);
});
