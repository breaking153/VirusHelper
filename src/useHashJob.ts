import { useCallback, useEffect, useReducer, useRef } from 'react';
import { initialJob, jobReducer } from './model';
import { native } from './native';
import type { JobEvent, JobRequest } from './types';

export function useHashJob() {
  const [state, dispatch] = useReducer(jobReducer, initialJob);
  const running = useRef(false);
  const worker = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef<JobRequest | null>(null);
  const cancellation = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const pending = useRef<JobEvent[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPending = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current = [];
  }, []);
  const cancelActive = useCallback(() => {
    if (!running.current) return Promise.resolve();
    if (!cancellation.current) {
      const acknowledgement = native.cancel();
      cancellation.current = acknowledgement;
      // The worker also awaits this acknowledgement before starting another job.
      void acknowledgement.catch(() => {
        if (cancellation.current === acknowledgement) cancellation.current = null;
      });
      return acknowledgement;
    }
    return cancellation.current;
  }, []);
  const cancel = useCallback(() => {
    queued.current = null;
    return cancelActive();
  }, [cancelActive]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queued.current = null;
      void cancelActive().catch(() => {});
      clearPending();
    };
  }, [cancelActive, clearPending]);
  const run = useCallback(
    (request: JobRequest): Promise<void> => {
      queued.current = request;
      if (running.current) {
        void cancelActive().catch(() => {});
        return worker.current;
      }
      running.current = true;
      const process = async () => {
        try {
          while (queued.current && mounted.current) {
            const next = queued.current;
            queued.current = null;
            cancellation.current = null;
            let acceptingEvents = true;
            dispatch({ type: 'begin' });
            try {
              const summary = await native.run(next, (event) => {
                if (!mounted.current || !acceptingEvents) return;
                pending.current.push(event);
                if (timer.current === null) {
                  timer.current = setTimeout(() => {
                    dispatch({ type: 'events', events: pending.current });
                    pending.current = [];
                    timer.current = null;
                  }, 80);
                }
              });
              if (mounted.current) dispatch({ type: 'finish', summary });
            } catch (error) {
              if (mounted.current) dispatch({ type: 'error', error: String(error) });
            } finally {
              acceptingEvents = false;
              clearPending();
            }
            if (cancellation.current) {
              try {
                await cancellation.current;
              } catch (error) {
                if (mounted.current) dispatch({ type: 'error', error: String(error) });
              }
            }
          }
        } finally {
          running.current = false;
          cancellation.current = null;
        }
      };
      worker.current = process();
      return worker.current;
    },
    [cancelActive, clearPending],
  );
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  return {
    ...state,
    run,
    cancel,
    reset,
    busy: state.phase === 'scanning' || state.phase === 'running',
  };
}
