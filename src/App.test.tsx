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
  await user.click(screen.getByRole('button', { name: '复制 SHA-256' }));
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
