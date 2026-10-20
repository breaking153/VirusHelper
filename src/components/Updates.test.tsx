import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { Updates } from './Updates';
import { updater } from '../updater';

vi.mock('../updater', () => ({
  updater: { available: true, check: vi.fn(), relaunch: vi.fn() },
}));

const downloadAndInstall = vi.fn();
const close = vi.fn();
const update = { version: '0.2.0', body: '修复与改进', downloadAndInstall, close };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(updater.check).mockResolvedValue(null);
  vi.mocked(updater.relaunch).mockResolvedValue();
  downloadAndInstall.mockResolvedValue(undefined);
  close.mockResolvedValue(undefined);
});

it('automatically checks on launch without installing and can manually check again', async () => {
  const user = userEvent.setup();
  render(<Updates options busy={false} onBusyChange={vi.fn()} />);
  expect(await screen.findByText(/已是最新版本/)).toBeInTheDocument();
  expect(updater.check).toHaveBeenCalledTimes(1);
  expect(downloadAndInstall).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '检查更新' }));
  await waitFor(() => expect(updater.check).toHaveBeenCalledTimes(2));
});

it('offers an update, blocks installation during hashing, then installs and relaunches', async () => {
  vi.mocked(updater.check).mockResolvedValue(update);
  const changed = vi.fn();
  const user = userEvent.setup();
  const view = render(<Updates options={false} busy onBusyChange={changed} />);
  expect(await screen.findByRole('button', { name: '更新并重启' })).toBeDisabled();
  expect(downloadAndInstall).not.toHaveBeenCalled();
  view.rerender(<Updates options={false} busy={false} onBusyChange={changed} />);
  await user.click(screen.getByRole('button', { name: '更新并重启' }));
  await waitFor(() => expect(updater.relaunch).toHaveBeenCalledTimes(1));
  expect(downloadAndInstall).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledWith(true);
});

it('preserves the old application on download or signature failure and allows retry', async () => {
  vi.mocked(updater.check).mockResolvedValue(update);
  downloadAndInstall.mockRejectedValueOnce(new Error('签名验证失败'));
  const changed = vi.fn();
  const user = userEvent.setup();
  render(<Updates options busy={false} onBusyChange={changed} />);
  await user.click(await screen.findByRole('button', { name: '更新并重启' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('签名验证失败');
  expect(updater.relaunch).not.toHaveBeenCalled();
  expect(changed).toHaveBeenLastCalledWith(false);
  await user.click(screen.getByRole('button', { name: '更新并重启' }));
  await waitFor(() => expect(updater.relaunch).toHaveBeenCalledTimes(1));
});

it('keeps automatic network failures out of the main view and offers retry in options', async () => {
  vi.mocked(updater.check).mockRejectedValue(new Error('网络不可用'));
  const view = render(<Updates options={false} busy={false} onBusyChange={vi.fn()} />);
  await waitFor(() => expect(updater.check).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  view.rerender(<Updates options busy={false} onBusyChange={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('网络不可用');
  expect(screen.getByRole('button', { name: '检查更新' })).toBeEnabled();
});

it('disposes stale updater handles after a StrictMode cleanup', async () => {
  let finishFirst!: (value: typeof update) => void;
  vi.mocked(updater.check).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
  );
  vi.mocked(updater.check).mockResolvedValue(update);
  render(
    <StrictMode>
      <Updates options busy={false} onBusyChange={vi.fn()} />
    </StrictMode>,
  );
  await screen.findByRole('button', { name: '更新并重启' });
  await act(async () => {
    finishFirst(update);
  });
  expect(close).toHaveBeenCalledTimes(1);
});
