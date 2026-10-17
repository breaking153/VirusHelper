import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type {
  Algorithm,
  JobEvent,
  JobRequest,
  JobSummary,
  ManifestSelection,
  VtReport,
  VtSettings,
} from './types';

export const native = {
  available: isTauri(),
  pickFiles: () => invoke<string[]>('pick_files'),
  pickFolder: () => invoke<string | null>('pick_folder'),
  pickManifest: (hint: Algorithm | null) =>
    invoke<ManifestSelection | null>('pick_manifest', { hint }),
  run: (request: JobRequest, receive: (event: JobEvent) => void) => {
    const onEvent = new Channel<JobEvent>();
    onEvent.onmessage = receive;
    return invoke<JobSummary>('run_job', { request, onEvent });
  },
  cancel: () => invoke<void>('cancel_job'),
  clear: () => invoke<void>('clear_results'),
  export: (algorithm: Algorithm) => invoke<string | null>('export_results', { algorithm }),
  copy: (text: string) => writeText(text),
  vtSettings: () => invoke<VtSettings>('get_vt_settings'),
  configureVt: (key: string) => invoke<VtSettings>('set_vt_api_key', { key }),
  lookupVt: (hash: string) => invoke<VtReport>('lookup_vt', { hash }),
  openVtPage: (page: 'report' | 'api-key' | 'docs', hash: string | null = null) =>
    invoke<void>('open_vt_page', { page, hash }),
  listenDrop: (receive: (type: 'enter' | 'over' | 'drop' | 'leave', paths?: string[]) => void) =>
    getCurrentWebview().onDragDropEvent(({ payload }) =>
      receive(payload.type, 'paths' in payload ? payload.paths : undefined),
    ),
};
