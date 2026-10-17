import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileList } from './FileList';
import type { FileRow } from '../types';

it('paginates large queues instead of rendering every file at once', async () => {
  const rows: FileRow[] = Array.from({ length: 250 }, (_, i) => ({
    path: `/files/file-${i}.bin`,
    name: `file-${i}.bin`,
    size: 3,
    status: 'pending',
    hashes: {},
    checks: [],
    error: null,
  }));
  const user = userEvent.setup();
  render(
    <FileList
      rows={rows}
      selected={null}
      select={vi.fn()}
      busy={false}
      dragging={false}
      addFiles={vi.fn()}
      disabled={false}
    />,
  );
  expect(screen.getAllByRole('row').length).toBeLessThanOrEqual(101);
  expect(screen.queryByText('file-100.bin')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByText('file-100.bin')).toBeInTheDocument();
  expect(screen.queryByText('file-0.bin')).not.toBeInTheDocument();
});
