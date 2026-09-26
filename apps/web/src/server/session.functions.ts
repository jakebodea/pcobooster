import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { getSessionCookie } from "better-auth/cookies";
import { env } from "cloudflare:workers";
import { z } from "zod";

import { createServerRpcClient } from "@/server/server-rpc";

/**
 * Whether the visitor's session is still valid. Signed-out visitors have no session cookie,
 * so they skip the API round trip.
 */
export const getSessionStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    setResponseHeader("Cache-Control", "private, no-store");
    const { headers } = getRequest();
    if (getSessionCookie(headers) === null) {
      return { authenticated: false };
    }
    const client = createServerRpcClient({
      api: env.API,
      cookie: headers.get("cookie") ?? undefined,
      productOrigin: env.PRODUCT_ORIGIN,
    });
    return await client.session.status({});
  }
);

const deviceAccountsSchema = z.object({
  accounts: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      email: z.string(),
      image: z.string().nullable(),
      organizationName: z.string().nullable(),
      lastActiveAt: z.string(),
    })
  ),
});

export type DeviceAccount = z.infer<
  typeof deviceAccountsSchema
>["accounts"][number];

/** Marks the signed cookies the API sets for accounts resumable from this browser. */
const DEVICE_ACCOUNT_COOKIE_MARKER = "_device-";

/**
 * Accounts this browser can resume without Planning Center, listed during SSR so the sign-in
 * page renders them on first paint. Browsers without device cookies skip the API call.
 */
export const getDeviceAccounts = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ accounts: DeviceAccount[]; now: number }> => {
    const now = Date.now();
    setResponseHeader("Cache-Control", "private, no-store");
    const cookie = getRequest().headers.get("cookie") ?? "";
    if (!cookie.includes(DEVICE_ACCOUNT_COOKIE_MARKER)) {
      return { accounts: [], now };
    }
    try {
      const response = await env.API.fetch(
        new Request(`${env.PRODUCT_ORIGIN}/api/auth/device-accounts/list`, {
          headers: { cookie },
        })
      );
      if (!response.ok) {
        return { accounts: [], now };
      }
      const parsed = deviceAccountsSchema.safeParse(await response.json());
      return { accounts: parsed.success ? parsed.data.accounts : [], now };
    } catch {
      // The sign-in button still works; quick access is a convenience.
      return { accounts: [], now };
    }
  }
);
