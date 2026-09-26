import { implement } from "@orpc/server";
import { createApplicationRuntime } from "@pcobooster/api/application/runtime";
import { PlanningCenterPacing } from "@pcobooster/api/planning-center/pacing";
import { PlanningCenterRatePacer } from "@pcobooster/api/planning-center/rate-pacer";
import type { RpcContext } from "@pcobooster/api/transport/orpc/context";
import { accountPlanningCenterProcedure } from "@pcobooster/api/transport/orpc/planning-center-accounting";
import { appContract } from "@pcobooster/contracts";
import {
  parseRequestPriority,
  REQUEST_PRIORITY_HEADER,
} from "@pcobooster/contracts/request-priority";
import { Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

/**
 * Planning Center requests go through the Worker's `fetch`. One pacer per
 * isolate shares each credential's rate budget across concurrent procedures.
 */
export const applicationRuntime = createApplicationRuntime(
  Layer.mergeAll(
    FetchHttpClient.layer,
    Layer.succeed(PlanningCenterPacing, new PlanningCenterRatePacer())
  )
);

/**
 * Every procedure counts its Planning Center requests and logs one summary. The browser marks
 * prefetches and warm-ups speculative, and the pacer holds those back first.
 */
export const rpc = implement(appContract)
  .$context<RpcContext>()
  .use(
    async ({ context, next, path }) =>
      await accountPlanningCenterProcedure(
        {
          procedure: path.join("."),
          requestId: context.requestId,
          priority: parseRequestPriority(
            context.request.headers.get(REQUEST_PRIORITY_HEADER)
          ),
          accounting: context.planningCenterAccounting,
        },
        async (accounting) =>
          await next({ context: { planningCenterAccounting: accounting } })
      )
  );
