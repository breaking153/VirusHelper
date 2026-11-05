import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { HashTable } from './HashTable';
import { hashEntries, type HashEntry } from '../tableModel';
import type { FileRow } from '../types';
import type { VtResult } from '../useVirusTotal';
import { useTableView } from '../tableView';

const file: FileRow = {
  path: '/files/one.bin',
  name: 'one.bin',
  size: 3,
  status: 'complete',
  fileFormat: 'UTF-8 文本',
  hashes: { md5: 'a'.repeat(32) },
  checks: [],
  error: null,
};
const fixtures = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    ...file,
    path: `/files/file-${i}.bin`,
    name: `file-${i}.bin`,
  }));
function Harness({
  rows,
  copy = vi.fn(),
  select = vi.fn(),
  vt = vi.fn(),
  vtResults = {},
}: {
  rows: FileRow[];
  copy?: (s: string) => void;
  select?: (ids: string[]) => void;
  vt?: (action: 'web' | 'api', entries: HashEntry[]) => void;
  vtResults?: Record<string, VtResult>;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const entries = hashEntries(rows);
  const view = useTableView(entries, vtResults);
  return (
    <HashTable
      entries={view.entries}
      totalCount={entries.length}
      view={view}
      selectedIds={ids}
      select={(next) => {
        setIds(next);
        select(next);
      }}
      copy={copy}
      vt={vt}
      vtResults={vtResults}
      apiBusy={false}
      available
      busy={false}
    />
  );
}
it('paginates queues while select-all and selection persist across pages', async () => {
  const rows = fixtures(250);
  const select = vi.fn();
  const user = userEvent.setup();
  render(<Harness rows={rows} select={select} />);
  expect(screen.getAllByRole('row')).toHaveLength(101);
  expect(screen.queryByText('file-100.bin')).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: '选择全部 250 行' }));
  expect(select.mock.lastCall?.[0]).toHaveLength(250);
  await user.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByText('file-100.bin')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: '选择 file-100.bin MD5' })).toBeChecked();
});
it('copies single cells and supports keyboard selection', async () => {
  const select = vi.fn();
  const copy = vi.fn();
  const user = userEvent.setup();
  render(<Harness rows={[file]} select={select} copy={copy} />);
  for (const value of [file.name, 'UTF-8 文本', 'MD5', file.hashes.md5!, '已完成', '未查询']) {
    await user.dblClick(screen.getAllByText(value)[0]);
    expect(copy).toHaveBeenLastCalledWith(value);
  }
  screen.getAllByRole('row')[1].focus();
  await user.keyboard('{Enter}');
  expect(select).toHaveBeenLastCalledWith([hashEntries([file])[0].id]);
});
it('supports modifier, range, checkbox and keyboard multiselection', async () => {
  const rows = fixtures(4);
  const user = userEvent.setup();
  const copy = vi.fn();
  render(<Harness rows={rows} copy={copy} />);
  await user.click(screen.getByText('file-0.bin'));
  await user.keyboard('{Control>}');
  await user.click(screen.getByText('file-2.bin'));
  await user.keyboard('{/Control}');
  expect(
    screen.getAllByRole('row').filter((r) => r.getAttribute('aria-selected') === 'true'),
  ).toHaveLength(2);
  await user.keyboard('{Shift>}');
  await user.click(screen.getByText('file-3.bin'));
  await user.keyboard('{/Shift}');
  expect(screen.getByRole('checkbox', { name: '选择 file-0.bin MD5' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: '选择 file-2.bin MD5' })).toBeChecked();
  await user.click(screen.getByRole('checkbox', { name: '选择 file-0.bin MD5' }));
  expect(screen.getByRole('checkbox', { name: '选择 file-0.bin MD5' })).toBeChecked();
  screen.getAllByRole('row')[1].focus();
  await user.keyboard('{Control>}a{/Control}');
  await user.keyboard('{Control>}c{/Control}');
  expect(copy).toHaveBeenLastCalledWith(
    rows.map((row) => `${row.name}\tUTF-8 文本\t${file.hashes.md5}\t0\\0`).join('\n'),
  );
});
it('keeps the right-clicked selection for copying and VT, and retargets unselected rows', async () => {
  const rows = fixtures(3);
  const copy = vi.fn();
  const vt = vi.fn();
  const user = userEvent.setup();
  render(<Harness rows={rows} copy={copy} vt={vt} />);
  await user.click(screen.getByRole('checkbox', { name: '选择 file-0.bin MD5' }));
  await user.click(screen.getByRole('checkbox', { name: '选择 file-1.bin MD5' }));
  fireEvent.contextMenu(screen.getByText('file-0.bin'), { clientX: 100, clientY: 100 });
  await user.click(screen.getByRole('menuitem', { name: /复制为表格/ }));
  expect(copy.mock.lastCall?.[0]).toContain('file-0.bin\tUTF-8 文本\tMD5\t');
  expect(copy.mock.lastCall?.[0]).toContain('file-1.bin\tUTF-8 文本\tMD5\t');
  fireEvent.contextMenu(screen.getByText('file-1.bin'));
  await user.click(screen.getByRole('menuitem', { name: /VT API 查询/ }));
  expect(vt.mock.lastCall?.[1]).toHaveLength(2);
  fireEvent.contextMenu(screen.getByText('file-2.bin'));
  await user.click(screen.getByRole('menuitem', { name: '复制文件路径' }));
  expect(copy).toHaveBeenLastCalledWith(rows[2].path);
});

it('copies VT-aware verification lines with the context menu and Command+C', async () => {
  const copy = vi.fn();
  const user = userEvent.setup();
  render(
    <Harness
      rows={[file]}
      copy={copy}
      vtResults={{
        [file.hashes.md5!]: {
          state: 'complete',
          report: {
            hash: file.hashes.md5!,
            status: 'found',
            malicious: 3,
            suspicious: 1,
            total: 72,
            lastAnalysisDate: null,
            threatLabel: null,
            threatCategories: [],
          },
        },
      }}
    />,
  );
  fireEvent.contextMenu(screen.getByText(file.name));
  await user.click(screen.getByRole('menuitem', { name: /复制校验行/ }));
  expect(copy).toHaveBeenLastCalledWith(`one.bin\tUTF-8 文本\t${file.hashes.md5}\t3\\72`);
  screen.getAllByRole('row')[1].focus();
  await user.keyboard('{Meta>}c{/Meta}');
  expect(copy).toHaveBeenLastCalledWith(`one.bin\tUTF-8 文本\t${file.hashes.md5}\t3\\72`);
  await user.keyboard('{Meta>}{Shift>}c{/Shift}{/Meta}');
  expect(copy.mock.lastCall?.[0]).toContain('文件名\t文件格式\t算法\t哈希值\t文件路径');
});

it('shows detected content format as the second data column and shifts the remaining columns', () => {
  render(<Harness rows={[{ ...file, name: 'image.exe', fileFormat: 'PNG' }]} />);
  expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
    '',
    '文件名',
    '文件格式',
    '算法',
    '哈希值',
    '状态',
    'VirusTotal',
    'VT 威胁类型',
  ]);
  const cells = screen.getAllByRole('row')[1].querySelectorAll('td');
  expect(cells[1]).toHaveTextContent('image.exe');
  expect(cells[2]).toHaveTextContent('PNG');
  expect(cells[3]).toHaveTextContent('MD5');
  expect(cells[4]).toHaveTextContent(file.hashes.md5!);
});

it('cycles sort order and copies a shift-selected range in visual order', async () => {
  const rows = ['charlie.bin', 'alpha.bin', 'bravo.bin'].map((name) => ({
    ...file,
    name,
    path: `/files/${name}`,
  }));
  const user = userEvent.setup();
  const copy = vi.fn();
  render(<Harness rows={rows} copy={copy} />);
  const sorter = screen.getByRole('button', { name: '按文件名排序' });
  await user.click(sorter);
  expect(sorter.closest('th')).toHaveAttribute('aria-sort', 'ascending');
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('alpha.bin');
  await user.click(screen.getByText('alpha.bin'));
  await user.keyboard('{Shift>}');
  await user.click(screen.getByText('charlie.bin'));
  await user.keyboard('{/Shift}');
  screen.getAllByRole('row')[1].focus();
  await user.keyboard('{Meta>}c{/Meta}');
  expect(copy).toHaveBeenLastCalledWith(
    ['alpha.bin', 'bravo.bin', 'charlie.bin']
      .map((name) => `${name}\tUTF-8 文本\t${file.hashes.md5}\t0\\0`)
      .join('\n'),
  );
  await user.click(sorter);
  expect(sorter.closest('th')).toHaveAttribute('aria-sort', 'descending');
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('charlie.bin');
  await user.click(sorter);
  expect(sorter.closest('th')).toHaveAttribute('aria-sort', 'none');
  expect(screen.getAllByRole('row')[2]).toHaveTextContent('alpha.bin');
});

it('filters across pages, selects only visible matches and resets an empty result', async () => {
  const user = userEvent.setup();
  const vt = vi.fn();
  render(<Harness rows={fixtures(250)} vt={vt} />);
  await user.click(screen.getByRole('button', { name: '下一页' }));
  await user.click(screen.getByRole('button', { name: '筛选文件名' }));
  await user.type(screen.getByRole('searchbox', { name: '搜索文件名的值' }), 'file-23');
  await user.click(screen.getByRole('button', { name: '确定' }));
  expect(screen.getByText('file-23.bin')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '下一页' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: '选择全部 11 行' }));
  fireEvent.contextMenu(screen.getByText('file-23.bin'));
  await user.click(screen.getByRole('menuitem', { name: /VT API 查询/ }));
  expect(vt.mock.lastCall?.[1]).toHaveLength(11);
  await user.click(screen.getByRole('button', { name: '筛选文件格式' }));
  await user.click(screen.getByText('文本筛选'));
  await user.type(screen.getByRole('textbox', { name: '筛选文件格式' }), 'PNG');
  await user.click(screen.getByRole('button', { name: '确定' }));
  expect(screen.getByText('没有符合筛选条件的结果')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '重置筛选与排序' }));
  expect(screen.getByText('file-0.bin')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '筛选文件名' })).not.toHaveClass('active');
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
});

it('shows, filters and double-click copies the VT threat value and includes it in table copy', async () => {
  const user = userEvent.setup();
  const copy = vi.fn();
  render(
    <Harness
      rows={[file]}
      copy={copy}
      vtResults={{
        [file.hashes.md5!]: {
          state: 'complete',
          report: {
            hash: file.hashes.md5!,
            status: 'found',
            malicious: 7,
            suspicious: 0,
            total: 70,
            lastAnalysisDate: null,
            threatLabel: 'trojan.generic/test',
            threatCategories: ['trojan', 'downloader'],
          },
        },
      }}
    />,
  );
  await user.dblClick(screen.getByText('trojan.generic/test'));
  expect(copy).toHaveBeenLastCalledWith('trojan.generic/test');
  await user.click(screen.getByRole('button', { name: '筛选VT 威胁类型' }));
  await user.click(screen.getByText('文本筛选'));
  await user.type(screen.getByRole('textbox', { name: '筛选VT 威胁类型' }), 'downloader');
  await user.click(screen.getByRole('button', { name: '确定' }));
  expect(screen.getByText(file.name)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '复制表格' }));
  expect(copy.mock.lastCall?.[0]).toContain('VT 威胁类型');
  expect(copy.mock.lastCall?.[0]).toContain('trojan.generic/test');
});

it('uses a header dropdown with draft checkboxes, cancel, clear and values from the other active columns', async () => {
  const rows = fixtures(3).map((row, index) => ({
    ...row,
    fileFormat: ['PNG', 'PE32 EXE', 'UTF-8 文本'][index],
  }));
  const user = userEvent.setup();
  render(<Harness rows={rows} />);
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  const trigger = screen.getByRole('button', { name: '筛选文件格式' });
  await user.click(trigger);
  let popup = within(screen.getByRole('dialog', { name: '文件格式筛选' }));
  await user.click(popup.getByRole('checkbox', { name: '值：PE32 EXE' }));
  await user.click(popup.getByRole('button', { name: '取消' }));
  expect(screen.getByText(rows[1].name)).toBeInTheDocument();
  expect(trigger).not.toHaveClass('active');
  await user.click(trigger);
  popup = within(screen.getByRole('dialog', { name: '文件格式筛选' }));
  await user.click(popup.getByRole('checkbox', { name: /^全选/ }));
  await user.click(popup.getByRole('checkbox', { name: '值：PNG' }));
  await user.click(popup.getByRole('button', { name: '确定' }));
  expect(trigger).toHaveClass('active');
  expect(screen.getByText(rows[0].name)).toBeInTheDocument();
  expect(screen.queryByText(rows[1].name)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '筛选文件名' }));
  popup = within(screen.getByRole('dialog', { name: '文件名筛选' }));
  expect(popup.getByRole('checkbox', { name: `值：${rows[0].name}` })).toBeInTheDocument();
  expect(popup.queryByRole('checkbox', { name: `值：${rows[1].name}` })).not.toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '筛选文件名' })).toHaveFocus();
  await user.click(trigger);
  popup = within(screen.getByRole('dialog', { name: '文件格式筛选' }));
  expect(popup.getByRole('checkbox', { name: '值：PE32 EXE' })).not.toBeChecked();
  await user.click(popup.getByRole('button', { name: '清除此列筛选' }));
  expect(screen.getByText(rows[1].name)).toBeInTheDocument();
  expect(trigger).not.toHaveClass('active');
});

it('sorts from the dropdown and dismisses an outside click without applying draft changes', async () => {
  const rows = fixtures(3);
  const user = userEvent.setup();
  render(<Harness rows={rows} />);
  await user.click(screen.getByRole('button', { name: '筛选文件名' }));
  await user.click(screen.getByRole('button', { name: '↓ 降序' }));
  expect(screen.getAllByRole('row')[1]).toHaveTextContent(rows[2].name);
  await user.click(screen.getByRole('button', { name: '筛选文件名' }));
  await user.type(screen.getByRole('searchbox', { name: '搜索文件名的值' }), 'file-0');
  await user.click(screen.getByText('哈希结果'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getAllByRole('row')).toHaveLength(4);
  await user.click(screen.getByRole('button', { name: '筛选文件名' }));
  await user.click(screen.getByRole('button', { name: '取消排序' }));
  expect(screen.getAllByRole('row')[1]).toHaveTextContent(rows[0].name);
});
