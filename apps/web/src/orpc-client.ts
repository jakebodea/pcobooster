import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { captureAnalytics } from "@pcobooster/analytics/client";
import type { appContract } from "@pcobooster/contracts";
import { REQUEST_PRIORITY_HEADER } from "@pcobooster/contracts/request-priority";

import { requestScheduler } from "@/lib/request-priority";
import type { RequestPriorityContext } from "@/lib/request-priority";
import { measureWorkflow } from "@/lib/workflow-analytics";

type AppClient = ContractRouterClient<
  typeof appContract,
  RequestPriorityContext
>;

const rpcLink = new RPCLink<RequestPriorityContext>({
  // The API spends only part of the user's Planning Center budget on speculative calls.
  headers: ({ context }) =>
    context.priority === "speculative"
      ? { [REQUEST_PRIORITY_HEADER]: "speculative" }
      : {},
  interceptors: [
    // Interactive calls hold speculative work back until they settle.
    async (options) =>
      await requestScheduler.track(
        options.context.priority ?? "interactive",
        async () =>
          await measureWorkflow(
            options.path,
            async () => await options.next(),
            captureAnalytics
          )
      ),
  ],
  fetch: async (request) =>
    await globalThis.fetch(new Request(request, { credentials: "include" })),
  // oRPC builds each request with `new URL(url)`, which requires an origin.
  url: () => new URL("/api/rpc", window.location.origin).href,
});

export const orpc = createORPCClient<AppClient>(rpcLink);
