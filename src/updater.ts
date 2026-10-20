import { isTauri } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type AppUpdate = Pick<Update, 'version' | 'body' | 'downloadAndInstall' | 'close'>;

export const updater = {
  available: isTauri() && !import.meta.env.DEV,
  check: (): Promise<AppUpdate | null> => check({ timeout: 15000 }),
  relaunch,
};
