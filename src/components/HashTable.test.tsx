import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HashTable } from './HashTable';
import type { FileRow } from '../types';

const file: FileRow = {
  path: '/files/one.bin',
  name: 'one.bin',
  size: 3,
  status: 'complete',
  hashes: { md5: 'a'.repeat(32) },
  checks: [],
  error: null,
};
it('paginates large queues instead of rendering every file at once', async () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({
    ...file,
    path: `/files/file-${i}.bin`,
    name: `file-${i}.bin`,
  }));
  const user = userEvent.setup();
  render(<HashTable rows={rows} select={vi.fn()} copy={vi.fn()} busy={false} />);
  expect(screen.getAllByRole('row').length).toBeLessThanOrEqual(101);
  expect(screen.queryByText('file-100.bin')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByText('file-100.bin')).toBeInTheDocument();
  expect(screen.queryByText('file-0.bin')).not.toBeInTheDocument();
});
it('copies a raw hash or checksum line on double click and supports keyboard selection', async () => {
  const select = vi.fn();
  const copy = vi.fn();
  const user = userEvent.setup();
  render(<HashTable rows={[file]} select={select} copy={copy} busy={false} />);
  await user.dblClick(screen.getByText(file.hashes.md5!));
  expect(copy).toHaveBeenLastCalledWith(file.hashes.md5);
  await user.dblClick(screen.getByText(file.name));
  expect(copy).toHaveBeenLastCalledWith(`${file.hashes.md5} *one.bin`);
  screen.getAllByRole('row')[1].focus();
  await user.keyboard('{Enter}');
  expect(select).toHaveBeenLastCalledWith(file.path, 'md5');
});
