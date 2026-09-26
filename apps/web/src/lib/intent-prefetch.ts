import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * How long the pointer or keyboard focus must rest on one target before a prefetch starts.
 * Sweeping the pointer across a list never rests this long, so it prefetches nothing.
 */
export const INTENT_PREFETCH_DWELL_MS = 300;

export interface IntentPrefetcherOptions<Target> {
  dwellMs: number;
  /** Targets with the same key share one dwell timer. */
  keyOf: (target: Target) => string;
  /** True when the target's data is cached and fresh, or already loading. */
  isFresh: (target: Target) => boolean;
  /** Failures are ignored: the destination query owns visible errors. */
  prefetch: (target: Target) => Promise<void>;
  /**
   * Where a prefetch waits for its turn, such as the speculative lane behind what the user is
   * waiting on. It must skip the task once `signal` aborts and never reject (the task catches
   * its own failures). Defaults to running at once.
   */
  schedule?: (task: () => Promise<void>, signal: AbortSignal) => Promise<void>;
}

export interface IntentPrefetcher<Target> {
  /** Pointer entered or focus arrived: start the dwell timer for this target. */
  start: (target: Target) => void;
  /** Pointer left or focus moved away: cancel this target's dwell timer. */
  end: (target: Target) => void;
  /**
   * Cancel any pending dwell timer and any prefetch still waiting for its turn. A prefetch
   * that already started keeps running.
   */
  cancel: () => void;
}

const runNow = async (task: () => Promise<void>): Promise<void> => {
  await task();
};

/**
 * Prefetches on clear intent only. A target must hold the pointer or focus for `dwellMs`;
 * at most one prefetch runs at a time, and a dwell that ends while another prefetch runs
 * is dropped rather than queued. A prefetch still waiting for its turn is replaced by the
 * newer intent. Fresh targets are never fetched again.
 */
export const createIntentPrefetcher = <Target>({
  dwellMs,
  keyOf,
  isFresh,
  prefetch,
  schedule = runNow,
}: IntentPrefetcherOptions<Target>): IntentPrefetcher<Target> => {
  let pending: { key: string; timer: ReturnType<typeof setTimeout> } | null =
    null;
  let waiting: AbortController | null = null;
  let inFlight = false;

  const cancelDwell = () => {
    if (pending === null) {
      return;
    }
    clearTimeout(pending.timer);
    pending = null;
  };

  const cancel = () => {
    cancelDwell();
    waiting?.abort();
    waiting = null;
  };

  const run = (target: Target) => {
    if (inFlight || isFresh(target)) {
      return;
    }
    waiting?.abort();
    const turn = new AbortController();
    waiting = turn;
    const task = async () => {
      if (waiting === turn) {
        waiting = null;
      }
      // The target may have loaded while this prefetch waited for its turn.
      if (turn.signal.aborted || inFlight || isFresh(target)) {
        return;
      }
      inFlight = true;
      try {
        await prefetch(target);
      } catch {
        // Prefetching is optional; the destination query surfaces its own errors.
      } finally {
        inFlight = false;
      }
    };
    void schedule(task, turn.signal);
  };

  const start = (target: Target) => {
    const key = keyOf(target);
    if (pending?.key === key) {
      return;
    }
    cancelDwell();
    const timer = setTimeout(() => {
      pending = null;
      run(target);
    }, dwellMs);
    pending = { key, timer };
  };

  const end = (target: Target) => {
    if (pending?.key === keyOf(target)) {
      cancelDwell();
    }
  };

  return { start, end, cancel };
};

/**
 * True when the query has data newer than `staleTime` that was not invalidated, or is
 * already fetching. Either way a prefetch would add no Planning Center requests.
 */
export const isQueryFresh = (
  queryClient: QueryClient,
  queryKey: QueryKey,
  staleTime: number,
  now: number = Date.now()
): boolean => {
  const state = queryClient.getQueryState(queryKey);
  if (state === undefined) {
    return false;
  }
  if (state.fetchStatus === "fetching") {
    return true;
  }
  return (
    state.dataUpdatedAt > 0 &&
    !state.isInvalidated &&
    now - state.dataUpdatedAt < staleTime
  );
};
