import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyWindowsShellResource } from './prepare-release.mjs';

// https://v2.tauri.app/reference/environment-variables/#tauri-cli-hook-commands
const target = process.env.TAURI_ENV_TARGET_TRIPLE;
if (target ? target.includes('windows') : process.platform === 'win32') {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const config = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const windows = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.windows.conf.json'), 'utf8'));
  verifyWindowsShellResource(config.version, windows.bundle?.resources);
  const args = ['build', '-p', 'windows-shell', '--release', '--locked'];
  if (target) args.push('--target', target);
  const result = spawnSync('cargo', args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  const output = process.env.CARGO_TARGET_DIR
    ? resolve(root, process.env.CARGO_TARGET_DIR)
    : join(root, 'target');
  const source = join(output, ...(target ? [target] : []), 'release', 'virushelper_shell.dll');
  const directory = join(root, 'src-tauri', 'windows', 'generated');
  mkdirSync(directory, { recursive: true });
  copyFileSync(source, join(directory, 'virushelper_shell.dll'));
}
