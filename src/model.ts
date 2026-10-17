import type { Algorithm, FileRow, JobEvent, JobSummary, Progress } from './types';

export type Comparison = 'empty' | 'invalid' | 'match' | 'mismatch';
export function compareHash(input: string, hashes: Partial<Record<Algorithm, string>>): Comparison {
  const value = input.trim().toLowerCase();
  if (!value) return 'empty';
  if (!/^[0-9a-f]+$/.test(value) || ![8, 16, 32, 40, 64, 128].includes(value.length))
    return 'invalid';
  return Object.values(hashes).some((hash) => hash?.toLowerCase() === value) ? 'match' : 'mismatch';
}

export interface JobState {
  phase: 'idle' | 'scanning' | 'running' | 'done' | 'cancelled' | 'error';
  rows: FileRow[];
  progress: Progress | null;
  summary: JobSummary | null;
  error: string | null;
}
export const initialJob: JobState = {
  phase: 'idle',
  rows: [],
  progress: null,
  summary: null,
  error: null,
};
export type JobAction =
  | { type: 'reset' | 'begin' }
  | { type: 'event'; event: JobEvent }
  | { type: 'events'; events: JobEvent[] }
  | { type: 'finish'; summary: JobSummary }
  | { type: 'error'; error: string };
export function jobReducer(state: JobState, action: JobAction): JobState {
  switch (action.type) {
    case 'reset':
      return initialJob;
    case 'begin':
      return { ...initialJob, phase: 'scanning' };
    case 'finish':
      return {
        ...state,
        phase: action.summary.cancelled ? 'cancelled' : 'done',
        summary: action.summary,
        rows: action.summary.results,
      };
    case 'error':
      return { ...state, phase: 'error', error: action.error };
    case 'event':
      return jobReducer(state, { type: 'events', events: [action.event] });
    case 'events': {
      if (state.phase !== 'scanning' && state.phase !== 'running') return state;
      let rows = state.rows;
      let progress = state.progress;
      let phase = state.phase;
      const results = new Map<string, FileRow>();
      for (const event of action.events) {
        if (event.type === 'discovered') {
          rows = event.files.map((file) => ({
            ...file,
            status: 'pending',
            hashes: {},
            checks: [],
          }));
          phase = 'running';
          results.clear();
        } else if (event.type === 'progress') {
          progress = event;
        } else {
          results.set(event.result.path, event.result);
        }
      }
      return {
        ...state,
        phase,
        progress,
        rows: results.size ? rows.map((row) => results.get(row.path) ?? row) : rows,
      };
    }
  }
}

export function jobProgress(state: Pick<JobState, 'summary' | 'progress' | 'rows'>): number {
  if (state.summary && !state.summary.cancelled) return 100;
  if (state.progress?.totalBytes)
    return Math.min(100, (state.progress.bytesProcessed / state.progress.totalBytes) * 100);
  if (state.summary?.cancelled)
    return state.summary.total ? (state.summary.completed / state.summary.total) * 100 : 0;
  const processed = state.rows.filter(
    (row) => row.status === 'complete' || row.status === 'error',
  ).length;
  return state.rows.length ? (processed / state.rows.length) * 100 : 0;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
export const baseName = (path: string) => {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
};

export function checksumLine(hash: string, name: string): string {
  const escaped = /[\\\n\r]/.test(name);
  const file = name.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  return `${escaped ? '\\' : ''}${hash} *${file}`;
}
