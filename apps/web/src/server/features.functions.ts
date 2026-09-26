import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

import { createServerRpcClient } from "@/server/server-rpc";

const createRequestRpcClient = () => {
  setResponseHeader("Cache-Control", "private, no-store");
  return createServerRpcClient({
    api: env.API,
    cookie: getRequest().headers.get("cookie") ?? undefined,
    productOrigin: env.PRODUCT_ORIGIN,
  });
};

/**
 * Whether the People pages are on for this visitor. The API evaluates the `people` flag for
 * the signed-in user and organization on every call.
 */
export const getPeopleFeature = createServerFn({ method: "GET" }).handler(
  async () => await createRequestRpcClient().features.people({})
);

/** Whether the Songs chord chart editor is on for this visitor (the `chordCharts` flag). */
export const getChordChartsFeature = createServerFn({ method: "GET" }).handler(
  async () => await createRequestRpcClient().features.chordCharts({})
);
