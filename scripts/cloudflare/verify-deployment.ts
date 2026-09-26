/**
 * Wait until a deployed origin serves the expected commit from both Workers that CI redeploys
 * on every commit: the web Worker at `/version`, and the API through the web -> API binding at
 * `/api/rpc/health`. Then check the public home page. Workers roll out gradually, so the old
 * version may answer briefly after `alchemy deploy` returns.
 *
 *   bun scripts/cloudflare/verify-deployment.ts <origin> <commit-sha>
 */
import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

const attemptIntervalMs = 5000;
const defaultDeadlineMs = 180_000;

const rpcHealthResponse = z.object({
  json: z.object({ status: z.literal("ok"), version: z.string() }),
});

const webVersionResponse = z.object({ version: z.string() });

type Fetch = typeof fetch;

/** The API's deployed version, or undefined until it answers with a healthy oRPC reply. */
export const readVersion = async (
  origin: string,
  fetchImpl: Fetch = fetch
): Promise<string | undefined> => {
  try {
    const response = await fetchImpl(`${origin}/api/rpc/health`, {
      body: JSON.stringify({ json: {} }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      return undefined;
    }
    const parsed = rpcHealthResponse.safeParse(await response.json());
    return parsed.success ? parsed.data.json.version : undefined;
  } catch {
    return undefined;
  }
};

/** The web Worker's deployed version, or undefined until it answers. */
export const readWebVersion = async (
  origin: string,
  fetchImpl: Fetch = fetch
): Promise<string | undefined> => {
  try {
    const response = await fetchImpl(`${origin}/version`, {
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    if (!response.ok) {
      return undefined;
    }
    const parsed = webVersionResponse.safeParse(await response.json());
    return parsed.success ? parsed.data.version : undefined;
  } catch {
    return undefined;
  }
};

/** Whether the public home page answers 200; it can trail the API during a rollout. */
const homeIsServing = async (
  origin: string,
  fetchImpl: Fetch
): Promise<boolean> => {
  try {
    const home = await fetchImpl(origin, { redirect: "manual" });
    return home.status === 200;
  } catch {
    return false;
  }
};

export const verifyDeployment = async (
  origin: string,
  expectedVersion: string,
  {
    fetchImpl = fetch,
    intervalMs = attemptIntervalMs,
    deadlineMs = defaultDeadlineMs,
  } = {}
): Promise<void> => {
  const deadline = Date.now() + deadlineMs;
  let webVersion: string | undefined;
  let apiVersion: string | undefined;
  let homeServing = false;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- Polling waits for the rollout.
    [webVersion, apiVersion] = await Promise.all([
      readWebVersion(origin, fetchImpl),
      readVersion(origin, fetchImpl),
    ]);
    homeServing =
      webVersion === expectedVersion &&
      apiVersion === expectedVersion &&
      // oxlint-disable-next-line no-await-in-loop -- Polling waits for the rollout.
      (await homeIsServing(origin, fetchImpl));
    if (homeServing) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop -- Polling waits for the rollout.
    await sleep(intervalMs);
  }
  if (webVersion !== expectedVersion) {
    throw new Error(
      `${origin}/version served ${webVersion ?? "no version"}, expected ${expectedVersion}`
    );
  }
  if (apiVersion !== expectedVersion) {
    throw new Error(
      `${origin} API served ${apiVersion ?? "no healthy response"}, expected ${expectedVersion}`
    );
  }
  if (!homeServing) {
    throw new Error(`${origin}/ never returned 200`);
  }
  process.stdout.write(`${origin} serves ${expectedVersion}\n`);
};

if (import.meta.main) {
  const [origin, expectedVersion] = process.argv.slice(2);
  if (origin === undefined || expectedVersion === undefined) {
    throw new Error("Usage: verify-deployment.ts <origin> <commit-sha>");
  }
  await verifyDeployment(origin.replace(/\/$/u, ""), expectedVersion);
}
