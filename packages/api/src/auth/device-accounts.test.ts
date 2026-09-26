import { createAuth } from "@pcobooster/api/auth";
import { createDatabase } from "@pcobooster/api/db/client";
import {
  account,
  planningCenterAccountIdentities,
  session,
  user,
} from "@pcobooster/api/db/schema";
import { testServerConfig } from "@pcobooster/api/testing/server";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createLocalD1 } from "../../../../scripts/database/local-d1";

const { runtime, binding } = await createLocalD1("device-accounts-tests");
const database = createDatabase(binding);
const secret = "pcobooster-unit-test-secret-with-no-production-access";
const origin = testServerConfig().publicOrigin;
const now = new Date();
const inOneDay = new Date(Date.now() + 86_400_000);
const listSchema = z.object({
  accounts: z.array(
    z.object({ userId: z.string(), organizationName: z.string().nullable() })
  ),
});
const SESSION_COOKIE = "better-auth.session_token";

const signed = async (value: string): Promise<string> =>
  encodeURIComponent(`${value}.${await makeSignature(value, secret)}`);

const deviceCookie = async (userId: string, token: string): Promise<string> =>
  `${SESSION_COOKIE}_device-${userId}=${await signed(token)}`;

const call = async (
  path: string,
  cookie: string,
  body?: Record<string, string>
): Promise<Response> => {
  const auth = createAuth(testServerConfig(), database);
  return await auth.handler(
    new Request(`${origin}/api/auth${path}`, {
      method: body === undefined && path.endsWith("/list") ? "GET" : "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
};

const seedUser = async (id: string, token: string, expiresAt: Date) => {
  await database.insert(user).values({
    id,
    name: `User ${id}`,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(account).values({
    id: `${id}-account`,
    accountId: `${id}-provider`,
    providerId: "planning-center",
    userId: id,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(planningCenterAccountIdentities).values({
    accountId: `${id}-account`,
    providerAccountId: `${id}-provider`,
    organizationName: `${id} Church`,
    fetchedAt: now,
  });
  await database.insert(session).values({
    id: `${id}-session`,
    token,
    userId: id,
    expiresAt,
    updatedAt: now,
  });
};

describe("device accounts", () => {
  beforeAll(async () => {
    await seedUser("alice", "alice-token", inOneDay);
    await seedUser("bob", "bob-token", new Date(Date.now() - 1000));
    await seedUser("carol", "carol-token", inOneDay);
  });

  afterAll(async () => {
    await runtime.dispose();
  });

  it("lists only live, correctly signed sessions this browser holds", async () => {
    const cookie = [
      await deviceCookie("alice", "alice-token"),
      await deviceCookie("bob", "bob-token"),
      // Forged: signed value belongs to someone else's cookie name.
      await deviceCookie("mallory", "carol-token"),
      `${SESSION_COOKIE}_device-carol=carol-token.not-a-signature`,
    ].join("; ");
    const response = await call("/device-accounts/list", cookie);
    expect(response.status).toBe(200);
    const { accounts } = listSchema.parse(await response.json());
    expect(accounts).toStrictEqual([
      expect.objectContaining({
        userId: "alice",
        organizationName: "alice Church",
      }),
    ]);
  });

  it("resumes a live session by setting the active session cookie", async () => {
    const response = await call(
      "/device-accounts/resume",
      await deviceCookie("alice", "alice-token"),
      { userId: "alice" }
    );
    await expect(response.json()).resolves.toStrictEqual({ resumed: true });
    expect(response.headers.get("set-cookie")).toContain(
      `${SESSION_COOKIE}=alice-token.`
    );
  });

  it("refuses to resume an expired session and forgets it", async () => {
    const response = await call(
      "/device-accounts/resume",
      await deviceCookie("bob", "bob-token"),
      { userId: "bob" }
    );
    await expect(response.json()).resolves.toStrictEqual({ resumed: false });
    expect(response.headers.get("set-cookie")).toContain(
      `${SESSION_COOKIE}_device-bob=;`
    );
  });

  it("leaving keeps the session but clears the active cookie", async () => {
    const response = await call(
      "/device-accounts/leave",
      `${SESSION_COOKIE}=${await signed("carol-token")}; ${await deviceCookie("carol", "carol-token")}`,
      {}
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
    const rows = await database
      .select()
      .from(session)
      .where(eq(session.token, "carol-token"));
    expect(rows).toHaveLength(1);
  });

  it("forgetting deletes the session", async () => {
    await call(
      "/device-accounts/forget",
      await deviceCookie("carol", "carol-token"),
      { userId: "carol" }
    );
    const rows = await database
      .select()
      .from(session)
      .where(eq(session.token, "carol-token"));
    expect(rows).toHaveLength(0);
  });
});
