import { createHash } from "node:crypto";

import { logger as apiLogger } from "@pcobooster/api/logger";
import { PlanningCenterAccounting } from "@pcobooster/api/planning-center/accounting";
import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import type { PlanningCenterRateLimitInfo } from "@pcobooster/api/planning-center/api-error";
import { PlanningCenterNetworkError } from "@pcobooster/api/planning-center/network-error";
import { PlanningCenterPacing } from "@pcobooster/api/planning-center/pacing";
import { PlanningCenterRateLimitError } from "@pcobooster/api/planning-center/rate-limit-error";
import { DEFAULT_MAX_RATE_LIMIT_WAIT_MS } from "@pcobooster/api/planning-center/rate-pacer";
import type { PlanningCenterRatePacer } from "@pcobooster/api/planning-center/rate-pacer";
import { PlanningCenterReadOnlyError } from "@pcobooster/api/planning-center/read-only-error";
import type {
  PlanningCenterEndpoint,
  PlanningCenterLogger,
  PlanningCenterRequestAccounting,
} from "@pcobooster/api/planning-center/request-accounting";
import {
  pcCollectionResponseSchema,
  pcResourceResponseSchema,
} from "@pcobooster/api/planning-center/resource-schemas";
import {
  PlanningCenterSubrequestLimitError,
  isTooManySubrequestsError,
} from "@pcobooster/api/planning-center/subrequest-limit-error";
import {
  isNonEmptyString,
  isString,
  jsonValueSchema,
} from "@pcobooster/planning-center-models/json";
import type {
  JsonObject,
  JsonValue,
} from "@pcobooster/planning-center-models/json";
import type {
  PCApiResponse,
  PCResource,
} from "@pcobooster/planning-center-models/types";
import { Clock, Duration, Effect, Exit, Option, Schedule } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type { HttpClientError } from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type { HttpClientResponse } from "effect/unstable/http/HttpClientResponse";
import type { HttpMethod } from "effect/unstable/http/HttpMethod";
import { z } from "zod";

const log = apiLogger.for("planning-center/core");
const PC_BASE_URL = "https://api.planningcenteronline.com";
/** Each attempt (request, error body, and rate-limit pause) and its JSON body share this budget. */
const ATTEMPT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MS_PER_SECOND = 1000;
const errorBodySchema = z.record(z.string(), z.json());

/** Every expected Planning Center failure; anything else is a defect. */
export type PlanningCenterError =
  | PlanningCenterApiError
  | PlanningCenterNetworkError
  | PlanningCenterRateLimitError
  | PlanningCenterReadOnlyError
  | PlanningCenterSubrequestLimitError;

/** Failures that can come from one attempt; only some are retried. */
type AttemptError =
  | PlanningCenterApiError
  | PlanningCenterNetworkError
  | PlanningCenterRateLimitError
  | PlanningCenterSubrequestLimitError;

export const isPlanningCenterError = (
  value: unknown
): value is PlanningCenterError =>
  value instanceof PlanningCenterApiError ||
  value instanceof PlanningCenterNetworkError ||
  value instanceof PlanningCenterRateLimitError ||
  value instanceof PlanningCenterReadOnlyError ||
  value instanceof PlanningCenterSubrequestLimitError;

type ResponseHeaders = HttpClientResponse["headers"];

interface SentResponse {
  readonly response: HttpClientResponse;
  readonly startedAt: number;
}

const endpointUrl = (endpoint: string): string =>
  new URL(endpoint, PC_BASE_URL).toString();

const invalidProviderResponse = (
  status: number,
  cause: unknown
): PlanningCenterApiError =>
  new PlanningCenterApiError({
    message: "Planning Center returned an invalid response",
    status,
    code: "INVALID_RESPONSE",
    cause,
  });

const attemptTimedOut = (): PlanningCenterNetworkError =>
  new PlanningCenterNetworkError({
    cause: new DOMException(
      "Planning Center request timed out",
      "TimeoutError"
    ),
  });

const networkFailure = (error: HttpClientError): PlanningCenterNetworkError =>
  new PlanningCenterNetworkError({ cause: error.cause ?? error });

/** What one attempt knows about its request and invocation. */
interface AttemptContext {
  readonly accounting: PlanningCenterRequestAccounting | undefined;
  readonly pacer: PlanningCenterRatePacer | undefined;
  readonly endpoint: PlanningCenterEndpoint;
  /** 1 for the first attempt. */
  readonly attempt: number;
}

export const buildPlanningCenterUrl = (
  endpoint: string,
  params: Record<string, string> = {}
): string => {
  const url = new URL(endpoint, PC_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }
  return url.toString();
};

const isReadMethod = (method: HttpMethod): boolean =>
  method === "GET" || method === "HEAD";

/** A Retry-After longer than an interactive request should wait. */
const exceedsRetryAfterCap = (retryAfterSeconds: number | undefined): boolean =>
  retryAfterSeconds !== undefined &&
  retryAfterSeconds * MS_PER_SECOND > DEFAULT_MAX_RATE_LIMIT_WAIT_MS;

const isRetryableError = (error: AttemptError): boolean => {
  if (error instanceof PlanningCenterApiError) {
    return (
      RETRYABLE_STATUS_CODES.has(error.status) &&
      !(error.status === 429 && exceedsRetryAfterCap(error.retryAfterSeconds))
    );
  }
  if (!(error instanceof PlanningCenterNetworkError)) {
    return false;
  }
  const { cause } = error;
  return (
    cause instanceof Error &&
    (cause.name === "AbortError" || cause.name === "TimeoutError")
  );
};

/** `retry` is 1 for the first retry. */
const retryDelayMs = (retry: number, error: AttemptError): number => {
  if (!(error instanceof PlanningCenterApiError)) {
    return retry * 300;
  }
  if (error.status === 429 && error.retryAfterSeconds !== undefined) {
    return Math.max(error.retryAfterSeconds, 1) * MS_PER_SECOND;
  }
  return retry * 500;
};

const describePlanningCenterEndpoint = (
  value: string
): PlanningCenterEndpoint => {
  const url = new URL(value, PC_BASE_URL);
  return {
    path: url.pathname,
    queryKeys: [...url.searchParams.keys()].toSorted(),
  };
};

const isRateLimitedResponse = (error: AttemptError): boolean =>
  error instanceof PlanningCenterApiError && error.status === 429;

/**
 * Idempotent reads retry transient failures; writes never do. A 429 is
 * retried only when its Retry-After fits the interactive wait cap; its
 * `info` line comes from the attempt.
 */
const transientReadRetries = (
  endpoint: PlanningCenterEndpoint,
  method: HttpMethod,
  logger: PlanningCenterLogger
) =>
  Schedule.recurs(MAX_RETRIES).pipe(
    Schedule.setInputType<AttemptError>(),
    Schedule.while(({ input }) => isRetryableError(input)),
    Schedule.addDelay(({ attempt, input }) =>
      Effect.sync(() => {
        const delayMs = retryDelayMs(attempt, input);
        if (!isRateLimitedResponse(input)) {
          logger.warn(
            {
              endpoint,
              method,
              attempt,
              retryDelayMs: delayMs,
              error: input.message.slice(0, 100),
            },
            "Planning Center request failed, retrying"
          );
        }
        return Duration.millis(delayMs);
      })
    )
  );

const readIntegerHeader = (
  headers: ResponseHeaders,
  name: string
): number | undefined => {
  const value = headers[name];
  if (!isNonEmptyString(value)) {
    return undefined;
  }
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const readRateLimitInfo = (
  headers: ResponseHeaders
): PlanningCenterRateLimitInfo => ({
  limit: readIntegerHeader(headers, "x-pco-api-request-rate-limit"),
  count: readIntegerHeader(headers, "x-pco-api-request-rate-count"),
  period: headers["x-pco-api-request-rate-period"] ?? undefined,
  retryAfterSeconds: readIntegerHeader(headers, "retry-after"),
});

const errorTitle = (
  body: z.infer<typeof errorBodySchema>
): string | undefined => {
  if (isString(body.error)) {
    return body.error;
  }
  return isString(body.message) ? body.message : undefined;
};

const parseErrorBody = (
  responseBody: string
): z.infer<typeof errorBodySchema> | null => {
  try {
    const parsed = errorBodySchema.safeParse(JSON.parse(responseBody));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const buildApiError = (
  status: number,
  responseBody: string,
  headers: ResponseHeaders
): PlanningCenterApiError => {
  let code: string | undefined;
  let details: JsonValue | undefined;
  let message = `Planning Center API error: ${status}`;
  const rateLimit = readRateLimitInfo(headers);
  const errorJson = parseErrorBody(responseBody);
  if (errorJson === null) {
    if (responseBody !== "") {
      message += ` - ${responseBody}`;
    }
  } else {
    code = isString(errorJson.code) ? errorJson.code : undefined;
    details = errorJson;
    const title = errorTitle(errorJson);
    if (isNonEmptyString(title)) {
      message += ` - ${title}`;
    }
  }
  return new PlanningCenterApiError({
    message,
    status,
    code,
    details,
    responseBody,
    rateLimit,
    retryAfterSeconds: rateLimit.retryAfterSeconds,
  });
};

const readResponseText = (
  response: HttpClientResponse
): Effect.Effect<string, PlanningCenterNetworkError> =>
  Effect.mapError(response.text, networkFailure);

const decodeResponse = <Output>(
  schema: z.ZodType<Output>,
  json: JsonValue
): Effect.Effect<Output, PlanningCenterApiError> => {
  const parsed = schema.safeParse(json);
  return parsed.success
    ? Effect.succeed(parsed.data)
    : Effect.fail(invalidProviderResponse(200, parsed.error));
};

/** Reads the JSON body within whatever remains of the attempt's time budget. */
const readJsonBody = ({
  response,
  startedAt,
}: SentResponse): Effect.Effect<JsonValue, AttemptError> =>
  Effect.gen(function* readJson() {
    const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;
    const text = yield* readResponseText(response).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(Math.max(ATTEMPT_TIMEOUT_MS - elapsedMs, 0)),
        orElse: () => Effect.fail(attemptTimedOut()),
      })
    );
    if (response.status === 204 || text.trim() === "") {
      return yield* Effect.fail(
        new PlanningCenterApiError({
          message:
            "Planning Center returned an empty response where JSON was required",
          status: response.status,
          code: "INVALID_RESPONSE",
        })
      );
    }
    // Both a syntax error and a non-JSON value mean the provider response is unusable.
    return yield* Effect.try({
      try: () => jsonValueSchema.parse(JSON.parse(text)),
      catch: (error) => invalidProviderResponse(response.status, error),
    });
  });

/** Fails before sending when this invocation may not make another request. */
const ensureSubrequestAvailable = (
  { accounting, endpoint }: AttemptContext,
  method: HttpMethod,
  logger: PlanningCenterLogger
): Effect.Effect<void, PlanningCenterSubrequestLimitError> =>
  Effect.suspend(() => {
    if (accounting === undefined) {
      return Effect.void;
    }
    const requests = accounting.requestCount;
    if (accounting.subrequestLimitReached) {
      return Effect.fail(
        new PlanningCenterSubrequestLimitError({ source: "worker", requests })
      );
    }
    const limit = accounting.requestBudget;
    if (limit === undefined || requests < limit) {
      return Effect.void;
    }
    accounting.recordSubrequestLimit("budget");
    logger.info(
      { endpoint, method, requests, requestBudget: limit },
      "Planning Center request budget for this invocation is spent"
    );
    return Effect.fail(
      new PlanningCenterSubrequestLimitError({
        source: "budget",
        requests,
        limit,
      })
    );
  });

/** Cloudflare's subrequest cap is final for the invocation, so it is not a network error. */
const transportFailure = (
  error: HttpClientError,
  { accounting, endpoint }: AttemptContext,
  method: HttpMethod,
  logger: PlanningCenterLogger
): PlanningCenterNetworkError | PlanningCenterSubrequestLimitError => {
  const cause = error.cause ?? error;
  if (!isTooManySubrequestsError(cause)) {
    return networkFailure(error);
  }
  accounting?.recordSubrequestLimit("worker");
  const requests = accounting?.requestCount ?? 0;
  logger.warn(
    { endpoint, method, requests },
    "Cloudflare refused a Planning Center request: too many subrequests"
  );
  return new PlanningCenterSubrequestLimitError({
    source: "worker",
    requests,
    cause,
  });
};

/**
 * Reserves a pacer slot and returns how long to wait before sending. A
 * rejection reserves nothing, so it must not be released.
 */
const reserveSlot = (
  pacer: PlanningCenterRatePacer,
  scope: string,
  { accounting, endpoint, attempt }: AttemptContext,
  method: HttpMethod,
  logger: PlanningCenterLogger
): Effect.Effect<number, PlanningCenterRateLimitError> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) => {
      const priority = accounting?.priority ?? "interactive";
      const decision = pacer.reserve(
        scope,
        now,
        isReadMethod(method) ? "read" : "write",
        priority
      );
      if (decision.kind === "reject") {
        accounting?.recordRateLimitRejection();
        logger.info(
          {
            endpoint,
            method,
            attempt,
            priority,
            retryAfterMs: decision.retryAfterMs,
            rateLimit: decision.window,
          },
          decision.reason === "speculative"
            ? "Planning Center speculative request held back: budget kept for interactive requests"
            : "Planning Center request rejected: rate limit budget is spent"
        );
        return Effect.fail(
          new PlanningCenterRateLimitError({
            retryAfterSeconds: Math.ceil(decision.retryAfterMs / MS_PER_SECOND),
            reason: decision.reason,
          })
        );
      }
      if (decision.waitMs === 0) {
        return Effect.succeed(0);
      }
      accounting?.recordPaced(decision.waitMs);
      logger.info(
        {
          endpoint,
          method,
          attempt,
          waitMs: decision.waitMs,
          rateLimit: decision.window,
        },
        "Planning Center request paced"
      );
      return Effect.succeed(decision.waitMs);
    })
  );

/** A Planning Center personal access token: application ID plus secret. */
export interface PlanningCenterPersonalAccessToken {
  readonly applicationId: string;
  readonly secret: string;
}

export type PlanningCenterAuthentication =
  | ({ readonly kind: "basic" } & PlanningCenterPersonalAccessToken)
  | { readonly kind: "bearer"; readonly accessToken: string };

export interface PlanningCenterCoreClientOptions {
  /** Sends every request; the Worker provides `FetchHttpClient`. */
  readonly httpClient: HttpClient.HttpClient;
  /** Rejects every non-read request before it reaches Planning Center. */
  readonly readOnly?: boolean;
  /** Receives pacing, 429, and subrequest-limit lines; defaults to the module logger. */
  readonly logger?: PlanningCenterLogger;
}

export interface PlanningCenterRequestOptions {
  readonly method?: HttpMethod;
  /** Sent as the `application/json` request body. */
  readonly body?: JsonObject;
}

/**
 * Binds one credential to its Authorization header and cache scope for its entire lifetime.
 * Interrupting a returned Effect aborts its in-flight fetch.
 *
 * Requests read two optional services from the Effect context: the isolate's
 * `PlanningCenterPacing`, which paces this credential's requests by cache
 * scope, and the procedure's `PlanningCenterAccounting`, which counts them and
 * may cap them. Without either, requests are sent unpaced and uncounted.
 */
export class PlanningCenterCoreClient {
  private readonly authorization: string;
  private readonly cacheScope: string;
  private readonly httpClient: HttpClient.HttpClient;
  private readonly readOnly: boolean;
  private readonly logger: PlanningCenterLogger;

  constructor(
    auth: PlanningCenterAuthentication,
    options: PlanningCenterCoreClientOptions
  ) {
    if (auth.kind === "bearer" && !isNonEmptyString(auth.accessToken.trim())) {
      throw new Error(
        "Planning Center bearer authentication requires a non-empty access token"
      );
    }
    if (
      auth.kind === "basic" &&
      !(
        isNonEmptyString(auth.applicationId.trim()) &&
        isNonEmptyString(auth.secret.trim())
      )
    ) {
      throw new Error(
        "Planning Center basic authentication requires an application ID and secret"
      );
    }
    const credential =
      auth.kind === "bearer"
        ? auth.accessToken
        : `${auth.applicationId}:${auth.secret}`;
    this.authorization =
      auth.kind === "bearer"
        ? `Bearer ${auth.accessToken}`
        : `Basic ${Buffer.from(credential).toString("base64")}`;
    this.cacheScope = `${auth.kind}:${createHash("sha256").update(credential).digest("hex")}`;
    // Trace headers would leak internal span IDs to a third party.
    this.httpClient = HttpClient.transform(options.httpClient, (effect) =>
      Effect.provideService(effect, HttpClient.TracerPropagationEnabled, false)
    );
    this.readOnly = options.readOnly ?? false;
    this.logger = options.logger ?? log;
  }

  getCacheScope(): string {
    return this.cacheScope;
  }

  private attempt(
    request: HttpClientRequest.HttpClientRequest,
    context: AttemptContext
  ): Effect.Effect<SentResponse, AttemptError> {
    const { cacheScope, httpClient, logger } = this;
    const { method } = request;
    const { accounting, endpoint, pacer } = context;
    const execute = Effect.gen(function* sendRequest() {
      accounting?.recordRequest();
      const startedAt = yield* Clock.currentTimeMillis;
      const response = yield* httpClient
        .execute(request)
        .pipe(
          Effect.mapError((error) =>
            transportFailure(error, context, method, logger)
          )
        );
      return { response, startedAt };
    });
    const paced =
      pacer === undefined
        ? execute
        : Effect.acquireUseRelease(
            reserveSlot(pacer, cacheScope, context, method, logger),
            (waitMs) =>
              waitMs === 0
                ? execute
                : Effect.andThen(
                    Effect.sleep(Duration.millis(waitMs)),
                    execute
                  ),
            // A granted reservation is released after the response, a
            // failure, or an interruption; responses also report the window.
            (_waitMs, exit) =>
              Effect.gen(function* releaseSlot() {
                const now = yield* Clock.currentTimeMillis;
                pacer.complete(
                  cacheScope,
                  now,
                  Exit.isSuccess(exit)
                    ? {
                        status: exit.value.response.status,
                        rateLimit: readRateLimitInfo(
                          exit.value.response.headers
                        ),
                      }
                    : undefined
                );
              })
          );
    return Effect.gen(function* attemptRequest() {
      yield* ensureSubrequestAvailable(context, method, logger);
      const sent = yield* paced;
      const { response } = sent;
      if (response.status >= 200 && response.status < 300) {
        return sent;
      }
      const responseBody = yield* readResponseText(response);
      const error = buildApiError(
        response.status,
        responseBody,
        response.headers
      );
      if (error.status === 429) {
        accounting?.recordRateLimited();
        logger.info(
          {
            endpoint,
            method,
            attempt: context.attempt,
            retryAfterSeconds: error.retryAfterSeconds,
            rateLimit: error.rateLimit,
            willRetry:
              isReadMethod(method) &&
              context.attempt <= MAX_RETRIES &&
              isRetryableError(error),
          },
          "Planning Center rate limited a request"
        );
      }
      return yield* Effect.fail(error);
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(ATTEMPT_TIMEOUT_MS),
        orElse: () => Effect.fail(attemptTimedOut()),
      })
    );
  }

  private send(
    endpoint: string,
    options: PlanningCenterRequestOptions
  ): Effect.Effect<SentResponse, PlanningCenterError> {
    const method = options.method ?? "GET";
    const url = endpointUrl(endpoint);
    const description = describePlanningCenterEndpoint(url);
    if (this.readOnly && !isReadMethod(method)) {
      return Effect.fail(
        new PlanningCenterReadOnlyError({ method, path: description.path })
      );
    }
    const headers = HttpClientRequest.setHeaders({
      Accept: "application/json",
      Authorization: this.authorization,
    });
    const request =
      options.body === undefined
        ? headers(HttpClientRequest.make(method)(url))
        : HttpClientRequest.bodyText(
            headers(HttpClientRequest.make(method)(url)),
            JSON.stringify(options.body),
            "application/json"
          );
    const { logger } = this;
    const attemptRequest = (context: AttemptContext) =>
      this.attempt(request, context);
    return Effect.gen(function* sendWithRetries() {
      const pacer = Option.getOrUndefined(
        yield* Effect.serviceOption(PlanningCenterPacing)
      );
      const accounting = Option.getOrUndefined(
        yield* Effect.serviceOption(PlanningCenterAccounting)
      );
      let attempt = 0;
      const nextAttempt = Effect.suspend(() => {
        attempt += 1;
        return attemptRequest({
          accounting,
          pacer,
          endpoint: description,
          attempt,
        });
      });
      return yield* isReadMethod(method)
        ? Effect.retry(
            nextAttempt,
            transientReadRetries(description, method, logger)
          )
        : nextAttempt;
    });
  }

  /** Sends a request whose body is not needed, such as a DELETE. */
  request(
    endpoint: string,
    options: PlanningCenterRequestOptions = {}
  ): Effect.Effect<HttpClientResponse, PlanningCenterError> {
    return Effect.map(this.send(endpoint, options), ({ response }) => response);
  }

  private fetchJson(
    endpoint: string,
    options: PlanningCenterRequestOptions
  ): Effect.Effect<JsonValue, PlanningCenterError> {
    return Effect.flatMap(this.send(endpoint, options), readJsonBody);
  }

  fetch(
    endpoint: string,
    options: PlanningCenterRequestOptions = {}
  ): Effect.Effect<PCApiResponse<PCResource>, PlanningCenterError> {
    return Effect.flatMap(this.fetchJson(endpoint, options), (json) =>
      decodeResponse(pcResourceResponseSchema, json)
    );
  }

  fetchCollection(
    endpoint: string,
    options: PlanningCenterRequestOptions = {}
  ): Effect.Effect<PCApiResponse<PCResource[]>, PlanningCenterError> {
    return Effect.flatMap(this.fetchJson(endpoint, options), (json) =>
      decodeResponse(pcCollectionResponseSchema, json)
    );
  }

  fetchAll(
    endpoint: string,
    params: Record<string, string> = {},
    maxPages = 10
  ): Effect.Effect<PCResource[], PlanningCenterError> {
    return Effect.map(
      this.fetchAllWithIncluded(endpoint, params, maxPages),
      ({ data }) => data
    );
  }

  /** Follows `links.next` once per URL, deduplicating included resources. */
  fetchAllWithIncluded(
    endpoint: string,
    params: Record<string, string> = {},
    maxPages = 5
  ): Effect.Effect<
    { data: PCResource[]; included: PCResource[] },
    PlanningCenterError
  > {
    const fetchPage = (url: string) => this.fetchCollection(url);
    return Effect.gen(function* fetchPages() {
      const data: PCResource[] = [];
      const included: PCResource[] = [];
      const seenIncluded = new Set<string>();
      const seenUrls = new Set<string>();
      let pagesRemaining = maxPages;
      let url: string | undefined = buildPlanningCenterUrl(endpoint, {
        ...params,
        per_page: "100",
      });
      while (url !== undefined && pagesRemaining > 0 && !seenUrls.has(url)) {
        seenUrls.add(url);
        pagesRemaining -= 1;
        const response: PCApiResponse<PCResource[]> = yield* fetchPage(url);
        data.push(...response.data);
        for (const resource of response.included ?? []) {
          const key = `${resource.type}:${resource.id}`;
          if (!seenIncluded.has(key)) {
            seenIncluded.add(key);
            included.push(resource);
          }
        }
        const nextUrl: string | undefined = response.links?.next;
        url = isNonEmptyString(nextUrl) ? nextUrl : undefined;
      }
      return { data, included };
    });
  }
}

/** Explicit application credentials for scripts and the development auth bypass. */
export const createBasicPlanningCenterClient = (
  token: PlanningCenterPersonalAccessToken,
  httpClient: HttpClient.HttpClient
): PlanningCenterCoreClient =>
  new PlanningCenterCoreClient({ kind: "basic", ...token }, { httpClient });
