export type Algorithm =
  'md5' | 'sha1' | 'sha256' | 'sha512' | 'sha3-256' | 'blake3' | 'crc32' | 'xxh64';

export const ALGORITHMS: { id: Algorithm; label: string; group: string; note?: string }[] = [
  { id: 'sha256', label: 'SHA-256', group: '推荐', note: '通用校验' },
  { id: 'blake3', label: 'BLAKE3', group: '推荐', note: '高速计算' },
  { id: 'sha512', label: 'SHA-512', group: '密码学哈希' },
  { id: 'sha3-256', label: 'SHA3-256', group: '密码学哈希' },
  { id: 'md5', label: 'MD5', group: '兼容与快速校验' },
  { id: 'sha1', label: 'SHA-1', group: '兼容与快速校验' },
  { id: 'crc32', label: 'CRC32', group: '兼容与快速校验' },
  { id: 'xxh64', label: 'xxHash64', group: '兼容与快速校验' },
];

export const algorithmLabel = (id: Algorithm) => ALGORITHMS.find((a) => a.id === id)?.label ?? id;

export interface ChecksumTarget {
  path: string;
  root: string;
  algorithm: Algorithm;
  hash: string;
}
export interface ManifestSelection {
  path: string;
  targets: ChecksumTarget[];
}
export interface JobRequest {
  paths: string[];
  algorithms: Algorithm[];
  checksums: ChecksumTarget[];
}
export interface DiscoveredFile {
  path: string;
  name: string;
  size: number;
  error: string | null;
}
export interface HashCheck {
  algorithm: Algorithm;
  expected: string;
  actual: string;
  matches: boolean;
}
export interface FileResult extends DiscoveredFile {
  status: 'complete' | 'error' | 'cancelled';
  hashes: Partial<Record<Algorithm, string>>;
  checks: HashCheck[];
}
export interface FileRow extends Omit<FileResult, 'status'> {
  status: FileResult['status'] | 'pending';
}
export interface Progress {
  path: string;
  bytesProcessed: number;
  fileBytes: number;
  totalBytes: number;
  index: number;
  total: number;
}
export type JobEvent =
  | { type: 'discovered'; files: DiscoveredFile[]; totalBytes: number }
  | ({ type: 'progress' } & Progress)
  | { type: 'file'; result: FileResult };
export interface JobSummary {
  total: number;
  completed: number;
  errors: number;
  matched: number;
  mismatched: number;
  cancelled: boolean;
  elapsedMs: number;
  results: FileResult[];
}
