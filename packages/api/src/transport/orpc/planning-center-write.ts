import type { RequestContext } from "@pcobooster/api/application/context";
import type { ApplicationFault } from "@pcobooster/api/application/errors";
import {
  PlanningCenterAccess,
  resolvePlanningCenterAccess,
} from "@pcobooster/api/application/planning-center-access";
import type { PlanningCenterAccessDependencies } from "@pcobooster/api/application/planning-center-access";
import type { ApplicationRuntime } from "@pcobooster/api/application/runtime";
import type { Server } from "@pcobooster/api/server";
import type { RpcContext } from "@pcobooster/api/transport/orpc/context";
import { executeApplicationEffect } from "@pcobooster/api/transport/orpc/execute";
import { Effect } from "effect";
import type { HttpClient } from "effect/unstable/http/HttpClient";

/** Keep one request credential across interruptible preparation and a committed write. */
export const executePreparedPlanningCenterWrite = async <Preparation, Value>(
  runtime: ApplicationRuntime<HttpClient>,
  context: RpcContext,
  signal: AbortSignal | undefined,
  prepare: Effect.Effect<
    Preparation,
    ApplicationFault,
    PlanningCenterAccess | RequestContext | Server
  >,
  commit: (
    prepared: Preparation
  ) => Effect.Effect<
    Value,
    ApplicationFault,
    PlanningCenterAccess | RequestContext
  >,
  dependencies?: PlanningCenterAccessDependencies
): Promise<Value> => {
  const access = await executeApplicationEffect(
    runtime,
    resolvePlanningCenterAccess(dependencies),
    context,
    signal
  );
  try {
    const prepared = await executeApplicationEffect(
      runtime,
      Effect.provideService(prepare, PlanningCenterAccess, access),
      context,
      signal
    );
    return await executeApplicationEffect(
      runtime,
      Effect.provideService(commit(prepared), PlanningCenterAccess, access),
      context,
      signal,
      { interruptOnAbort: false }
    );
  } finally {
    // Shared read-cache writes must finish inside the request that started them.
    await Effect.runPromise(access.services.settleReadCaches);
  }
};
