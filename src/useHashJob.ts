import { useCallback, useEffect, useReducer, useRef } from 'react';
import { initialJob, jobReducer } from './model';
import { native } from './native';
import type { JobEvent, JobRequest } from './types';

export function useHashJob() {
  const [state, dispatch] = useReducer(jobReducer, initialJob);
  const running = useRef(false);
  const pending = useRef<JobEvent[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPending = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current = [];
  }, []);
  useEffect(() => clearPending, [clearPending]);
  const run = useCallback(
    async (request: JobRequest) => {
      if (running.current) return;
      running.current = true;
      dispatch({ type: 'begin' });
      try {
        const summary = await native.run(request, (event) => {
          pending.current.push(event);
          if (timer.current === null) {
            timer.current = setTimeout(() => {
              dispatch({ type: 'events', events: pending.current });
              pending.current = [];
              timer.current = null;
            }, 80);
          }
        });
        clearPending();
        dispatch({ type: 'finish', summary });
      } catch (error) {
        clearPending();
        dispatch({ type: 'error', error: String(error) });
      } finally {
        running.current = false;
      }
    },
    [clearPending],
  );
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  return { ...state, run, reset, busy: state.phase === 'scanning' || state.phase === 'running' };
}
