import { createHash } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

import { PlanningCenterAccounting } from "@pcobooster/api/planning-center/accounting";
import {
  PlanningCenterCoreClient,
  createBasicPlanningCenterClient,
} from "@pcobooster/api/planning-center/core-client";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import { PlanningCenterPacing } from "@pcobooster/api/planning-center/pacing";
import { PlanningCenterRatePacer } from "@pcobooster/api/planning-center/rate-pacer";
import { PlanningCenterRequestAccounting } from "@pcobooster/api/planning-center/request-accounting";
import type {
  PlanningCenterLogFields,
  PlanningCenterLogger,
} from "@pcobooster/api/planning-center/request-accounting";
import { httpClientFor } from "@pcobooster/api/testing/http-client";
import { testPlanningCenterToken } from "@pcobooster/api/testing/server";
import type { JsonValue } from "@pcobooster/planning-center-models/json";
import { Cause, Clock, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vitest";

type FetchMock = ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

const jsonResponse = (body: JsonValue, init?: ResponseInit): Response =>
  Response.json(body, init);
const person = { id: "1", type: "Person", attributes: { name: "Alex" } };

const fetchMock = (): FetchMock => vi.fn<typeof globalThis.fetch>();

const basicClient = (fetch: FetchMock): PlanningCenterCoreClient =>
  createBasicPlanningCenterClient(
    testPlanningCenterToken,
    httpClientFor(fetch)
  );

const basicCacheScope = (secret: string): string =>
  new PlanningCenterCoreClient(
    { kind: "basic", applicationId: "client", secret },
    { httpClient: httpClientFor(fetchMock()) }
  ).getCacheScope();

const run = async <Value>(
  effect: Effect.Effect<Value, PlanningCenterError>
): Promise<Value> => await Effect.runPromise(effect);

const failureOf = async <Value>(
  effect: Effect.Effect<Value, PlanningCenterError>
): Promise<PlanningCenterError | undefined> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return undefined;
  }
  return exit.cause.reasons.find(Cause.isFailReason)?.error;
};

const urlOf = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : input.toString();

const isInterrupted = <Value, Failure>(
  exit: Exit.Exit<Value, Failure>
): boolean => Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause);

const requestHeaders = (fetch: FetchMock, call = 0): Headers =>
  new Headers(fetch.mock.calls[call]?.[1]?.headers);

/** Resolves once the request is aborted, like `fetch` does. */
const hangUntilAborted: typeof globalThis.fetch = async (_input, init) => {
  const signal = init?.signal;
  if (signal) {
    await once(signal, "abort");
  }
  throw new DOMException("The operation was aborted", "AbortError");
};

/** Lets mocked fetch promises and body reads settle before the test clock moves. */
const settle = Effect.promise(async () => {
  await delay(20);
});

describe(PlanningCenterCoreClient, () => {
  it("binds bearer requests and cache scope to the constructor credential", async () => {
    const fetch = fetchMock().mockResolvedValue(jsonResponse({ data: person }));
    const client = new PlanningCenterCoreClient(
      { kind: "bearer", accessToken: "selected-account-token" },
      { httpClient: httpClientFor(fetch) }
    );
    await run(client.fetch("/services/v2/people/1"));
    const headers = requestHeaders(fetch);
    expect(headers.get("Authorization")).toBe("Bearer selected-account-token");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.has("traceparent")).toBeFalsy();
    expect(client.getCacheScope()).toBe(
      `bearer:${createHash("sha256").update("selected-account-token").digest("hex")}`
    );
  });

  it.each(["", "   "])("rejects empty bearer credential %j", (accessToken) => {
    expect(
      () =>
        new PlanningCenterCoreClient(
          { kind: "bearer", accessToken },
          { httpClient: httpClientFor(fetchMock()) }
        )
    ).toThrow("requires a non-empty access token");
  });

  it("uses application credentials only with the explicit Basic factory", async () => {
    const fetch = fetchMock().mockResolvedValue(jsonResponse({ data: person }));
    const client = createBasicPlanningCenterClient(
      { applicationId: "client", secret: "pat" },
      httpClientFor(fetch)
    );
    await run(client.fetch("/services/v2/people/1"));
    expect(requestHeaders(fetch).get("Authorization")).toBe(
      `Basic ${Buffer.from("client:pat").toString("base64")}`
    );
    expect(client.getCacheScope()).toBe(
      `basic:${createHash("sha256").update("client:pat").digest("hex")}`
    );
  });

  it("isolates cache scopes between personal access tokens", () => {
    expect(basicCacheScope("demo-pat")).not.toBe(basicCacheScope("pat"));
  });

  it("sends a JSON body with a write", async () => {
    const fetch = fetchMock().mockResolvedValue(jsonResponse({ data: person }));
    await run(
      basicClient(fetch).fetch("/services/v2/people", {
        method: "POST",
        body: { data: { type: "Person" } },
      })
    );
    const init = fetch.mock.calls[0]?.[1];
    const body = init?.body;
    expect(init?.method).toBe("POST");
    expect(
      body instanceof Uint8Array ? new TextDecoder().decode(body) : body
    ).toBe(JSON.stringify({ data: { type: "Person" } }));
    expect(requestHeaders(fetch).get("Content-Type")).toBe("application/json");
  });

  it("rejects writes from a read-only client before they reach Planning Center", async () => {
    const fetch = fetchMock().mockResolvedValue(jsonResponse({ data: person }));
    const client = new PlanningCenterCoreClient(
      { kind: "basic", applicationId: "demo", secret: "demo-pat" },
      { httpClient: httpClientFor(fetch), readOnly: true }
    );

    await expect(
      failureOf(
        client.fetch("/services/v2/people/1", { method: "PATCH", body: {} })
      )
    ).resolves.toMatchObject({
      _tag: "PlanningCenterReadOnlyError",
      method: "PATCH",
      path: "/services/v2/people/1",
    });
    await expect(
      failureOf(
        client.request("/services/v2/plan_times/1", { method: "DELETE" })
      )
    ).resolves.toMatchObject({ _tag: "PlanningCenterReadOnlyError" });
    expect(fetch).not.toHaveBeenCalled();

    await expect(
      run(client.fetch("/services/v2/people/1"))
    ).resolves.toMatchObject({ data: person });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("accepts empty writes through the transport method", async () => {
    const fetch = fetchMock().mockResolvedValue(
      new Response(null, { status: 204 })
    );
    const response = await run(
      basicClient(fetch).request("/services/v2/plan_times/1", {
        method: "DELETE",
      })
    );
    expect(response.status).toBe(204);
  });

  it("rejects an empty response where a JSON resource is required", async () => {
    const fetch = fetchMock().mockResolvedValue(
      new Response(null, { status: 204 })
    );
    await expect(
      failureOf(basicClient(fetch).fetch("/services/v2/people/1"))
    ).resolves.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([200, 503])(
    "classifies a failed %i response body stream as a provider network failure",
    async (status) => {
      const fetch = fetchMock().mockImplementation(
        async () =>
          await Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new TypeError("body stream failed"));
                },
              }),
              { status }
            )
          )
      );

      await expect(
        failureOf(basicClient(fetch).fetch("/services/v2/people/1"))
      ).resolves.toMatchObject({
        _tag: "PlanningCenterNetworkError",
        cause: { message: "body stream failed" },
      });
      expect(fetch).toHaveBeenCalledOnce();
    }
  );

  it("rejects malformed resource identifiers before they enter service code", async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse({ data: { id: 1, type: "Person" } })
    );
    await expect(
      failureOf(basicClient(fetch).fetch("/services/v2/people/1"))
    ).resolves.toMatchObject({
      _tag: "PlanningCenterApiError",
      code: "INVALID_RESPONSE",
    });
  });

  it("normalizes a singleton collection and preserves null relationships", async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse({
        data: { ...person, relationships: { team: { data: null } } },
        links: { next: null },
      })
    );
    const response = await run(
      basicClient(fetch).fetchCollection("/services/v2/people")
    );
    expect(response.data).toStrictEqual([
      { ...person, relationships: { team: { data: null } } },
    ]);
    expect(response.links?.next).toBeUndefined();
  });

  it("accepts an absent relationship URL in schedule collections", async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse({
        data: [
          {
            type: "Schedule",
            id: "schedule-1",
            relationships: { plan_times: { links: { related: null } } },
          },
        ],
      })
    );
    const response = await run(
      basicClient(fetch).fetchCollection("/services/v2/people/me/schedules")
    );
    expect(response.data).toStrictEqual([
      {
        type: "Schedule",
        id: "schedule-1",
        attributes: {},
        relationships: { plan_times: { links: { related: undefined } } },
      },
    ]);
  });

  it("follows pagination once per URL and deduplicates included resources", async () => {
    const firstUrl =
      "https://api.planningcenteronline.com/services/v2/people?per_page=100";
    const secondUrl =
      "https://api.planningcenteronline.com/services/v2/people?offset=100";
    const team = { type: "Team", id: "team-1", attributes: { name: "Band" } };
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [person],
          included: [team],
          links: { next: secondUrl },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ ...person, id: "2" }],
          included: [team],
          links: { next: firstUrl },
        })
      );
    const response = await run(
      basicClient(fetch).fetchAllWithIncluded("/services/v2/people")
    );
    expect(response.data.map((item) => item.id)).toStrictEqual(["1", "2"]);
    expect(response.included).toStrictEqual([team]);
    expect(fetch.mock.calls.map(([input]) => urlOf(input))).toStrictEqual([
      firstUrl,
      secondUrl,
    ]);
  });

  it("stops pagination and aborts the in-flight page when interrupted", async () => {
    const controller = new AbortController();
    const nextUrl =
      "https://api.planningcenteronline.com/services/v2/people?offset=100";
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({ data: [person], links: { next: nextUrl } })
      )
      .mockImplementationOnce(async (input, init) => {
        controller.abort();
        return await hangUntilAborted(input, init);
      });

    const exit = await Effect.runPromiseExit(
      basicClient(fetch).fetchAllWithIncluded("/services/v2/people"),
      { signal: controller.signal }
    );
    expect(isInterrupted(exit)).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]?.signal?.aborted).toBeTruthy();
  });

  it("retries a transient GET failure after a backoff", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({ error: "Temporarily unavailable" }, { status: 503 })
      )
      .mockResolvedValueOnce(jsonResponse({ data: person }));
    const result = await Effect.runPromise(
      Effect.gen(function* retryAfterBackoff() {
        const fiber = yield* Effect.forkChild(
          basicClient(fetch).fetch("/services/v2/people/1")
        );
        yield* settle;
        yield* TestClock.adjust("499 millis");
        expect(fetch).toHaveBeenCalledOnce();
        yield* TestClock.adjust("1 millis");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(result.data.id).toBe("1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("waits for Retry-After before retrying a rate-limited read", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "Rate limited" },
          { status: 429, headers: { "retry-after": "2" } }
        )
      )
      .mockResolvedValueOnce(jsonResponse({ data: person }));
    await Effect.runPromise(
      Effect.gen(function* retryAfterRateLimit() {
        const fiber = yield* Effect.forkChild(
          basicClient(fetch).fetch("/services/v2/people/1")
        );
        yield* settle;
        yield* TestClock.adjust("1999 millis");
        expect(fetch).toHaveBeenCalledOnce();
        yield* TestClock.adjust("1 millis");
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up on a read after two retries", async () => {
    const fetch = fetchMock().mockImplementation(
      async () =>
        await Promise.resolve(
          jsonResponse({ error: "Temporarily unavailable" }, { status: 503 })
        )
    );
    const failure = await Effect.runPromise(
      Effect.gen(function* exhaustRetries() {
        const fiber = yield* Effect.forkChild(
          Effect.flip(basicClient(fetch).fetch("/services/v2/people/1"))
        );
        yield* settle;
        yield* TestClock.adjust("500 millis");
        yield* settle;
        yield* TestClock.adjust("1000 millis");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(failure).toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("times out a stalled read attempt and retries it", async () => {
    const fetch = fetchMock()
      .mockImplementationOnce(hangUntilAborted)
      .mockResolvedValueOnce(jsonResponse({ data: person }));
    await Effect.runPromise(
      Effect.gen(function* retryTimedOutAttempt() {
        const fiber = yield* Effect.forkChild(
          basicClient(fetch).fetch("/services/v2/people/1")
        );
        yield* settle;
        yield* TestClock.adjust("15 seconds");
        yield* settle;
        expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBeTruthy();
        yield* TestClock.adjust("300 millis");
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a write after a transient error", async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse({ error: "Temporarily unavailable" }, { status: 503 })
    );
    await expect(
      failureOf(
        basicClient(fetch).fetch("/services/v2/people", {
          method: "POST",
          body: {},
        })
      )
    ).resolves.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("labels fetch failures and malformed provider responses", async () => {
    const fetch = fetchMock()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(
        new Response("not json", {
          headers: { "content-type": "application/json" },
        })
      );
    const client = basicClient(fetch);
    await expect(
      failureOf(client.fetch("/services/v2/people/1"))
    ).resolves.toMatchObject({
      _tag: "PlanningCenterNetworkError",
      cause: { message: "network unavailable" },
    });
    await expect(
      failureOf(client.fetch("/services/v2/people/2"))
    ).resolves.toMatchObject({
      _tag: "PlanningCenterApiError",
      code: "INVALID_RESPONSE",
    });
  });

  it("stops an in-flight read without retrying when interrupted", async () => {
    const controller = new AbortController();
    const fetch = fetchMock().mockImplementation(async (input, init) => {
      controller.abort();
      return await hangUntilAborted(input, init);
    });
    const exit = await Effect.runPromiseExit(
      basicClient(fetch).fetch("/services/v2/people/1"),
      { signal: controller.signal }
    );
    expect(isInterrupted(exit)).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
  });
});

interface LoggedLine {
  readonly level: "info" | "warn";
  readonly message: string;
  readonly fields: PlanningCenterLogFields;
}

const recordingLogger = () => {
  const lines: LoggedLine[] = [];
  const logger: PlanningCenterLogger = {
    info: (fields, message) => {
      lines.push({ level: "info", message, fields });
    },
    warn: (fields, message) => {
      lines.push({ level: "warn", message, fields });
    },
  };
  return { lines, logger };
};

const rateLimitedResponse = (count: number): Response =>
  jsonResponse(
    { data: person },
    {
      headers: {
        "x-pco-api-request-rate-limit": "100",
        "x-pco-api-request-rate-count": String(count),
        "x-pco-api-request-rate-period": "20 seconds",
      },
    }
  );

interface Limits {
  readonly pacer: PlanningCenterRatePacer;
  readonly accounting: PlanningCenterRequestAccounting;
}

const limits = (
  accounting = new PlanningCenterRequestAccounting(),
  pacer = new PlanningCenterRatePacer()
): Limits => ({ pacer, accounting });

const withLimits =
  ({ pacer, accounting }: Limits) =>
  <Value, Failure>(
    effect: Effect.Effect<Value, Failure>
  ): Effect.Effect<Value, Failure> =>
    effect.pipe(
      Effect.provideService(PlanningCenterPacing, pacer),
      Effect.provideService(PlanningCenterAccounting, accounting)
    );

const pacedClient = (
  fetch: FetchMock,
  logger: PlanningCenterLogger
): PlanningCenterCoreClient =>
  new PlanningCenterCoreClient(
    { kind: "bearer", accessToken: "paced-account-token" },
    { httpClient: httpClientFor(fetch), logger }
  );

describe("Planning Center pacing and accounting", () => {
  it("spreads concurrent reads over the rest of the reported window", async () => {
    const fetch = fetchMock().mockImplementation(
      async () => await Promise.resolve(rateLimitedResponse(80))
    );
    const { lines, logger } = recordingLogger();
    const scope = limits();
    const client = pacedClient(fetch, logger);
    await Effect.runPromise(
      Effect.gen(function* paceConcurrentReads() {
        yield* client.fetch("/services/v2/people/1");
        const fiber = yield* Effect.forkChild(
          Effect.all(
            [
              client.fetch("/services/v2/people/2"),
              client.fetch("/services/v2/people/3"),
            ],
            { concurrency: "unbounded" }
          )
        );
        yield* settle;
        expect(fetch).toHaveBeenCalledTimes(2);
        // 20 requests left over 20 s: the next slot opens a second later.
        yield* TestClock.adjust("999 millis");
        yield* settle;
        expect(fetch).toHaveBeenCalledTimes(2);
        yield* TestClock.adjust("1 millis");
        yield* Fiber.join(fiber);
      }).pipe(withLimits(scope), Effect.provide(TestClock.layer()))
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(scope.accounting.totals).toStrictEqual({
      requests: 3,
      pacedRequests: 1,
      pacedWaitMs: 1000,
      rateLimited: 0,
      rateLimitRejections: 0,
      subrequestLimitHits: 0,
    });
    expect(lines).toStrictEqual([
      {
        level: "info",
        message: "Planning Center request paced",
        fields: {
          endpoint: { path: "/services/v2/people/3", queryKeys: [] },
          method: "GET",
          attempt: 1,
          waitMs: 1000,
          // In flight before this request: the other concurrent read.
          rateLimit: { limit: 100, count: 80, periodMs: 20_000, inFlight: 1 },
        },
      },
    ]);
  });

  it("fails fast on a 429 whose Retry-After exceeds the wait cap", async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse(
        { error: "Rate limited" },
        {
          status: 429,
          headers: {
            "retry-after": "30",
            "x-pco-api-request-rate-limit": "100",
            "x-pco-api-request-rate-count": "100",
            "x-pco-api-request-rate-period": "20 seconds",
          },
        }
      )
    );
    const { lines, logger } = recordingLogger();
    const scope = limits();
    const client = pacedClient(fetch, logger);

    await expect(
      failureOf(
        client.fetch("/services/v2/people?where[id]=1").pipe(withLimits(scope))
      )
    ).resolves.toMatchObject({
      _tag: "PlanningCenterApiError",
      status: 429,
      retryAfterSeconds: 30,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(lines).toStrictEqual([
      {
        level: "info",
        message: "Planning Center rate limited a request",
        fields: {
          endpoint: { path: "/services/v2/people", queryKeys: ["where[id]"] },
          method: "GET",
          attempt: 1,
          retryAfterSeconds: 30,
          rateLimit: {
            limit: 100,
            count: 100,
            period: "20 seconds",
            retryAfterSeconds: 30,
          },
          willRetry: false,
        },
      },
    ]);

    // The credential stays blocked, so the next read is refused without a request.
    await expect(
      failureOf(client.fetch("/services/v2/people/2").pipe(withLimits(scope)))
    ).resolves.toMatchObject({
      _tag: "PlanningCenterRateLimitError",
      retryAfterSeconds: 30,
    });
    expect({
      fetches: fetch.mock.calls.length,
      totals: scope.accounting.totals,
      lastLine: lines.at(-1)?.message,
    }).toMatchObject({
      fetches: 1,
      totals: { requests: 1, rateLimited: 1, rateLimitRejections: 1 },
      lastLine: "Planning Center request rejected: rate limit budget is spent",
    });
  });

  it("holds a speculative read back without sending it once the window is mostly used", async () => {
    const fetch = fetchMock().mockImplementation(
      async () =>
        await Promise.resolve(
          jsonResponse(
            { data: person },
            {
              headers: {
                "x-pco-api-request-rate-limit": "100",
                "x-pco-api-request-rate-count": "45",
                "x-pco-api-request-rate-period": "20 seconds",
              },
            }
          )
        )
    );
    const { lines, logger } = recordingLogger();
    const pacer = new PlanningCenterRatePacer();
    const client = pacedClient(fetch, logger);
    const interactive = limits(new PlanningCenterRequestAccounting(), pacer);
    const speculative = limits(
      new PlanningCenterRequestAccounting({ priority: "speculative" }),
      pacer
    );

    await Effect.runPromise(
      client.fetch("/services/v2/people/1").pipe(withLimits(interactive))
    );
    await expect(
      failureOf(
        client.fetch("/services/v2/people/2").pipe(withLimits(speculative))
      )
    ).resolves.toMatchObject({
      _tag: "PlanningCenterRateLimitError",
      reason: "speculative",
    });
    // The same read from an interactive procedure still goes out.
    await Effect.runPromise(
      client.fetch("/services/v2/people/2").pipe(withLimits(interactive))
    );
    expect({
      fetches: fetch.mock.calls.length,
      speculative: speculative.accounting.totals,
      lastLine: lines.at(-1),
    }).toMatchObject({
      fetches: 2,
      speculative: { requests: 0, rateLimitRejections: 1 },
      lastLine: {
        level: "info",
        message:
          "Planning Center speculative request held back: budget kept for interactive requests",
        fields: { priority: "speculative" },
      },
    });
  });

  it("does not release another read's slot when a speculative read is held back", async () => {
    const rateHeaders = {
      "x-pco-api-request-rate-limit": "100",
      "x-pco-api-request-rate-count": "45",
      "x-pco-api-request-rate-period": "20 seconds",
    };
    const { promise: pending, resolve: answerPending } =
      Promise.withResolvers<Response>();
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({ data: person }, { headers: rateHeaders })
      )
      .mockReturnValueOnce(pending);
    const { lines, logger } = recordingLogger();
    const pacer = new PlanningCenterRatePacer();
    const client = pacedClient(fetch, logger);
    const interactive = limits(new PlanningCenterRequestAccounting(), pacer);
    const speculative = limits(
      new PlanningCenterRequestAccounting({ priority: "speculative" }),
      pacer
    );

    await Effect.runPromise(
      client.fetch("/services/v2/people/1").pipe(withLimits(interactive))
    );
    const inFlightRead = Effect.runPromise(
      client.fetch("/services/v2/people/2").pipe(withLimits(interactive))
    );
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
    await expect(
      failureOf(
        client.fetch("/services/v2/people/3").pipe(withLimits(speculative))
      )
    ).resolves.toMatchObject({ reason: "speculative" });
    await expect(
      failureOf(
        client.fetch("/services/v2/people/4").pipe(withLimits(speculative))
      )
    ).resolves.toMatchObject({ reason: "speculative" });
    answerPending(jsonResponse({ data: person }, { headers: rateHeaders }));
    await inFlightRead;

    // Each held-back read still sees the one interactive read in flight.
    expect(
      lines.filter((line) => line.fields?.priority === "speculative")
    ).toMatchObject([
      { fields: { rateLimit: { inFlight: 1 } } },
      { fields: { rateLimit: { inFlight: 1 } } },
    ]);
  });

  it("retries a short Retry-After once, without pacing the retry again", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "Rate limited" },
          { status: 429, headers: { "retry-after": "2" } }
        )
      )
      .mockResolvedValueOnce(jsonResponse({ data: person }));
    const { lines, logger } = recordingLogger();
    const scope = limits();
    await Effect.runPromise(
      Effect.gen(function* retryShortRateLimit() {
        const fiber = yield* Effect.forkChild(
          pacedClient(fetch, logger).fetch("/services/v2/people/1")
        );
        yield* settle;
        yield* TestClock.adjust("2 seconds");
        yield* settle;
        expect(fetch).toHaveBeenCalledTimes(2);
        yield* Fiber.join(fiber);
      }).pipe(withLimits(scope), Effect.provide(TestClock.layer()))
    );
    expect(lines).toMatchObject([
      {
        message: "Planning Center rate limited a request",
        fields: { willRetry: true },
      },
    ]);
    expect(scope.accounting.totals).toMatchObject({
      requests: 2,
      rateLimited: 1,
      pacedRequests: 0,
    });
  });

  it("stops at the invocation's request budget", async () => {
    const fetch = fetchMock().mockImplementation(
      async () => await Promise.resolve(jsonResponse({ data: person }))
    );
    const { lines, logger } = recordingLogger();
    const scope = limits(
      new PlanningCenterRequestAccounting({ requestBudget: 1 })
    );
    const client = pacedClient(fetch, logger);

    await Effect.runPromise(
      client.fetch("/services/v2/people/1").pipe(withLimits(scope))
    );
    expect(scope.accounting.remainingBudget).toBe(0);
    await expect(
      failureOf(client.fetch("/services/v2/people/2").pipe(withLimits(scope)))
    ).resolves.toMatchObject({
      _tag: "PlanningCenterSubrequestLimitError",
      source: "budget",
      requests: 1,
      limit: 1,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(lines).toStrictEqual([
      {
        level: "info",
        message: "Planning Center request budget for this invocation is spent",
        fields: {
          endpoint: { path: "/services/v2/people/2", queryKeys: [] },
          method: "GET",
          requests: 1,
          requestBudget: 1,
        },
      },
    ]);
  });

  it("counts retries against the request budget and does not retry past it", async () => {
    const fetch = fetchMock().mockImplementation(
      async () =>
        await Promise.resolve(
          jsonResponse({ error: "Temporarily unavailable" }, { status: 503 })
        )
    );
    const { logger } = recordingLogger();
    const scope = limits(
      new PlanningCenterRequestAccounting({ requestBudget: 2 })
    );
    const failure = await Effect.runPromise(
      Effect.gen(function* retryUntilBudget() {
        const fiber = yield* Effect.forkChild(
          Effect.flip(pacedClient(fetch, logger).fetch("/services/v2/people/1"))
        );
        yield* settle;
        yield* TestClock.adjust("500 millis");
        yield* settle;
        yield* TestClock.adjust("1 second");
        yield* settle;
        return yield* Fiber.join(fiber);
      }).pipe(withLimits(scope), Effect.provide(TestClock.layer()))
    );
    expect({
      failure: {
        tag: failure._tag,
        source: "source" in failure ? failure.source : undefined,
      },
      sent: fetch.mock.calls.length,
      requests: scope.accounting.requestCount,
    }).toStrictEqual({
      failure: { tag: "PlanningCenterSubrequestLimitError", source: "budget" },
      sent: 2,
      requests: 2,
    });
  });

  it("reports Cloudflare's subrequest cap distinctly and stops sending", async () => {
    const fetch = fetchMock().mockRejectedValue(
      new Error("Too many subrequests.")
    );
    const { lines, logger } = recordingLogger();
    const scope = limits();
    const client = pacedClient(fetch, logger);

    await expect(
      failureOf(client.fetch("/services/v2/people/1").pipe(withLimits(scope)))
    ).resolves.toMatchObject({
      _tag: "PlanningCenterSubrequestLimitError",
      source: "worker",
      requests: 1,
    });
    await expect(
      failureOf(client.fetch("/services/v2/people/2").pipe(withLimits(scope)))
    ).resolves.toMatchObject({
      _tag: "PlanningCenterSubrequestLimitError",
      source: "worker",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(lines).toStrictEqual([
      {
        level: "warn",
        message:
          "Cloudflare refused a Planning Center request: too many subrequests",
        fields: {
          endpoint: { path: "/services/v2/people/1", queryKeys: [] },
          method: "GET",
          requests: 1,
        },
      },
    ]);
    expect({
      reached: scope.accounting.subrequestLimitReached,
      hits: scope.accounting.totals.subrequestLimitHits,
    }).toStrictEqual({ reached: true, hits: 1 });
  });

  it("sends writes without pacing even when the budget is spent", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(rateLimitedResponse(100))
      .mockResolvedValueOnce(jsonResponse({ data: person }));
    const { logger } = recordingLogger();
    const scope = limits();
    const client = pacedClient(fetch, logger);
    await Effect.runPromise(
      client.fetch("/services/v2/people/1").pipe(withLimits(scope))
    );
    await Effect.runPromise(
      client
        .fetch("/services/v2/people", { method: "POST", body: {} })
        .pipe(withLimits(scope))
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(scope.accounting.totals.pacedRequests).toBe(0);
  });

  it("releases a paced reservation when the wait is interrupted", async () => {
    const fetch = fetchMock().mockResolvedValue(rateLimitedResponse(100));
    const { logger } = recordingLogger();
    const pacer = new PlanningCenterRatePacer({ maxWaitMs: 60_000 });
    const scope = limits(new PlanningCenterRequestAccounting(), pacer);
    const client = pacedClient(fetch, logger);
    await Effect.runPromise(
      Effect.gen(function* interruptPacedRead() {
        yield* client.fetch("/services/v2/people/1");
        const fiber = yield* Effect.forkChild(
          client.fetch("/services/v2/people/2")
        );
        yield* settle;
        yield* Fiber.interrupt(fiber);
        const now = yield* Clock.currentTimeMillis;
        expect(
          pacer.reserve(client.getCacheScope(), now, "write").window.inFlight
        ).toBe(0);
      }).pipe(withLimits(scope), Effect.provide(TestClock.layer()))
    );
    expect(fetch).toHaveBeenCalledOnce();
  });
});
