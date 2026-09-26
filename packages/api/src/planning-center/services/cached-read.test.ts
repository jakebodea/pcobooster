import { setTimeout as delay } from "node:timers/promises";

import {
  currentRequestPriority,
  PlanningCenterAccounting,
} from "@pcobooster/api/planning-center/accounting";
import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import { PlanningCenterRateLimitError } from "@pcobooster/api/planning-center/rate-limit-error";
import { PlanningCenterRequestAccounting } from "@pcobooster/api/planning-center/request-accounting";
import { cachedRead } from "@pcobooster/api/planning-center/services/cached-read";
import { PlanningCenterReadCache } from "@pcobooster/api/planning-center/services/read-cache";
import { Cause, Effect, Exit, Fiber } from "effect";
import { describe, expect, it, vi } from "vitest";

const TTL_MS = 60_000;

/** Lets forked fibers reach the cache before the test acts on them. */
const settle = Effect.promise(async () => {
  await delay(10);
});

describe(cachedRead, () => {
  it("shares one load between concurrent callers", async () => {
    const cache = new PlanningCenterReadCache<number>();
    const load = vi.fn<() => Effect.Effect<number, PlanningCenterError>>(() =>
      Effect.succeed(7)
    );

    const values = await Effect.runPromise(
      Effect.all(
        [
          cachedRead(cache, "shared", TTL_MS, load),
          cachedRead(cache, "shared", TTL_MS, load),
        ],
        { concurrency: "unbounded" }
      )
    );

    expect(values).toStrictEqual([7, 7]);
    expect(load).toHaveBeenCalledOnce();
  });

  it("keeps the load running for a caller that is still waiting", async () => {
    const cache = new PlanningCenterReadCache<string>();
    const release = Promise.withResolvers<string>();
    const load = vi.fn<() => Effect.Effect<string, PlanningCenterError>>(() =>
      Effect.promise(async () => await release.promise)
    );

    const value = await Effect.runPromise(
      Effect.gen(function* interruptOneCaller() {
        const leaving = yield* Effect.forkChild(
          cachedRead(cache, "waiting", TTL_MS, load)
        );
        const staying = yield* Effect.forkChild(
          cachedRead(cache, "waiting", TTL_MS, load)
        );
        yield* settle;
        yield* Fiber.interrupt(leaving);
        release.resolve("loaded");
        return yield* Fiber.join(staying);
      })
    );

    expect(value).toBe("loaded");
    expect(load).toHaveBeenCalledOnce();
  });

  it("interrupts the load and caches nothing once every caller leaves", async () => {
    const cache = new PlanningCenterReadCache<string>();
    let interrupted = false;
    const load = vi
      .fn<() => Effect.Effect<string, PlanningCenterError>>()
      .mockReturnValueOnce(
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            })
          )
        )
      )
      .mockReturnValue(Effect.succeed("fresh"));

    const value = await Effect.runPromise(
      Effect.gen(function* abandonLoad() {
        const caller = yield* Effect.forkChild(
          cachedRead(cache, "abandoned", TTL_MS, load)
        );
        yield* settle;
        yield* Fiber.interrupt(caller);
        yield* settle;
        return yield* cachedRead(cache, "abandoned", TTL_MS, load);
      })
    );

    expect(interrupted).toBeTruthy();
    expect(value).toBe("fresh");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps Planning Center failures typed and does not cache them", async () => {
    const cache = new PlanningCenterReadCache<string>();
    const failure = new PlanningCenterApiError({
      message: "Planning Center API error: 503",
      status: 503,
    });
    const load = vi
      .fn<() => Effect.Effect<string, PlanningCenterError>>()
      .mockReturnValueOnce(Effect.fail(failure))
      .mockReturnValue(Effect.succeed("recovered"));

    const first = await Effect.runPromise(
      Effect.flip(cachedRead(cache, "failing", TTL_MS, load))
    );
    const second = await Effect.runPromise(
      cachedRead(cache, "failing", TTL_MS, load)
    );

    expect(first).toBe(failure);
    expect(second).toBe("recovered");
  });

  it("keeps unexpected load errors as defects", async () => {
    const cache = new PlanningCenterReadCache<string>();
    const defect = new TypeError("broken transform");

    const exit = await Effect.runPromiseExit(
      cachedRead(cache, "defect", TTL_MS, () => Effect.die(defect))
    );

    expect(
      Exit.isFailure(exit)
        ? exit.cause.reasons
            .filter(Cause.isDieReason)
            .map((reason) => reason.defect)
        : []
    ).toStrictEqual([defect]);
  });

  it("loads again for an interactive caller that joined a held-back speculative load", async () => {
    const cache = new PlanningCenterReadCache<string>();
    const release = Promise.withResolvers<null>();
    // Like the pacer: a speculative load is held back, an interactive one is sent.
    const load = vi.fn<() => Effect.Effect<string, PlanningCenterError>>(() =>
      Effect.gen(function* pacedLoad() {
        const priority = yield* currentRequestPriority;
        yield* Effect.promise(async () => {
          await release.promise;
        });
        if (priority === "speculative") {
          return yield* Effect.fail(
            new PlanningCenterRateLimitError({
              retryAfterSeconds: 12,
              reason: "speculative",
            })
          );
        }
        return "loaded";
      })
    );
    const asPriority = (priority: "interactive" | "speculative") =>
      Effect.provideService(
        cachedRead(cache, "joined", TTL_MS, load),
        PlanningCenterAccounting,
        new PlanningCenterRequestAccounting({ priority })
      );

    const [prefetch, visible] = await Effect.runPromise(
      Effect.gen(function* prefetchThenOpen() {
        const speculative = yield* Effect.forkChild(
          Effect.exit(asPriority("speculative"))
        );
        yield* settle;
        const interactive = yield* Effect.forkChild(asPriority("interactive"));
        yield* settle;
        release.resolve(null);
        return [
          yield* Fiber.join(speculative),
          yield* Fiber.join(interactive),
        ] as const;
      })
    );

    expect(visible).toBe("loaded");
    expect(Exit.isFailure(prefetch)).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
