import { deviceAccounts } from "@pcobooster/api/auth/device-accounts";
import { getPlanningCenterIdentityFromAccessToken } from "@pcobooster/api/auth/planning-center-identity";
import { createPreviewProxy } from "@pcobooster/api/auth/preview-proxy";
import { parseSignInFailure } from "@pcobooster/api/auth/sign-in-failure";
import type { ServerConfig } from "@pcobooster/api/config/server-config";
import {
  getActivityRequestContext,
  recordActivityEvent,
} from "@pcobooster/api/db/activity-events";
import type { Db } from "@pcobooster/api/db/client";
import * as schema from "@pcobooster/api/db/schema";
import { logger } from "@pcobooster/api/logger";
import { upsertPlanningCenterAccountIdentity } from "@pcobooster/api/modules/admin/planning-center-account-identities";
import type { PostHogPersonProperties } from "@pcobooster/api/modules/analytics/posthog-capture";
import { getPostHogPersonProperties } from "@pcobooster/api/modules/analytics/posthog-person";
import type { JsonObject } from "@pcobooster/planning-center-models/json";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { genericOAuth } from "better-auth/plugins/generic-oauth";

const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;

const shouldTrackSessionDeletion = (
  context: Parameters<typeof getActivityRequestContext>[0]
): boolean => {
  const requestContext = getActivityRequestContext(context);
  if (!(requestContext.path !== null && requestContext.path !== "")) {
    return false;
  }

  return (
    requestContext.path.includes("/sign-out") ||
    requestContext.path.includes("/revoke-session") ||
    requestContext.path.includes("/revoke-sessions")
  );
};

export const createAuth = (config: ServerConfig, database: Db) => {
  const authEventLog = logger.for("auth/events");
  const { cookieDomain, planningCenter, previewOriginPattern, proxy } =
    config.auth;

  const trustedOrigins = [
    ...(previewOriginPattern === null ? [] : [previewOriginPattern]),
    config.publicOrigin,
    ...(config.localDevelopment
      ? ["http://localhost:3001", "http://127.0.0.1:3001"]
      : []),
  ];

  const recordAuthEventSafely = async (
    eventType:
      | "auth_session_created"
      | "auth_session_deleted"
      | "auth_account_linked"
      | "auth_sign_in_failed",
    payload: {
      userId?: string | null;
      accountId?: string | null;
      metadata?: JsonObject;
      errorCode?: string | null;
      person?: PostHogPersonProperties | null;
      context: Parameters<typeof getActivityRequestContext>[0];
    }
  ) => {
    try {
      const requestContext = getActivityRequestContext(payload.context);
      await recordActivityEvent(
        { database, config },
        {
          eventType,
          actorUserId: payload.userId ?? null,
          actorAccountId: payload.accountId ?? null,
          requestId: requestContext.requestId,
          path: requestContext.path,
          method: requestContext.method,
          ipAddress: requestContext.ipAddress,
          userAgent: requestContext.userAgent,
          success:
            payload.errorCode === undefined || payload.errorCode === null,
          statusCode: 200,
          errorCode: payload.errorCode ?? null,
          metadata: payload.metadata ?? null,
        },
        payload.person ?? null
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      authEventLog.warn(
        { err, eventType },
        "Failed to record auth activity event"
      );
    }
  };

  const getPostHogPersonSafely = async (
    userId: string
  ): Promise<PostHogPersonProperties | null> => {
    try {
      return await getPostHogPersonProperties(userId, database);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      authEventLog.warn({ err }, "Failed to load PostHog person properties");
      return null;
    }
  };

  const getPlanningCenterIdentitySafely = async (account: {
    id: string;
    accountId: string;
    accessToken?: string | null;
  }) => {
    try {
      const identity = await getPlanningCenterIdentityFromAccessToken(
        account.accessToken
      );
      if (identity) {
        await upsertPlanningCenterAccountIdentity(
          {
            accountId: account.id,
            providerAccountId: account.accountId,
            identity,
          },
          database
        );
      }
      return identity;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      authEventLog.warn(
        { err, accountId: account.id },
        "Failed to record Planning Center account identity"
      );
      return null;
    }
  };

  return betterAuth({
    baseURL: config.publicOrigin,
    secret: config.auth.secret,
    trustedOrigins,
    advanced: {
      // A parent domain (`pcobooster.com`) lets the admin subdomain share the session.
      crossSubDomainCookies: {
        enabled: cookieDomain !== null,
        domain: cookieDomain ?? undefined,
      },
    },
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
      camelCase: true,
      transaction: false,
    }),
    session: {
      // Most requests check the session; a short-lived signed copy in a cookie saves the D1
      // lookup. A revoked session can stay valid on other devices for up to this long.
      cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["planning-center"],
        updateUserInfoOnLink: true,
        // Each Planning Center organization signs in as its own subject with the same email, and
        // its userinfo has no `email_verified` claim, so every user is stored unverified. Planning
        // Center is the only way to create a user here, so the local email is Planning Center's
        // own and linking another organization to it is safe.
        requireLocalEmailVerified: false,
      },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session, context) => {
            await recordAuthEventSafely("auth_session_created", {
              userId: session.userId,
              person: await getPostHogPersonSafely(session.userId),
              context,
            });
          },
        },
        delete: {
          after: async (session, context) => {
            if (!shouldTrackSessionDeletion(context)) {
              return;
            }

            await recordAuthEventSafely("auth_session_deleted", {
              userId: session.userId,
              metadata: {
                sessionId: session.id,
              },
              context,
            });
          },
        },
      },
      account: {
        create: {
          after: async (account, context) => {
            if (account.providerId !== "planning-center") {
              return;
            }

            const identity = await getPlanningCenterIdentitySafely(account);
            await recordAuthEventSafely("auth_account_linked", {
              userId: account.userId,
              accountId: account.id,
              metadata: {
                providerId: account.providerId,
                organizationId: identity?.organizationId ?? null,
                organizationName: identity?.organizationName ?? null,
                planningCenterUserId: identity?.sub ?? null,
              },
              context,
            });
          },
        },
      },
    },
    hooks: {
      // Better Auth reports a failed provider callback only as a `?error=` redirect.
      after: createAuthMiddleware(async (ctx) => {
        if (!ctx.path.startsWith("/callback/")) {
          return;
        }
        const failure = parseSignInFailure(
          ctx.context.responseHeaders?.get("location")
        );
        if (failure === null) {
          return;
        }
        authEventLog.warn(
          {
            code: failure.code,
            receivedCode: failure.receivedCode,
            description: failure.description,
          },
          "Planning Center sign-in failed"
        );
        await recordAuthEventSafely("auth_sign_in_failed", {
          errorCode: failure.receivedCode,
          metadata: { code: failure.code },
          context: ctx,
        });
      }),
    },
    socialProviders: {},
    plugins: [
      deviceAccounts(database),
      genericOAuth({
        config: [
          {
            providerId: "planning-center",
            discoveryUrl:
              "https://api.planningcenteronline.com/.well-known/openid-configuration",
            // Discovery runs once per server instance. Pinned endpoints keep the
            // provider registered when that fetch fails, instead of every
            // sign-in on the instance returning PROVIDER_NOT_FOUND.
            authorizationUrl:
              "https://api.planningcenteronline.com/oauth/authorize",
            tokenUrl: "https://api.planningcenteronline.com/oauth/token",
            userInfoUrl: "https://api.planningcenteronline.com/oauth/userinfo",
            clientId: planningCenter.clientId,
            clientSecret: planningCenter.clientSecret,
            scopes: ["openid", "services", "people"],
            // Force Planning Center to prompt for login so users can switch accounts/org context.
            prompt: "login",
            pkce: true,
            accessType: "offline",
            tokenEndpointAuth: { method: "client_secret_basic" },
            overrideUserInfo: true,
          },
        ],
      }),
      ...(proxy === null
        ? []
        : [
            createPreviewProxy({
              currentURL: config.publicOrigin,
              productionURL: proxy.productionUrl,
              secret: proxy.secret,
              production: config.production,
            }),
          ]),
    ],
  });
};

export type Auth = ReturnType<typeof createAuth>;
