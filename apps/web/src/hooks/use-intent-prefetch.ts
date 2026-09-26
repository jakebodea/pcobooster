import { useCallback, useEffect, useRef } from "react";

import {
  createIntentPrefetcher,
  INTENT_PREFETCH_DWELL_MS,
} from "@/lib/intent-prefetch";
import type {
  IntentPrefetcher,
  IntentPrefetcherOptions,
} from "@/lib/intent-prefetch";
import { requestScheduler } from "@/lib/request-priority";

/** Spread on the element whose hover or focus signals intent to open a target. */
export interface IntentPrefetchProps {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

export type GetIntentPrefetchProps<Target> = (
  target: Target
) => IntentPrefetchProps;

/**
 * Binds `createIntentPrefetcher` to a component. Prefetches wait in the speculative lane, so
 * they start only once nothing the user is waiting on is loading; mark their queries with
 * `speculativeQuery`. Pointer and keyboard focus behave the same: each must rest on a target
 * for the dwell time, and leaving cancels it. Touch pointers fire the same events, so a tap or
 * a scroll ends before the dwell and prefetches nothing; the tap's navigation loads the target.
 */
export const useIntentPrefetch = <Target>(
  options: Omit<IntentPrefetcherOptions<Target>, "dwellMs" | "schedule">
) => {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const prefetcherRef = useRef<IntentPrefetcher<Target> | null>(null);
  // Created on the first event, so render never reads the refs.
  const getPrefetcher = useCallback(() => {
    const existing = prefetcherRef.current;
    if (existing !== null) {
      return existing;
    }
    const created = createIntentPrefetcher<Target>({
      dwellMs: INTENT_PREFETCH_DWELL_MS,
      keyOf: (target) => optionsRef.current.keyOf(target),
      isFresh: (target) => optionsRef.current.isFresh(target),
      prefetch: async (target) => {
        await optionsRef.current.prefetch(target);
      },
      schedule: requestScheduler.runSpeculative,
    });
    prefetcherRef.current = created;
    return created;
  }, []);
  const cancelIntent = useCallback(() => {
    prefetcherRef.current?.cancel();
  }, []);
  useEffect(() => cancelIntent, [cancelIntent]);

  const getIntentProps = useCallback<GetIntentPrefetchProps<Target>>(
    (target) => ({
      onPointerEnter: () => {
        getPrefetcher().start(target);
      },
      onPointerLeave: () => {
        getPrefetcher().end(target);
      },
      onFocus: () => {
        getPrefetcher().start(target);
      },
      onBlur: () => {
        getPrefetcher().end(target);
      },
    }),
    [getPrefetcher]
  );

  return { getIntentProps, cancelIntent };
};
