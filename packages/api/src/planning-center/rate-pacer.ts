import type { PlanningCenterRateLimitInfo } from "@pcobooster/api/planning-center/api-error";
import type { RequestPriority } from "@pcobooster/contracts/request-priority";

/** Budget used freely before pacing starts, as a share of the reported limit. */
const DEFAULT_PACE_FROM_SHARE = 0.5;
/**
 * Budget speculative reads may use, as a share of the reported limit. Below the pacing share,
 * so work nobody is waiting on never takes a paced slot and at least this much of every window
 * beyond it stays for interactive reads.
 */
const DEFAULT_SPECULATIVE_SHARE = 0.4;
/** Longest an interactive request waits for budget before failing fast. */
export const DEFAULT_MAX_RATE_LIMIT_WAIT_MS = 5000;
/** Retry wait after a 429 that names no Retry-After and no known window. */
const UNKNOWN_BLOCK_MS = 1000;
/** Credentials tracked before idle ones are pruned; OAuth tokens rotate every 2 hours. */
const PRUNE_ABOVE_CREDENTIALS = 64;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const PERIOD_PATTERN = /^(?<amount>\d+)\s*(?<unit>second|minute)s?$/iu;

/** Parses `X-PCO-API-Request-Rate-Period`, for example "20 seconds". */
export const parseRatePeriodMs = (
  period: string | undefined
): number | undefined => {
  const match = PERIOD_PATTERN.exec(period?.trim() ?? "");
  const amount = Number(match?.groups?.amount);
  if (!(Number.isFinite(amount) && amount > 0)) {
    return undefined;
  }
  const unit = match?.groups?.unit?.toLowerCase();
  return amount * (unit === "minute" ? MS_PER_MINUTE : MS_PER_SECOND);
};

interface CredentialWindow {
  limit: number | undefined;
  periodMs: number | undefined;
  /** Highest `Rate-Count` reported in the current window. */
  reportedCount: number;
  /** Estimated end of the current window; conservative when unknown. */
  windowEndsAt: number;
  /** Requests reserved (waiting or in flight) and not yet answered. */
  inFlight: number;
  /** Earliest time the next paced request may be sent. */
  nextSlotAt: number;
  /** Set by a 429 until its Retry-After passes. */
  blockedUntil: number;
}

export interface PlanningCenterRateSnapshot {
  readonly limit: number | undefined;
  readonly count: number;
  readonly periodMs: number | undefined;
  /** Other reserved requests not yet answered, excluding this one. */
  readonly inFlight: number;
}

export type PlanningCenterPacingDecision =
  | {
      readonly kind: "send";
      readonly waitMs: number;
      readonly window: PlanningCenterRateSnapshot;
    }
  | {
      readonly kind: "reject";
      /**
       * `budget`: the wait would pass the cap. `speculative`: the rest of the window is kept for
       * interactive reads; nothing is wrong with the credential.
       */
      readonly reason: "budget" | "speculative";
      readonly retryAfterMs: number;
      readonly window: PlanningCenterRateSnapshot;
    };

export interface PlanningCenterRatePacerOptions {
  /** Share of the reported limit used without pacing (default 0.5). */
  readonly paceFromShare?: number;
  /** Longest wait before a read fails fast (default 5 s). */
  readonly maxWaitMs?: number;
  /** Share of the reported limit speculative reads may use (default 0.4). */
  readonly speculativeShare?: number;
}

export interface PlanningCenterRateObservation {
  readonly status: number;
  readonly rateLimit: PlanningCenterRateLimitInfo;
}

const snapshotOf = (window: CredentialWindow): PlanningCenterRateSnapshot => ({
  limit: window.limit,
  count: window.reportedCount,
  periodMs: window.periodMs,
  inFlight: window.inFlight,
});

/** Updates the window from one response's rate headers and status. */
const learnFromResponse = (
  window: CredentialWindow,
  now: number,
  { status, rateLimit }: PlanningCenterRateObservation
): void => {
  const periodMs = parseRatePeriodMs(rateLimit.period);
  window.limit = rateLimit.limit ?? window.limit;
  window.periodMs = periodMs ?? window.periodMs;
  const { count } = rateLimit;
  if (count !== undefined) {
    // A count well below what we saw means a new window began. Responses
    // can arrive out of order within a window, hence the in-flight slack.
    const startedNewWindow =
      now >= window.windowEndsAt ||
      count + window.inFlight < window.reportedCount;
    if (startedNewWindow) {
      window.reportedCount = count;
      // The window start is not reported; assuming it just began keeps
      // pacing conservative.
      window.windowEndsAt = now + (window.periodMs ?? 0);
      window.nextSlotAt = now;
    } else {
      window.reportedCount = Math.max(window.reportedCount, count);
    }
  }
  if (status === 429) {
    window.reportedCount = Math.max(
      window.reportedCount,
      window.limit ?? window.reportedCount
    );
    let blockMs = UNKNOWN_BLOCK_MS;
    if (rateLimit.retryAfterSeconds !== undefined) {
      blockMs = rateLimit.retryAfterSeconds * MS_PER_SECOND;
    } else if (window.windowEndsAt > now) {
      blockMs = window.windowEndsAt - now;
    }
    window.blockedUntil = Math.max(window.blockedUntil, now + blockMs);
    // Retry-After is authoritative: the budget returns when it passes.
    window.windowEndsAt = window.blockedUntil;
  }
};

/**
 * Paces one isolate's Planning Center requests per credential (cache scope)
 * from the rate headers Planning Center reports, never from hard-coded
 * limits. Below `paceFromShare` of the limit requests go straight out; above
 * it, concurrent requests take evenly spaced slots that spread the remaining
 * budget over the rest of the window. A wait longer than `maxWaitMs` is
 * rejected so the caller can fail fast. Speculative reads never wait: they go
 * out only while the window is below `speculativeShare` and nothing is paced,
 * and are rejected otherwise, so prefetches cannot take budget from what the
 * user is waiting on. Isolates do not share state, so this cannot prevent 429s
 * caused by another isolate or tab.
 *
 * Methods are synchronous and take the current time, so callers read the
 * Effect `Clock` and tests can drive time directly.
 */
export class PlanningCenterRatePacer {
  readonly maxWaitMs: number;
  private readonly paceFromShare: number;
  private readonly speculativeShare: number;
  private readonly windows = new Map<string, CredentialWindow>();

  constructor(options: PlanningCenterRatePacerOptions = {}) {
    this.paceFromShare = options.paceFromShare ?? DEFAULT_PACE_FROM_SHARE;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_RATE_LIMIT_WAIT_MS;
    this.speculativeShare = Math.min(
      options.speculativeShare ?? DEFAULT_SPECULATIVE_SHARE,
      this.paceFromShare
    );
  }

  private windowFor(scope: string, now: number): CredentialWindow {
    let window = this.windows.get(scope);
    if (window === undefined) {
      window = {
        limit: undefined,
        periodMs: undefined,
        reportedCount: 0,
        windowEndsAt: now,
        inFlight: 0,
        nextSlotAt: now,
        blockedUntil: now,
      };
      this.windows.set(scope, window);
    }
    if (now >= window.windowEndsAt && now >= window.blockedUntil) {
      // The window we knew about has ended; the next response reports the new one.
      window.reportedCount = 0;
      window.nextSlotAt = now;
    }
    return window;
  }

  /**
   * Reserves a send slot. Reads may wait or be rejected; speculative reads
   * are sent at once or rejected; writes are never delayed or rejected here,
   * only counted. Every `send` must be followed by `complete`.
   */
  reserve(
    scope: string,
    now: number,
    kind: "read" | "write",
    priority: RequestPriority = "interactive"
  ): PlanningCenterPacingDecision {
    const window = this.windowFor(scope, now);
    const decision =
      kind === "read" && priority === "speculative"
        ? this.decideSpeculative(window, now)
        : this.decide(window, now, kind);
    if (decision.kind === "send") {
      window.inFlight += 1;
    }
    return decision;
  }

  private decide(
    window: CredentialWindow,
    now: number,
    kind: "read" | "write"
  ): PlanningCenterPacingDecision {
    const { limit } = window;
    const blocked = window.blockedUntil > now;
    const used = window.reportedCount + window.inFlight;
    if (
      kind === "write" ||
      limit === undefined ||
      window.periodMs === undefined ||
      (!blocked && used < limit * this.paceFromShare)
    ) {
      return { kind: "send", waitMs: 0, window: snapshotOf(window) };
    }
    const remaining = limit - used;
    const earliest = Math.max(
      now,
      window.nextSlotAt,
      window.blockedUntil,
      remaining > 0 ? now : window.windowEndsAt
    );
    const windowLeftMs = Math.max(window.windowEndsAt - earliest, 0);
    const spacingMs =
      remaining > 0 && windowLeftMs > 0
        ? windowLeftMs / remaining
        : window.periodMs / limit;
    const waitMs = Math.ceil(earliest - now);
    if (waitMs > this.maxWaitMs) {
      return {
        kind: "reject",
        reason: "budget",
        retryAfterMs: waitMs,
        window: snapshotOf(window),
      };
    }
    window.nextSlotAt = earliest + spacingMs;
    return { kind: "send", waitMs, window: snapshotOf(window) };
  }

  private decideSpeculative(
    window: CredentialWindow,
    now: number
  ): PlanningCenterPacingDecision {
    const { limit } = window;
    if (limit === undefined || window.periodMs === undefined) {
      // Nothing is known about this credential yet; the first response teaches the window.
      return { kind: "send", waitMs: 0, window: snapshotOf(window) };
    }
    const used = window.reportedCount + window.inFlight;
    const interactiveQueued = window.nextSlotAt > now;
    if (
      window.blockedUntil <= now &&
      !interactiveQueued &&
      used < limit * this.speculativeShare
    ) {
      return { kind: "send", waitMs: 0, window: snapshotOf(window) };
    }
    return {
      kind: "reject",
      reason: "speculative",
      retryAfterMs: Math.max(
        window.windowEndsAt - now,
        window.blockedUntil - now,
        0
      ),
      window: snapshotOf(window),
    };
  }

  /** Releases a reservation and learns from the response's rate headers, if any. */
  complete(
    scope: string,
    now: number,
    observation?: PlanningCenterRateObservation
  ): void {
    const window = this.windowFor(scope, now);
    window.inFlight = Math.max(window.inFlight - 1, 0);
    if (observation !== undefined) {
      learnFromResponse(window, now, observation);
    }
    if (this.windows.size > PRUNE_ABOVE_CREDENTIALS) {
      this.prune(now);
    }
  }

  private prune(now: number): void {
    for (const [scope, window] of this.windows) {
      if (
        window.inFlight === 0 &&
        window.windowEndsAt <= now &&
        window.blockedUntil <= now
      ) {
        this.windows.delete(scope);
      }
    }
  }
}
