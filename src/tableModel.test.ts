import { expect, it } from 'vitest';
import { copyEntries, hashEntries, vtTargets } from './tableModel';
import type { FileRow } from './types';
const file: FileRow = {
  path: '/files/a.txt',
  name: 'a.txt',
  size: 1,
  status: 'complete',
  fileFormat: 'UTF-8 文本',
  error: null,
  checks: [],
  hashes: { md5: 'a'.repeat(32), sha256: 'b'.repeat(64) },
};
it('deduplicates selected algorithms by file and prefers SHA-256 for VT', () => {
  const entries = hashEntries([file]);
  expect(entries).toHaveLength(2);
  expect(vtTargets(entries)).toEqual([
    { path: file.path, name: file.name, hash: file.hashes.sha256 },
  ]);
  expect(copyEntries(entries, 'paths')).toBe(file.path);
  expect(copyEntries(entries, 'vt-links')).toBe(
    `https://www.virustotal.com/gui/file/${file.hashes.sha256}`,
  );
});
it('quotes special filenames in table and verification-line copies', () => {
  const entries = hashEntries([{ ...file, name: 'a\t"b\nc', hashes: { md5: file.hashes.md5 } }]);
  expect(copyEntries(entries, 'table')).toBe(
    `文件名\t文件格式\t算法\t哈希值\t文件路径\tVirusTotal\tVT 威胁类型\n"a\t""b\nc"\tUTF-8 文本\tMD5\t${file.hashes.md5}\t${file.path}\t未查询\t`,
  );
  expect(copyEntries(entries, 'checksums')).toBe(
    `"a\t""b\nc"\tUTF-8 文本\t${file.hashes.md5}\t0\\0`,
  );
});
it('copies the content format and file VT result for every selected algorithm row', () => {
  const entries = hashEntries([
    file,
    { ...file, path: '/files/README', name: 'README', hashes: { md5: 'c'.repeat(32) } },
  ]);
  const vtResults = {
    [file.hashes.sha256!]: {
      report: {
        hash: file.hashes.sha256!,
        status: 'found' as const,
        malicious: 2,
        suspicious: 1,
        total: 70,
        lastAnalysisDate: null,
        threatLabel: null,
        threatCategories: [],
      },
    },
  };
  expect(copyEntries(entries, 'checksums', vtResults)).toBe(
    [
      `a.txt\tUTF-8 文本\t${file.hashes.sha256}\t2\\70`,
      `a.txt\tUTF-8 文本\t${file.hashes.md5}\t2\\70`,
      `README\tUTF-8 文本\t${'c'.repeat(32)}\t0\\0`,
    ].join('\n'),
  );
});
it('uses literal 0-backslash-0 for missing VT statistics and uses the detected format instead of the filename extension', () => {
  const entries = hashEntries([{ ...file, name: 'SAMPLE.EXE', hashes: { md5: file.hashes.md5 } }]);
  for (const status of ['not-found', 'pending'] as const) {
    expect(
      copyEntries(entries, 'checksums', {
        [file.hashes.md5!]: {
          report: {
            hash: file.hashes.md5!,
            status,
            malicious: 0,
            suspicious: 0,
            total: 0,
            lastAnalysisDate: null,
            threatLabel: null,
            threatCategories: [],
          },
        },
      }),
    ).toBe(`SAMPLE.EXE\tUTF-8 文本\t${file.hashes.md5}\t0\\0`);
  }
});

it('uses content detection for copy columns and never falls back to a misleading extension', () => {
  const renamed = hashEntries([
    { ...file, name: 'payload.txt', fileFormat: 'PE32+ DLL', hashes: { md5: file.hashes.md5 } },
  ]);
  expect(copyEntries(renamed, 'checksums')).toBe(
    `payload.txt\tPE32+ DLL\t${file.hashes.md5}\t0\\0`,
  );
  expect(copyEntries(renamed, 'table')).toContain('payload.txt\tPE32+ DLL\tMD5\t');
  const unknown = hashEntries([
    { ...file, name: 'image.png', fileFormat: null, hashes: { md5: file.hashes.md5 } },
  ]);
  expect(copyEntries(unknown, 'checksums')).toBe(`image.png\t未知格式\t${file.hashes.md5}\t0\\0`);
});
