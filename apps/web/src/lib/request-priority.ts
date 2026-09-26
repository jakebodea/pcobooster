import { ORPCError } from "@orpc/client";
import type { RequestPriority } from "@pcobooster/contracts/request-priority";
import type { QueryFunctionContext, QueryMeta } from "@tanstack/react-query";

/**
 * How long the browser must have no interactive call in flight before speculative work starts.
 * It covers the gap between one response and the query the next render starts from it (for
 * example candidates, then their details), so a warm-up never slips in between the two.
 */
export const SPECULATIVE_QUIET_MS = 250;

/** oRPC client context: which lane a call belongs to. Absent means interactive. */
export interface RequestPriorityContext {
  priority?: RequestPriority;
}

export interface RequestScheduler {
  /**
   * Runs one oRPC call. While any interactive call is in flight, and for `quietMs` after the
   * last one settles, speculative tasks wait.
   */
  track: <Result>(
    priority: RequestPriority,
    call: () => Promise<Result>
  ) => Promise<Result>;
  /**
   * Queues speculative work (a prefetch or warm-up) behind what the user is waiting on. Tasks
   * run one at a time, in order, each only once interactive calls have been quiet for
   * `quietMs`. A task whose signal aborts before it starts is dropped. Resolves when the task
   * settles or is dropped; failures are swallowed, since the destination query owns visible
   * errors.
   */
  runSpeculative: (
    task: () => Promise<void>,
    signal?: AbortSignal
  ) => Promise<void>;
}

interface QueuedTask {
  task: () => Promise<void>;
  signal: AbortSignal | undefined;
  settle: () => void;
}

const runTask = async (entry: QueuedTask) => {
  try {
    await entry.task();
  } catch {
    // Speculative work is best effort; the destination query surfaces its own errors.
  } finally {
    entry.settle();
  }
};

export const createRequestScheduler = ({
  quietMs,
}: {
  quietMs: number;
}): RequestScheduler => {
  const queue: QueuedTask[] = [];
  let interactiveInFlight = 0;
  let running = false;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelQuietTimer = () => {
    if (quietTimer !== undefined) {
      clearTimeout(quietTimer);
      quietTimer = undefined;
    }
  };

  const dropAbortedHead = () => {
    while (queue[0]?.signal?.aborted === true) {
      queue.shift()?.settle();
    }
  };

  const pump = () => {
    dropAbortedHead();
    if (
      running ||
      quietTimer !== undefined ||
      interactiveInFlight > 0 ||
      queue.length === 0
    ) {
      return;
    }
    // An interactive call that starts meanwhile cancels this timer (see `track`).
    quietTimer = setTimeout(() => {
      quietTimer = undefined;
      dropAbortedHead();
      const next = queue.shift();
      if (next === undefined) {
        return;
      }
      running = true;
      void (async () => {
        await runTask(next);
        running = false;
        pump();
      })();
    }, quietMs);
  };

  const track = async <Result>(
    priority: RequestPriority,
    call: () => Promise<Result>
  ): Promise<Result> => {
    if (priority === "speculative") {
      return await call();
    }
    interactiveInFlight += 1;
    // The quiet period restarts once this call settles.
    cancelQuietTimer();
    try {
      return await call();
    } finally {
      interactiveInFlight -= 1;
      pump();
    }
  };

  const runSpeculative = async (
    task: () => Promise<void>,
    signal?: AbortSignal
  ): Promise<void> => {
    if (signal?.aborted === true) {
      return;
    }
    const { promise, resolve } = Promise.withResolvers<null>();
    const entry: QueuedTask = {
      task,
      signal,
      settle: () => {
        resolve(null);
      },
    };
    queue.push(entry);
    signal?.addEventListener(
      "abort",
      () => {
        const index = queue.indexOf(entry);
        if (index !== -1) {
          queue.splice(index, 1);
          entry.settle();
        }
      },
      { once: true }
    );
    pump();
    await promise;
  };

  return { track, runSpeculative };
};

/** The tab's one scheduler: every oRPC call and every speculative task goes through it. */
export const requestScheduler = createRequestScheduler({
  quietMs: SPECULATIVE_QUIET_MS,
});

const SPECULATIVE_META: QueryMeta = { requestPriority: "speculative" };

/**
 * Marks a prefetch speculative. Its calls go out in the speculative lane until something on
 * screen observes the query; a mounted `useQuery` replaces the options, and with them this mark.
 */
export const speculativeQuery = <Options extends object>(
  options: Options & { meta?: QueryMeta }
): Options & { meta: QueryMeta } => ({
  ...options,
  meta: { ...options.meta, ...SPECULATIVE_META },
});

/**
 * The priority of a query's next call: speculative only while the fetch was started
 * speculatively and nothing on screen observes the query yet.
 */
export const queryCallPriority = ({
  client,
  meta,
  queryKey,
}: QueryFunctionContext): RequestPriority => {
  if (meta?.requestPriority !== "speculative") {
    return "interactive";
  }
  const observers =
    client
      .getQueryCache()
      .find({ queryKey, exact: true })
      ?.getObserversCount() ?? 0;
  return observers > 0 ? "interactive" : "speculative";
};

/** What each oRPC call from a query function passes as its client options. */
export interface QueryCallOptions {
  signal: AbortSignal;
  context: RequestPriorityContext;
}

/**
 * Makes one oRPC call for a query with the priority it has right now. The API holds back
 * speculative reads when the user's Planning Center budget is mostly spent; if the user opened
 * what was being prefetched in the meantime, the call is sent again as interactive instead of
 * failing on screen.
 */
export const callForQuery = async <Result>(
  context: QueryFunctionContext,
  call: (options: QueryCallOptions) => Promise<Result>
): Promise<Result> => {
  const { signal } = context;
  const priority = queryCallPriority(context);
  try {
    return await call({ signal, context: { priority } });
  } catch (error) {
    if (
      priority === "speculative" &&
      error instanceof ORPCError &&
      error.code === "TOO_MANY_REQUESTS" &&
      queryCallPriority(context) === "interactive"
    ) {
      return await call({ signal, context: { priority: "interactive" } });
    }
    throw error;
  }
};
