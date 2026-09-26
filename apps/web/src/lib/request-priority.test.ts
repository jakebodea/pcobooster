import { ORPCError } from "@orpc/client";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { QueryFunctionContext } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callForQuery,
  createRequestScheduler,
  queryCallPriority,
  speculativeQuery,
} from "./request-priority";
import type { QueryCallOptions } from "./request-priority";

const QUIET_MS = 250;

const deferred = () => Promise.withResolvers<null>();

describe(createRequestScheduler, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts speculative work only after interactive calls have been quiet", async () => {
    const scheduler = createRequestScheduler({ quietMs: QUIET_MS });
    const started: string[] = [];
    const visible = deferred();

    const interactive = scheduler.track("interactive", async () => {
      await visible.promise;
    });
    void scheduler.runSpeculative(async () => {
      started.push("warm-up");
      await Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(QUIET_MS * 4);
    expect(started).toStrictEqual([]);

    visible.resolve(null);
    await interactive;
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1);
    expect(started).toStrictEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toStrictEqual(["warm-up"]);
  });

  it("restarts the quiet period when an interactive call starts during it", async () => {
    const scheduler = createRequestScheduler({ quietMs: QUIET_MS });
    const started: string[] = [];

    void scheduler.runSpeculative(async () => {
      started.push("warm-up");
      await Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(QUIET_MS - 50);
    // The next render's query starts before the warm-up got its turn.
    await scheduler.track("interactive", async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1);
    expect(started).toStrictEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toStrictEqual(["warm-up"]);
  });

  it("runs speculative tasks one at a time, in order", async () => {
    const scheduler = createRequestScheduler({ quietMs: QUIET_MS });
    const started: string[] = [];
    const first = deferred();

    void scheduler.runSpeculative(async () => {
      started.push("first");
      await first.promise;
    });
    void scheduler.runSpeculative(async () => {
      started.push("second");
      await Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(QUIET_MS * 4);
    expect(started).toStrictEqual(["first"]);

    first.resolve(null);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(started).toStrictEqual(["first", "second"]);
  });

  it("does not hold speculative calls back behind each other's oRPC traffic", async () => {
    const scheduler = createRequestScheduler({ quietMs: QUIET_MS });
    const started: string[] = [];
    const prefetchCall = deferred();

    void scheduler.track("speculative", async () => {
      await prefetchCall.promise;
    });
    void scheduler.runSpeculative(async () => {
      started.push("warm-up");
      await Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(started).toStrictEqual(["warm-up"]);
    prefetchCall.resolve(null);
  });

  it("drops a task whose signal aborts before its turn", async () => {
    const scheduler = createRequestScheduler({ quietMs: QUIET_MS });
    const started: string[] = [];
    const leave = new AbortController();

    const dropped = scheduler.runSpeculative(async () => {
      started.push("left page");
      await Promise.resolve();
    }, leave.signal);
    void scheduler.runSpeculative(async () => {
      started.push("still wanted");
      await Promise.resolve();
    });
    leave.abort();
    await dropped;
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(started).toStrictEqual(["still wanted"]);
  });

  it("keeps the lane moving after a speculative task fails", async () => {
    const scheduler = createRequestScheduler({ quietMs: QUIET_MS });
    const started: string[] = [];

    const failed = scheduler.runSpeculative(async () => {
      started.push("rate limited");
      await Promise.reject(new Error("Planning Center rate limited"));
    });
    void scheduler.runSpeculative(async () => {
      started.push("next");
      await Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(QUIET_MS * 2);
    await expect(failed).resolves.toBeUndefined();
    expect(started).toStrictEqual(["rate limited", "next"]);
  });

  it("passes interactive results and failures through", async () => {
    const scheduler = createRequestScheduler({ quietMs: QUIET_MS });
    const failure = new Error("provider down");

    await expect(
      scheduler.track("interactive", async () => await Promise.resolve(7))
    ).resolves.toBe(7);
    await expect(
      scheduler.track("interactive", async () => await Promise.reject(failure))
    ).rejects.toBe(failure);
  });
});

const queryKey = ["plan-items", "st-1", "plan-1"] as const;

/** Runs `queryFn` the way TanStack Query does and records each call's priority. */
const setupQuery = (
  respond: (options: QueryCallOptions) => Promise<string>
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const priorities: (string | undefined)[] = [];
  const options = {
    queryKey,
    queryFn: async (context: QueryFunctionContext) =>
      await callForQuery(context, async (callOptions) => {
        priorities.push(callOptions.context.priority);
        return await respond(callOptions);
      }),
  };
  return { queryClient, options, priorities };
};

const rateLimited = () =>
  new ORPCError("TOO_MANY_REQUESTS", {
    data: { message: "held back", service: "planning-center" },
  });

describe(callForQuery, () => {
  it("sends a query on screen as interactive", async () => {
    const { queryClient, options, priorities } = setupQuery(
      async () => await Promise.resolve("items")
    );
    await expect(queryClient.query(options)).resolves.toBe("items");
    expect(priorities).toStrictEqual(["interactive"]);
  });

  it("sends a prefetch nobody observes as speculative", async () => {
    const { queryClient, options, priorities } = setupQuery(
      async () => await Promise.resolve("items")
    );
    await queryClient.query(speculativeQuery(options));
    expect(priorities).toStrictEqual(["speculative"]);
  });

  it("sends a held-back prefetch again as interactive once the user opened it", async () => {
    const response = deferred();
    let first = true;
    const { queryClient, options, priorities } = setupQuery(async () => {
      if (first) {
        first = false;
        await response.promise;
        throw rateLimited();
      }
      return "items";
    });

    const prefetch = queryClient.query(speculativeQuery(options));
    // The user opens the Plan tab while the prefetch is still out.
    const observer = new QueryObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => {
      // Mounted, like useQuery.
    });
    response.resolve(null);

    await expect(prefetch).resolves.toBe("items");
    expect(priorities).toStrictEqual(["speculative", "interactive"]);
    unsubscribe();
  });

  it("lets a held-back prefetch fail when nobody opened it", async () => {
    const { queryClient, options, priorities } = setupQuery(async () => {
      await Promise.resolve();
      throw rateLimited();
    });
    await expect(
      queryClient.query(speculativeQuery(options))
    ).rejects.toBeInstanceOf(ORPCError);
    expect(priorities).toStrictEqual(["speculative"]);
  });

  it("does not repeat a speculative call that failed for another reason", async () => {
    const response = deferred();
    const failure = new ORPCError("BAD_GATEWAY", {
      data: { message: "down", service: "planning-center" },
    });
    const { queryClient, options, priorities } = setupQuery(async () => {
      await response.promise;
      throw failure;
    });
    const prefetch = queryClient.query(speculativeQuery(options));
    const observer = new QueryObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => {
      // Mounted, like useQuery.
    });
    response.resolve(null);

    await expect(prefetch).rejects.toBe(failure);
    expect(priorities).toStrictEqual(["speculative"]);
    unsubscribe();
  });

  it("sends a prefetch of a query already on screen as interactive", async () => {
    const { queryClient, options, priorities } = setupQuery(
      async () => await Promise.resolve("items")
    );
    const observer = new QueryObserver(queryClient, {
      ...options,
      enabled: false,
    });
    const unsubscribe = observer.subscribe(() => {
      // Mounted but waiting its turn, like a gated detail batch.
    });
    await queryClient.query(speculativeQuery(options));
    expect(priorities).toStrictEqual(["interactive"]);
    unsubscribe();
  });
});

describe(queryCallPriority, () => {
  it("treats queries without the speculative mark as interactive", () => {
    const queryClient = new QueryClient();
    expect(
      queryCallPriority({
        client: queryClient,
        queryKey,
        meta: undefined,
        signal: new AbortController().signal,
      })
    ).toBe("interactive");
  });
});
