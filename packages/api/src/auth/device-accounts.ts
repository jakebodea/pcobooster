/**
 * Accounts that signed in on this browser, resumable without another Planning Center round trip.
 *
 * Each sign-in also stores its session token in a signed, HTTP-only cookie keyed by user. Leaving
 * an account (the app's "Sign out") clears only the active session cookie, so the sign-in page can
 * list the account and resume its still-valid session with one click. Forgetting an account deletes
 * its session. Sessions keep their normal expiry, so a stale account falls back to Planning Center.
 */
import type { Db } from "@pcobooster/api/db/client";
import {
  account,
  planningCenterAccountIdentities,
} from "@pcobooster/api/db/schema";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import {
  deleteSessionCookie,
  expireCookie,
  parseCookies,
  setSessionCookie,
} from "better-auth/cookies";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

export const MAX_DEVICE_ACCOUNTS = 4;

const DEVICE_COOKIE_MARKER = "_device-";
/** Better Auth lowercases nothing here, but user ids are opaque; keep cookie names safe. */
const COOKIE_SAFE_USER_ID = /^[\w-]+$/u;

export interface DeviceAccount {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  organizationName: string | null;
  lastActiveAt: string;
}

const sessionTokenSchema = z.string().min(1);

const userBodySchema = z.object({
  userId: z.string().regex(COOKIE_SAFE_USER_ID),
});

type EndpointContext = Parameters<
  Parameters<typeof createAuthMiddleware>[0]
>[0];

const deviceCookieName = (ctx: EndpointContext, userId: string): string =>
  `${ctx.context.authCookies.sessionToken.name}${DEVICE_COOKIE_MARKER}${userId}`;

/** Signed session tokens this browser holds, by user id. */
const readDeviceTokens = async (
  ctx: EndpointContext
): Promise<Map<string, string>> => {
  const tokens = new Map<string, string>();
  const cookieHeader = ctx.headers?.get("cookie");
  if (cookieHeader === null || cookieHeader === undefined) {
    return tokens;
  }
  const names = [...parseCookies(cookieHeader).keys()].filter((name) =>
    name.includes(DEVICE_COOKIE_MARKER)
  );
  const verified = await Promise.all(
    names.map(async (name) => ({
      userId: name.slice(
        name.indexOf(DEVICE_COOKIE_MARKER) + DEVICE_COOKIE_MARKER.length
      ),
      token: await ctx.getSignedCookie(name, ctx.context.secret),
    }))
  );
  for (const { userId, token } of verified) {
    // A tampered or unsigned cookie verifies to null (or false).
    const parsed = sessionTokenSchema.safeParse(token);
    if (parsed.success) {
      tokens.set(userId, parsed.data);
    }
  }
  return tokens;
};

const forgetDeviceCookie = (ctx: EndpointContext, userId: string): void => {
  expireCookie(ctx, {
    name: deviceCookieName(ctx, userId),
    attributes: ctx.context.authCookies.sessionToken.attributes,
  });
};

const findDeviceSession = async (ctx: EndpointContext, userId: string) => {
  const tokens = await readDeviceTokens(ctx);
  const token = tokens.get(userId);
  if (token === undefined) {
    return null;
  }
  const found = await ctx.context.internalAdapter.findSession(token);
  if (
    found === null ||
    found.user.id !== userId ||
    found.session.expiresAt.getTime() <= Date.now()
  ) {
    return null;
  }
  return found;
};

const organizationNamesByUser = async (
  database: Db,
  userIds: readonly string[]
): Promise<Map<string, string>> => {
  if (userIds.length === 0) {
    return new Map();
  }
  const rows = await database
    .select({
      userId: account.userId,
      organizationName: planningCenterAccountIdentities.organizationName,
    })
    .from(planningCenterAccountIdentities)
    .innerJoin(
      account,
      eq(account.id, planningCenterAccountIdentities.accountId)
    )
    .where(inArray(account.userId, [...userIds]))
    .orderBy(desc(planningCenterAccountIdentities.updatedAt));
  const names = new Map<string, string>();
  for (const row of rows) {
    if (row.organizationName !== null && !names.has(row.userId)) {
      names.set(row.userId, row.organizationName);
    }
  }
  return names;
};

export const deviceAccounts = (database: Db) =>
  ({
    id: "device-accounts",
    endpoints: {
      listDeviceAccounts: createAuthEndpoint(
        "/device-accounts/list",
        { method: "GET", requireHeaders: true },
        async (ctx) => {
          const tokens = await readDeviceTokens(ctx);
          if (tokens.size === 0) {
            const none: DeviceAccount[] = [];
            return await ctx.json({ accounts: none });
          }
          const found = await ctx.context.internalAdapter.findSessions(
            [...tokens.values()],
            { onlyActiveSessions: true }
          );
          const now = Date.now();
          const live = found
            .filter(
              (entry) =>
                entry.session.expiresAt.getTime() > now &&
                tokens.get(entry.user.id) === entry.session.token
            )
            .toSorted(
              (a, b) =>
                b.session.updatedAt.getTime() - a.session.updatedAt.getTime()
            )
            .slice(0, MAX_DEVICE_ACCOUNTS);
          const organizations = await organizationNamesByUser(
            database,
            live.map((entry) => entry.user.id)
          );
          const accounts: DeviceAccount[] = live.map((entry) => ({
            userId: entry.user.id,
            name: entry.user.name,
            email: entry.user.email,
            image: entry.user.image ?? null,
            organizationName: organizations.get(entry.user.id) ?? null,
            lastActiveAt: entry.session.updatedAt.toISOString(),
          }));
          return await ctx.json({ accounts });
        }
      ),
      resumeDeviceAccount: createAuthEndpoint(
        "/device-accounts/resume",
        { method: "POST", body: userBodySchema, requireHeaders: true },
        async (ctx) => {
          const found = await findDeviceSession(ctx, ctx.body.userId);
          if (found === null) {
            forgetDeviceCookie(ctx, ctx.body.userId);
            return await ctx.json({ resumed: false });
          }
          await setSessionCookie(ctx, found);
          return await ctx.json({ resumed: true });
        }
      ),
      forgetDeviceAccount: createAuthEndpoint(
        "/device-accounts/forget",
        { method: "POST", body: userBodySchema, requireHeaders: true },
        async (ctx) => {
          const tokens = await readDeviceTokens(ctx);
          const token = tokens.get(ctx.body.userId);
          if (token !== undefined) {
            await ctx.context.internalAdapter.deleteSession(token);
          }
          forgetDeviceCookie(ctx, ctx.body.userId);
          return await ctx.json({ status: true });
        }
      ),
      leaveDeviceAccount: createAuthEndpoint(
        "/device-accounts/leave",
        { method: "POST", requireHeaders: true },
        async (ctx) => {
          // Only the active cookies; the session stays resumable from this browser.
          deleteSessionCookie(ctx);
          return await ctx.json({ status: true });
        }
      ),
    },
    hooks: {
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            const created = ctx.context.newSession;
            if (!created || !COOKIE_SAFE_USER_ID.test(created.user.id)) {
              return;
            }
            await ctx.setSignedCookie(
              deviceCookieName(ctx, created.user.id),
              created.session.token,
              ctx.context.secret,
              ctx.context.authCookies.sessionToken.attributes
            );
          }),
        },
        {
          // A full sign-out forgets the account on this browser too.
          matcher: (context) => context.path === "/sign-out",
          handler: createAuthMiddleware(async (ctx) => {
            const signedOutToken = await ctx.getSignedCookie(
              ctx.context.authCookies.sessionToken.name,
              ctx.context.secret
            );
            for (const [userId, token] of await readDeviceTokens(ctx)) {
              if (token === signedOutToken) {
                forgetDeviceCookie(ctx, userId);
              }
            }
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin;
