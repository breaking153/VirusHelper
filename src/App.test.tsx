import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import App from './App';
import { native } from './native';
import type { Algorithm, FileResult, JobEvent, JobRequest, JobSummary } from './types';

vi.mock('./native', () => ({
  native: {
    available: true,
    startupPaths: vi.fn(),
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
    configureVtProxy: vi.fn(),
    testVtConnection: vi.fn(),
    lookupVt: vi.fn(),
    openVtPage: vi.fn(),
  },
}));

const file: FileResult = {
  path: 'C:/fixtures/abc.txt',
  name: 'abc.txt',
  size: 3,
  status: 'complete',
  fileFormat: 'UTF-8 文本',
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
  vi.mocked(native.startupPaths).mockResolvedValue([]);
  vi.mocked(native.pickFiles).mockResolvedValue([file.path]);
  vi.mocked(native.clear).mockResolvedValue();
  vi.mocked(native.vtSettings).mockResolvedValue({ configured: false, proxy: null });
  vi.mocked(native.configureVt).mockResolvedValue({ configured: true, proxy: null });
  vi.mocked(native.openVtPage).mockResolvedValue();
  vi.mocked(native.listenDrop).mockResolvedValue(() => {});
  vi.mocked(native.run).mockImplementation(
    async (request: JobRequest, receive: (e: JobEvent) => void) => {
      const computed: FileResult = {
        ...file,
        hashes: Object.fromEntries(
          Object.entries(file.hashes).filter(
            ([id]) =>
              request.algorithms.includes(id as Algorithm) ||
              request.checksums.some((target) => target.algorithm === id),
          ),
        ),
      };
      receive({ type: 'discovered', files: [computed], totalBytes: 3 });
      receive({ type: 'file', result: computed });
      return { ...done, results: [computed] };
    },
  );
});

it('loads shell-selected paths and calculates MD5 once under StrictMode', async () => {
  vi.mocked(native.startupPaths).mockResolvedValue([file.path]);
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  expect(await screen.findByText(file.hashes.md5!)).toBeInTheDocument();
  expect(native.run).toHaveBeenCalledTimes(1);
  expect(native.run).toHaveBeenCalledWith(
    expect.objectContaining({ paths: [file.path], algorithms: ['md5'] }),
    expect.any(Function),
  );
});

it('shows startup path errors and still permits manual file selection', async () => {
  vi.mocked(native.startupPaths).mockRejectedValue('无法读取启动文件');
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('无法读取启动文件');
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  expect(await screen.findByText(file.hashes.md5!)).toBeInTheDocument();
});

it('automatically calculates MD5 for selected files, compares pasted hashes and copies the result', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  expect(await screen.findByText(file.hashes.md5!)).toBeInTheDocument();
  expect(screen.queryByText(file.hashes.sha256!)).not.toBeInTheDocument();
  await user.type(screen.getByRole('textbox', { name: '预期哈希' }), '0'.repeat(32));
  expect(screen.getByText('未找到匹配的哈希')).toBeInTheDocument();
  await user.clear(screen.getByRole('textbox', { name: '预期哈希' }));
  await user.type(
    screen.getByRole('textbox', { name: '预期哈希' }),
    '900150983CD24FB0D6963F7D28E17F72',
  );
  expect(screen.getByText('哈希一致')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '复制哈希' }));
  expect(native.copy).toHaveBeenCalledWith('900150983cd24fb0d6963f7d28e17f72');
  const feedback = await screen.findByText('已复制到剪贴板');
  expect(feedback).toHaveClass('copy-toast');
  expect(feedback.closest('.message')).toBeNull();
});

it('shows native errors and allows the user to retry', async () => {
  vi.mocked(native.run).mockRejectedValueOnce('读取文件失败：访问被拒绝');
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('访问被拒绝');
  expect(screen.getByRole('button', { name: '重新计算' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: '重新计算' }));
  expect(await screen.findByText(file.hashes.md5!)).toBeInTheDocument();
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
  await screen.findByRole('button', { name: '取消计算' });
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
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await screen.findByText(file.hashes.md5!);
  expect(screen.getByRole('combobox', { name: '导出算法' })).toHaveValue('md5');
  await user.click(screen.getByRole('button', { name: '导出清单' }));
  expect(native.export).toHaveBeenCalledWith('md5');
  expect(await screen.findByText(/校验清单已保存/)).toBeInTheDocument();
});

it('saves the API key through the native bridge, clears the input, and queries only the selected hash', async () => {
  vi.mocked(native.lookupVt).mockResolvedValue({
    hash: file.hashes.md5!,
    status: 'found',
    malicious: 3,
    suspicious: 1,
    total: 70,
    lastAnalysisDate: 1720000000,
    threatLabel: null,
    threatCategories: [],
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await screen.findByText(file.hashes.md5!);
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
  expect(native.lookupVt).toHaveBeenCalledWith(file.hashes.md5);
  await user.click(screen.getByRole('button', { name: '免费网页检验' }));
  expect(native.openVtPage).toHaveBeenCalledWith('report', file.hashes.md5);
});

it('automatically uses a saved key on startup and clears the saved credential on request', async () => {
  vi.mocked(native.vtSettings).mockResolvedValue({ configured: true, proxy: null });
  vi.mocked(native.configureVt).mockResolvedValue({ configured: false, proxy: null });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '选项' }));
  expect(await screen.findByText(/Key 已保存/)).toBeInTheDocument();
  expect(screen.getByLabelText('VT API Key')).toHaveValue('');
  await user.click(screen.getByRole('button', { name: '清除 Key' }));
  expect(await screen.findByText(/Key 未设置/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '清除 Key' })).toBeDisabled();
});

it('shows storage failures without claiming that the key was saved', async () => {
  vi.mocked(native.configureVt).mockRejectedValue({
    code: 'credential-store',
    message: '无法保存系统凭据',
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '选项' }));
  await user.type(screen.getByLabelText('VT API Key'), 'test-key-for-storage');
  await user.click(screen.getByRole('button', { name: '保存 Key' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('无法保存系统凭据');
  expect(screen.getByLabelText('VT API Key')).toHaveValue('');
  expect(screen.queryByText(/Key 已保存/)).not.toBeInTheDocument();
});

it('prevents editing credentials until startup restoration has completed', async () => {
  let finish: (settings: { configured: boolean; proxy: string | null }) => void = () => {};
  vi.mocked(native.vtSettings).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '选项' }));
  expect(screen.getByLabelText('VT API Key')).toBeDisabled();
  finish({ configured: true, proxy: null });
  await waitFor(() => expect(screen.getByLabelText('VT API Key')).toBeEnabled());
  expect(screen.getByText(/Key 已保存/)).toBeInTheDocument();
});

it('allows retrying automatic restoration after the credential store is unlocked', async () => {
  vi.mocked(native.vtSettings)
    .mockRejectedValueOnce({ code: 'credential-store', message: '系统凭据存储已锁定' })
    .mockResolvedValueOnce({ configured: true, proxy: null });
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('系统凭据存储已锁定');
  await user.click(screen.getByRole('button', { name: '重新加载' }));
  await user.click(screen.getByRole('button', { name: '选项' }));
  expect(await screen.findByText(/Key 已保存/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('distinguishes an absent report from quota errors and hides reports for another selected file', async () => {
  const other = {
    ...file,
    path: 'C:/fixtures/other.txt',
    name: 'other.txt',
    hashes: { sha256: 'f'.repeat(64) },
  };
  vi.mocked(native.vtSettings).mockResolvedValue({ configured: true, proxy: null });
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
      threatLabel: null,
      threatCategories: [],
    })
    .mockRejectedValueOnce({
      code: 'rate-limited',
      message: 'VT 请求额度已用尽',
      retryAfterSeconds: 30,
    });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
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
  await screen.findByText(file.hashes.md5!);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await screen.findByText(file.hashes.md5!);
  expect(native.run).toHaveBeenCalledWith(
    expect.objectContaining({ checksums: [target] }),
    expect.any(Function),
  );
});

it('automatically recomputes when the selected algorithms change without extra runs for theme changes', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await screen.findByText(file.hashes.md5!);
  expect(native.run).toHaveBeenLastCalledWith(
    expect.objectContaining({ algorithms: ['md5'] }),
    expect.any(Function),
  );
  await user.click(screen.getByRole('button', { name: '选项' }));
  await user.click(screen.getByRole('checkbox', { name: 'MD5' }));
  await user.click(screen.getByRole('checkbox', { name: 'SHA-256' }));
  expect(await screen.findByText(file.hashes.sha256!)).toBeInTheDocument();
  expect(screen.queryByText(file.hashes.md5!)).not.toBeInTheDocument();
  await waitFor(() =>
    expect(native.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ algorithms: ['sha256'] }),
      expect.any(Function),
    ),
  );
  const count = vi.mocked(native.run).mock.calls.length;
  await user.selectOptions(screen.getByLabelText('主题'), 'dark');
  expect(native.run).toHaveBeenCalledTimes(count);
});

it('allows changing algorithms during computation and restarts only the latest selection', async () => {
  let finish: (summary: JobSummary) => void = () => {};
  let acknowledge: () => void = () => {};
  vi.mocked(native.run).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.mocked(native.cancel).mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = () => {
          finish({ ...done, cancelled: true, completed: 0, results: [] });
          resolve();
        };
      }),
  );
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await screen.findByRole('button', { name: '取消计算' });
  await user.click(screen.getByRole('button', { name: '选项' }));
  expect(screen.getByRole('checkbox', { name: 'SHA-256' })).toBeEnabled();
  await user.click(screen.getByRole('checkbox', { name: 'SHA-256' }));
  await user.click(screen.getByRole('checkbox', { name: 'MD5' }));
  expect(native.cancel).toHaveBeenCalledTimes(1);
  await act(async () => {
    acknowledge();
  });
  expect(await screen.findByText(file.hashes.sha256!)).toBeInTheDocument();
  expect(screen.queryByText(file.hashes.md5!)).not.toBeInTheDocument();
  expect(native.run).toHaveBeenCalledTimes(2);
  expect(native.run).toHaveBeenLastCalledWith(
    expect.objectContaining({ algorithms: ['sha256'] }),
    expect.any(Function),
  );
});

it('copies multiple table rows and queries each selected file only once', async () => {
  const other: FileResult = {
    ...file,
    path: 'C:/fixtures/second.txt',
    name: 'second.txt',
    hashes: { md5: 'e'.repeat(32) },
  };
  vi.mocked(native.run).mockResolvedValue({
    ...done,
    total: 2,
    completed: 2,
    results: [file, other],
  });
  vi.mocked(native.vtSettings).mockResolvedValue({ configured: true, proxy: null });
  vi.mocked(native.lookupVt).mockImplementation(async (hash) => ({
    hash,
    status: 'found',
    malicious: 0,
    suspicious: 0,
    total: 70,
    lastAnalysisDate: null,
    threatLabel: null,
    threatCategories: [],
  }));
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await screen.findByText(other.hashes.md5!);
  await user.click(screen.getByRole('checkbox', { name: '选择全部 3 行' }));
  await user.click(screen.getByRole('button', { name: '复制哈希' }));
  expect(vi.mocked(native.copy).mock.lastCall?.[0].split('\n')).toHaveLength(3);
  await user.click(screen.getByRole('button', { name: '复制表格' }));
  expect(vi.mocked(native.copy).mock.lastCall?.[0]).toContain(
    '文件名\t文件格式\t算法\t哈希值\t文件路径',
  );
  expect(vi.mocked(native.copy).mock.lastCall?.[0]).toContain('second.txt\tUTF-8 文本\tMD5');
  await user.click(screen.getByRole('button', { name: 'API 查询（2）' }));
  await waitFor(() => expect(native.lookupVt).toHaveBeenCalledTimes(2));
  expect(vi.mocked(native.lookupVt).mock.calls.map(([hash]) => hash)).toEqual([
    file.hashes.sha256,
    other.hashes.md5,
  ]);
  expect(screen.getAllByText('0 / 70')).toHaveLength(3);
});

it('excludes files without supported VT digests from a multirow web action', async () => {
  const other: FileResult = {
    ...file,
    path: 'C:/fixtures/only-blake3.txt',
    name: 'only-blake3.txt',
    hashes: { blake3: 'f'.repeat(64) },
  };
  vi.mocked(native.run).mockResolvedValue({
    ...done,
    total: 2,
    completed: 2,
    results: [file, other],
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await screen.findByText(other.hashes.blake3!);
  await user.click(screen.getByRole('checkbox', { name: '选择全部 3 行' }));
  await user.click(screen.getByRole('button', { name: '免费网页检验' }));
  expect(native.openVtPage).toHaveBeenCalledExactlyOnceWith('report', file.hashes.sha256);
});

it('copies verification lines with Command+C outside editable fields and preserves text-input copy', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await screen.findByText(file.hashes.md5!);
  screen.getByRole('button', { name: '重新计算' }).focus();
  await user.keyboard('{Meta>}c{/Meta}');
  expect(native.copy).toHaveBeenLastCalledWith(`abc.txt\tUTF-8 文本\t${file.hashes.md5}\t0\\0`);
  const count = vi.mocked(native.copy).mock.calls.length;
  await user.click(screen.getByRole('textbox', { name: '预期哈希' }));
  await user.type(screen.getByRole('textbox', { name: '预期哈希' }), 'abc');
  await user.keyboard('{Meta>}c{/Meta}');
  expect(native.copy).toHaveBeenCalledTimes(count);
});

it('restores the saved proxy and tests it without querying hashes or submitting a key', async () => {
  vi.mocked(native.vtSettings).mockResolvedValue({
    configured: true,
    proxy: 'socks5h://127.0.0.1:8890',
  });
  vi.mocked(native.testVtConnection).mockResolvedValue('已连接到 VT（HTTP 302，未校验 API Key）');
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '选项' }));
  await waitFor(() =>
    expect(screen.getByLabelText('VT 代理')).toHaveValue('socks5h://127.0.0.1:8890'),
  );
  await user.click(screen.getByRole('button', { name: '测试连接' }));
  expect(await screen.findByText('已连接到 VT（HTTP 302，未校验 API Key）')).toBeInTheDocument();
  expect(native.testVtConnection).toHaveBeenCalledTimes(1);
  expect(native.lookupVt).not.toHaveBeenCalled();
  expect(native.configureVt).not.toHaveBeenCalled();
});

it('saves an HTTP proxy and can return to direct mode without changing the key', async () => {
  vi.mocked(native.vtSettings).mockResolvedValue({ configured: true, proxy: null });
  vi.mocked(native.configureVtProxy)
    .mockResolvedValueOnce({ configured: true, proxy: 'http://127.0.0.1:8080/' })
    .mockResolvedValueOnce({ configured: true, proxy: null });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '选项' }));
  await waitFor(() => expect(screen.getByLabelText('VT 代理')).toBeEnabled());
  await user.type(screen.getByLabelText('VT 代理'), 'http://127.0.0.1:8080');
  expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '保存代理' }));
  expect(native.configureVtProxy).toHaveBeenLastCalledWith('http://127.0.0.1:8080');
  await waitFor(() =>
    expect(screen.getByLabelText('VT 代理')).toHaveValue('http://127.0.0.1:8080/'),
  );
  await user.click(screen.getByRole('button', { name: '直连' }));
  expect(native.configureVtProxy).toHaveBeenLastCalledWith('');
  expect(await screen.findByText('已切换为直连')).toBeInTheDocument();
  expect(native.configureVt).not.toHaveBeenCalled();
});

it('shows a proxy save failure without claiming that the edited address was saved', async () => {
  vi.mocked(native.vtSettings).mockResolvedValue({ configured: true, proxy: null });
  vi.mocked(native.configureVtProxy).mockRejectedValue({
    code: 'invalid-proxy',
    message: '代理地址无效',
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '选项' }));
  await waitFor(() => expect(screen.getByLabelText('VT 代理')).toBeEnabled());
  await user.type(screen.getByLabelText('VT 代理'), 'bad://localhost');
  await user.click(screen.getByRole('button', { name: '保存代理' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('代理地址无效');
  expect(screen.queryByText('VT 代理已保存')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
});

it('uses filtered visual order for global Command+C and excludes hidden selected rows', async () => {
  const rows = [10, 2, 1].map((value) => ({
    ...file,
    name: `sample${value}.bin`,
    path: `/files/sample${value}.bin`,
    fileFormat: value === 1 ? 'UTF-8 文本' : 'PE32 EXE',
    hashes: { md5: value.toString(16).repeat(32) },
  }));
  vi.mocked(native.pickFiles).mockResolvedValue(rows.map((row) => row.path));
  vi.mocked(native.run).mockImplementation(async (_request, receive) => {
    receive({ type: 'discovered', files: rows, totalBytes: 9 });
    for (const row of rows) receive({ type: 'file', result: row });
    return { ...done, results: rows, total: 3, completed: 3 };
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '添加文件' }));
  await screen.findByText('sample10.bin');
  await user.click(screen.getByRole('button', { name: '全选' }));
  await user.click(screen.getByRole('button', { name: '按文件名排序' }));
  screen.getByRole('button', { name: '重新计算' }).focus();
  await user.keyboard('{Meta>}c{/Meta}');
  expect(native.copy).toHaveBeenLastCalledWith(
    [rows[2], rows[1], rows[0]]
      .map((row) => `${row.name}\t${row.fileFormat}\t${row.hashes.md5}\t0\\0`)
      .join('\n'),
  );
  await user.click(screen.getByRole('button', { name: '筛选文件格式' }));
  await user.type(screen.getByRole('searchbox', { name: '搜索文件格式的值' }), 'pe32');
  await user.click(screen.getByRole('button', { name: '确定' }));
  screen.getByRole('button', { name: '重新计算' }).focus();
  await user.keyboard('{Meta>}c{/Meta}');
  expect(native.copy).toHaveBeenLastCalledWith(
    [rows[1], rows[0]]
      .map((row) => `${row.name}\t${row.fileFormat}\t${row.hashes.md5}\t0\\0`)
      .join('\n'),
  );
});
