import { currentRequestPriority } from "@pcobooster/api/planning-center/accounting";
import { isPlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import { PlanningCenterRateLimitError } from "@pcobooster/api/planning-center/rate-limit-error";
import type { PlanningCenterReadCache } from "@pcobooster/api/planning-center/services/read-cache";
import { Cause, Effect, Exit } from "effect";

/** Hands a load's outcome to the cache's Promise waiters. */
const settleLoad = <Value>(
  exit: Exit.Exit<Value, PlanningCenterError>
): Value => {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = exit.cause.reasons.find(Cause.isFailReason);
  if (failure !== undefined) {
    throw failure.error;
  }
  if (Cause.hasInterruptsOnly(exit.cause)) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  const defect = Cause.squash(exit.cause);
  throw defect instanceof Error
    ? defect
    : new Error("Planning Center read failed", { cause: defect });
};

const isHeldBackSpeculativeRead = (error: PlanningCenterError): boolean =>
  error instanceof PlanningCenterRateLimitError &&
  error.reason === "speculative";

/** One pass through the cache; a joined load's failure is this caller's failure. */
const readThrough = <Value>(
  cache: PlanningCenterReadCache<Value>,
  key: string,
  ttlMs: number,
  load: () => Effect.Effect<Value, PlanningCenterError>
): Effect.Effect<Value, PlanningCenterError> =>
  Effect.gen(function* readThroughCache() {
    const runLoad = Effect.runPromiseExitWith(yield* Effect.context());
    return yield* Effect.tryPromise(
      async (signal) =>
        await cache.get(
          key,
          ttlMs,
          async (loadSignal) =>
            settleLoad(await runLoad(load(), { signal: loadSignal })),
          signal
        )
    ).pipe(
      Effect.catch(({ cause }) =>
        isPlanningCenterError(cause) ? Effect.fail(cause) : Effect.die(cause)
      )
    );
  });

/**
 * Reads through a shared cache; `load` is only built on a miss. Each caller
 * waits on its own fiber, so interrupting one caller leaves the load running
 * for the others; the load is interrupted, and nothing is cached, once no
 * callers remain.
 *
 * A load runs with the priority of the procedure that started it. When an
 * interactive caller joined a speculative load that the pacer held back, it
 * loads again with its own priority instead of failing with the prefetch.
 */
export const cachedRead = <Value>(
  cache: PlanningCenterReadCache<Value>,
  key: string,
  ttlMs: number,
  load: () => Effect.Effect<Value, PlanningCenterError>
): Effect.Effect<Value, PlanningCenterError> => {
  const read = readThrough(cache, key, ttlMs, load);
  return Effect.catchIf(read, isHeldBackSpeculativeRead, (heldBack) =>
    Effect.gen(function* loadForInteractiveCaller() {
      const priority = yield* currentRequestPriority;
      if (priority === "speculative") {
        return yield* Effect.fail(heldBack);
      }
      return yield* read;
    })
  );
};
