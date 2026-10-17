import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { native } from './native';
import type { FileResult, JobEvent, JobRequest, JobSummary } from './types';

vi.mock('./native', () => ({
  native: {
    available: true,
    pickFiles: vi.fn(),
    pickFolder: vi.fn(),
    pickManifest: vi.fn(),
    run: vi.fn(),
    cancel: vi.fn(),
    clear: vi.fn(),
    export: vi.fn(),
    copy: vi.fn(),
    listenDrop: vi.fn(),
    vtSettings: vi.fn(),
    configureVt: vi.fn(),
    lookupVt: vi.fn(),
    openVtPage: vi.fn(),
  },
}));

const file: FileResult = {
  path: 'C:/fixtures/abc.txt',
  name: 'abc.txt',
  size: 3,
  status: 'complete',
  error: null,
  checks: [],
  hashes: {
    md5: '900150983cd24fb0d6963f7d28e17f72',
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  },
};
const done: JobSummary = {
  total: 1,
  completed: 1,
  errors: 0,
  matched: 0,
  mismatched: 0,
  cancelled: false,
  elapsedMs: 3,
  results: [file],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(native.pickFiles).mockResolvedValue([file.path]);
  vi.mocked(native.clear).mockResolvedValue();
  vi.mocked(native.vtSettings).mockResolvedValue({ configured: false });
  vi.mocked(native.configureVt).mockResolvedValue({ configured: true });
  vi.mocked(native.openVtPage).mockResolvedValue();
  vi.mocked(native.listenDrop).mockResolvedValue(() => {});
  vi.mocked(native.run).mockImplementation(
    async (_request: JobRequest, receive: (e: JobEvent) => void) => {
      receive({ type: 'discovered', files: [file], totalBytes: 3 });
      receive({ type: 'file', result: file });
      return done;
    },
  );
});

it('calculates selected files, compares pasted hashes and copies a computed hash', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await user.click(screen.getByRole('button', { name: '开始计算' }));
  expect(await screen.findByText(file.hashes.sha256!)).toBeInTheDocument();
  await user.type(screen.getByRole('textbox', { name: '预期哈希' }), '0'.repeat(32));
  expect(screen.getByText('未找到匹配的哈希')).toBeInTheDocument();
  await user.clear(screen.getByRole('textbox', { name: '预期哈希' }));
  await user.type(
    screen.getByRole('textbox', { name: '预期哈希' }),
    '900150983CD24FB0D6963F7D28E17F72',
  );
  expect(screen.getByText('哈希一致')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '复制哈希' }));
  expect(native.copy).toHaveBeenCalledWith(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

it('shows native errors and allows the user to retry', async () => {
  vi.mocked(native.run).mockRejectedValueOnce('读取文件失败：访问被拒绝');
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await user.click(screen.getByRole('button', { name: '开始计算' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('访问被拒绝');
  expect(screen.getByRole('button', { name: '开始计算' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: '开始计算' }));
  expect(await screen.findByText(file.hashes.sha256!)).toBeInTheDocument();
});

it('cancels an active task and shows its final cancelled state', async () => {
  let finish: (s: JobSummary) => void = () => {};
  vi.mocked(native.run).mockImplementation((_request, receive) => {
    receive({ type: 'discovered', files: [file], totalBytes: 3 });
    return new Promise<JobSummary>((resolve) => {
      finish = resolve;
    });
  });
  vi.mocked(native.cancel).mockImplementation(async () => {
    finish({
      ...done,
      cancelled: true,
      completed: 0,
      results: [{ ...file, hashes: {}, status: 'cancelled' }],
    });
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await user.click(screen.getByRole('button', { name: '开始计算' }));
  expect(screen.getByRole('button', { name: '添加文件' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '取消计算' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '重新计算' })).toBeEnabled());
  expect(screen.getAllByText('已取消').length).toBeGreaterThan(0);
});

it('exports the available algorithm when SHA-256 was not selected', async () => {
  const md5File: FileResult = { ...file, hashes: { md5: file.hashes.md5 } };
  vi.mocked(native.run).mockResolvedValue({ ...done, results: [md5File] });
  vi.mocked(native.export).mockResolvedValue('C:/fixtures/checksums.md5');
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '选项' }));
  await user.click(screen.getByRole('checkbox', { name: /SHA-256/ }));
  await user.click(screen.getByRole('checkbox', { name: /BLAKE3/ }));
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await user.click(screen.getByRole('button', { name: '开始计算' }));
  await screen.findByText(file.hashes.md5!);
  expect(screen.getByRole('combobox', { name: '导出算法' })).toHaveValue('md5');
  await user.click(screen.getByRole('button', { name: '导出清单' }));
  expect(native.export).toHaveBeenCalledWith('md5');
  expect(await screen.findByText(/校验清单已保存/)).toBeInTheDocument();
});

it('keeps the API key in the native session, clears the input, and queries only the selected hash', async () => {
  vi.mocked(native.lookupVt).mockResolvedValue({
    hash: file.hashes.sha256!,
    status: 'found',
    malicious: 3,
    suspicious: 1,
    total: 70,
    lastAnalysisDate: 1720000000,
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await user.click(screen.getByRole('button', { name: '开始计算' }));
  await screen.findByText(file.hashes.sha256!);
  expect(native.lookupVt).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'API 查询' }));
  const input = screen.getByLabelText('VT API Key');
  await user.type(input, 'test-key-for-session');
  await user.click(screen.getByRole('button', { name: '保存 Key' }));
  await waitFor(() => expect(input).toHaveValue(''));
  expect(native.configureVt).toHaveBeenCalledWith('test-key-for-session');
  expect(JSON.stringify(localStorage)).not.toContain('test-key-for-session');
  await user.click(screen.getByRole('button', { name: 'API 查询' }));
  expect(await screen.findByText(/检出 3 \/ 70/)).toBeInTheDocument();
  expect(native.lookupVt).toHaveBeenCalledWith(file.hashes.sha256);
  await user.click(screen.getByRole('button', { name: '免费网页检验' }));
  expect(native.openVtPage).toHaveBeenCalledWith('report', file.hashes.sha256);
});

it('distinguishes an absent report from quota errors and hides reports for another selected file', async () => {
  const other = {
    ...file,
    path: 'C:/fixtures/other.txt',
    name: 'other.txt',
    hashes: { sha256: 'f'.repeat(64) },
  };
  vi.mocked(native.vtSettings).mockResolvedValue({ configured: true });
  vi.mocked(native.run).mockResolvedValue({
    ...done,
    total: 2,
    completed: 2,
    results: [file, other],
  });
  vi.mocked(native.lookupVt)
    .mockResolvedValueOnce({
      hash: file.hashes.sha256!,
      status: 'not-found',
      malicious: 0,
      suspicious: 0,
      total: 0,
      lastAnalysisDate: null,
    })
    .mockRejectedValueOnce({
      code: 'rate-limited',
      message: 'VT 请求额度已用尽',
      retryAfterSeconds: 30,
    });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await user.click(screen.getByRole('button', { name: '开始计算' }));
  await screen.findByText(other.hashes.sha256);
  await user.click(screen.getByRole('button', { name: 'API 查询' }));
  expect(await screen.findByText(/VT 未收录/)).toBeInTheDocument();
  await user.click(screen.getByText('other.txt'));
  expect(screen.queryByText(/VT 未收录/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'API 查询' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('VT 请求额度已用尽');
  expect(screen.getByRole('alert')).toHaveTextContent('30 秒');
});

it('keeps imported expectations when adding more input files', async () => {
  const target = {
    path: file.path,
    root: 'C:/fixtures',
    algorithm: 'md5' as const,
    hash: '0'.repeat(32),
  };
  vi.mocked(native.pickManifest).mockResolvedValue({
    path: 'C:/fixtures/checksums.md5',
    targets: [target],
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '导入清单' }));
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await user.click(screen.getByRole('button', { name: '开始计算' }));
  await screen.findByText(file.hashes.md5!);
  expect(native.run).toHaveBeenCalledWith(
    expect.objectContaining({ checksums: [target] }),
    expect.any(Function),
  );
});
