import { ALGORITHMS, type Algorithm, type FileRow, type VtReport } from './types';

export interface HashEntry {
  id: string;
  file: FileRow;
  algorithm?: Algorithm;
  hash?: string;
}
export interface VtTarget {
  path: string;
  name: string;
  hash: string;
}
export const vtHash = (file: FileRow) => file.hashes.sha256 ?? file.hashes.sha1 ?? file.hashes.md5;
export const fileFormatLabel = (file: FileRow): string =>
  file.fileFormat ?? (file.status === 'pending' ? '待识别' : file.error ? '读取失败' : '未知格式');
export function hashEntries(rows: FileRow[]): HashEntry[] {
  return rows.flatMap((file) => {
    const algorithms = ALGORITHMS.filter((a) => file.hashes[a.id]);
    return (algorithms.length ? algorithms.map((a) => a.id) : [undefined]).map((algorithm) => ({
      id: JSON.stringify([file.path, algorithm ?? null]),
      file,
      algorithm,
      hash: algorithm ? file.hashes[algorithm] : undefined,
    }));
  });
}
export function vtTargets(entries: HashEntry[]): VtTarget[] {
  const files = new Map(entries.map(({ file }) => [file.path, file]));
  return [...files.values()].flatMap((file) => {
    const hash = vtHash(file);
    return hash ? [{ path: file.path, name: file.name, hash }] : [];
  });
}
export const vtThreatValue = (report?: VtReport): string =>
  report?.threatLabel || report?.threatCategories?.join(' / ') || '';
export type CopyFormat = 'hashes' | 'table' | 'checksums' | 'paths' | 'vt-links';
export function copyEntries(
  entries: HashEntry[],
  format: CopyFormat,
  vtResults: Readonly<Record<string, { report?: VtReport }>> = {},
): string {
  const complete = entries.filter((e) => e.hash);
  const cell = (value: string) =>
    /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  switch (format) {
    case 'hashes':
      return complete.map((e) => e.hash).join('\n');
    case 'checksums':
      return complete
        .map((e) => {
          const report = vtResults[vtHash(e.file) ?? '']?.report;
          const result =
            report?.status === 'found' ? `${report.malicious}\\${report.total}` : '0\\0';
          return [e.file.name, fileFormatLabel(e.file), e.hash!, result].map(cell).join('\t');
        })
        .join('\n');
    case 'paths':
      return [...new Set(entries.map((e) => e.file.path))].join('\n');
    case 'vt-links':
      return [
        ...new Set(vtTargets(entries).map((t) => `https://www.virustotal.com/gui/file/${t.hash}`)),
      ].join('\n');
    case 'table':
      return [
        ['文件名', '文件格式', '算法', '哈希值', '文件路径', 'VirusTotal', 'VT 威胁类型'],
        ...entries.map((e) => {
          const report = vtResults[vtHash(e.file) ?? '']?.report;
          const vt =
            report?.status === 'found'
              ? `${report.malicious} / ${report.total}`
              : report?.status === 'not-found'
                ? '未收录'
                : report
                  ? '暂无统计'
                  : '未查询';
          return [
            e.file.name,
            fileFormatLabel(e.file),
            ALGORITHMS.find((a) => a.id === e.algorithm)?.label ?? '',
            e.hash ?? '',
            e.file.path,
            vt,
            vtThreatValue(report),
          ];
        }),
      ]
        .map((row) => row.map(cell).join('\t'))
        .join('\n');
  }
}
