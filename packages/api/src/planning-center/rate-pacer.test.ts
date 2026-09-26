import {
  PlanningCenterRatePacer,
  parseRatePeriodMs,
} from "@pcobooster/api/planning-center/rate-pacer";
import type { PlanningCenterPacingDecision } from "@pcobooster/api/planning-center/rate-pacer";
import { describe, expect, it } from "vitest";

const SCOPE = "bearer:scope";

const rateHeaders = (count: number) => ({
  status: 200,
  rateLimit: { limit: 100, count, period: "20 seconds" },
});

/** Sends one read at `now` and reports `count` from its response. */
const observe = (
  pacer: PlanningCenterRatePacer,
  now: number,
  count: number
): void => {
  pacer.reserve(SCOPE, now, "read");
  pacer.complete(SCOPE, now, rateHeaders(count));
};

const waitOf = (decision: PlanningCenterPacingDecision): number => {
  if (decision.kind !== "send") {
    throw new Error(`Expected a send decision, got ${decision.kind}`);
  }
  return decision.waitMs;
};

describe(parseRatePeriodMs, () => {
  it.each([
    ["20 seconds", 20_000],
    ["1 minute", 60_000],
    ["2 Minutes", 120_000],
  ])("parses %j", (period, expected) => {
    expect(parseRatePeriodMs(period)).toBe(expected);
  });

  it.each([undefined, "", "soon", "0 seconds"])(
    "ignores unusable period %j",
    (period) => {
      expect(parseRatePeriodMs(period)).toBeUndefined();
    }
  );
});

describe(PlanningCenterRatePacer, () => {
  it("sends immediately until the reported limits are known", () => {
    const pacer = new PlanningCenterRatePacer();
    for (let request = 0; request < 10; request += 1) {
      expect(waitOf(pacer.reserve(SCOPE, 0, "read"))).toBe(0);
    }
  });

  it("sends immediately below the pacing share of the limit", () => {
    const pacer = new PlanningCenterRatePacer();
    observe(pacer, 0, 40);
    expect(waitOf(pacer.reserve(SCOPE, 1000, "read"))).toBe(0);
  });

  it("spreads the remaining budget over the rest of the window", () => {
    const pacer = new PlanningCenterRatePacer();
    // The window is assumed to start at the first response: it ends at 20 s.
    observe(pacer, 0, 80);
    // 20 requests left over 10 s: one slot every 500 ms, shared by concurrent callers.
    expect(waitOf(pacer.reserve(SCOPE, 10_000, "read"))).toBe(0);
    expect(waitOf(pacer.reserve(SCOPE, 10_000, "read"))).toBe(500);
    expect(waitOf(pacer.reserve(SCOPE, 10_000, "read"))).toBe(1000);
  });

  it("rejects a read whose slot is past the wait cap", () => {
    const pacer = new PlanningCenterRatePacer({ maxWaitMs: 5000 });
    observe(pacer, 0, 100);
    expect(pacer.reserve(SCOPE, 2000, "read")).toMatchObject({
      kind: "reject",
      retryAfterMs: 18_000,
      window: { limit: 100, count: 100, periodMs: 20_000, inFlight: 0 },
    });
  });

  it("waits for the next window when it is within the cap", () => {
    const pacer = new PlanningCenterRatePacer({ maxWaitMs: 5000 });
    observe(pacer, 0, 100);
    expect(waitOf(pacer.reserve(SCOPE, 17_000, "read"))).toBe(3000);
  });

  it("starts fresh once the window has passed", () => {
    const pacer = new PlanningCenterRatePacer();
    observe(pacer, 0, 100);
    expect(waitOf(pacer.reserve(SCOPE, 20_000, "read"))).toBe(0);
  });

  it("blocks the credential for a 429's Retry-After", () => {
    const pacer = new PlanningCenterRatePacer({ maxWaitMs: 5000 });
    observe(pacer, 0, 10);
    pacer.reserve(SCOPE, 1000, "read");
    pacer.complete(SCOPE, 1000, {
      status: 429,
      rateLimit: { limit: 100, count: 100, retryAfterSeconds: 3 },
    });
    expect(waitOf(pacer.reserve(SCOPE, 1000, "read"))).toBe(3000);
  });

  it("never delays or rejects writes", () => {
    const pacer = new PlanningCenterRatePacer({ maxWaitMs: 5000 });
    observe(pacer, 0, 100);
    expect(waitOf(pacer.reserve(SCOPE, 1000, "write"))).toBe(0);
  });

  it("keeps credentials independent", () => {
    const pacer = new PlanningCenterRatePacer();
    observe(pacer, 0, 100);
    expect(waitOf(pacer.reserve("bearer:other", 1000, "read"))).toBe(0);
  });

  it("sends speculative reads while the window is mostly unused", () => {
    const pacer = new PlanningCenterRatePacer();
    expect(waitOf(pacer.reserve(SCOPE, 0, "read", "speculative"))).toBe(0);
    pacer.complete(SCOPE, 0, rateHeaders(20));
    expect(waitOf(pacer.reserve(SCOPE, 1000, "read", "speculative"))).toBe(0);
  });

  it("holds speculative reads back once the speculative share is used, counting reads in flight", () => {
    const pacer = new PlanningCenterRatePacer();
    observe(pacer, 0, 30);
    for (let request = 0; request < 9; request += 1) {
      expect(waitOf(pacer.reserve(SCOPE, 1000, "read", "speculative"))).toBe(0);
    }
    // 30 reported plus 9 in flight is 39; the 40th would reach 40% of the limit.
    expect(pacer.reserve(SCOPE, 1000, "read", "speculative")).toStrictEqual({
      kind: "send",
      waitMs: 0,
      window: { limit: 100, count: 30, periodMs: 20_000, inFlight: 9 },
    });
    expect(pacer.reserve(SCOPE, 1000, "read", "speculative")).toMatchObject({
      kind: "reject",
      reason: "speculative",
      retryAfterMs: 19_000,
    });
  });

  it("keeps the budget above the speculative share for interactive reads", () => {
    const pacer = new PlanningCenterRatePacer();
    observe(pacer, 0, 45);
    expect(pacer.reserve(SCOPE, 1000, "read", "speculative")).toMatchObject({
      kind: "reject",
      reason: "speculative",
    });
    expect(waitOf(pacer.reserve(SCOPE, 1000, "read", "interactive"))).toBe(0);
  });

  it("never lets a speculative read wait for a slot or jump the pacing queue", () => {
    const pacer = new PlanningCenterRatePacer({ speculativeShare: 0.9 });
    observe(pacer, 0, 80);
    // Interactive reads are spaced; the speculative one is not queued behind or ahead of them.
    expect(waitOf(pacer.reserve(SCOPE, 10_000, "read"))).toBe(0);
    expect(pacer.reserve(SCOPE, 10_000, "read", "speculative")).toMatchObject({
      kind: "reject",
      reason: "speculative",
    });
    expect(waitOf(pacer.reserve(SCOPE, 10_000, "read"))).toBe(500);
  });

  it("holds speculative reads back while a 429 blocks the credential", () => {
    const pacer = new PlanningCenterRatePacer();
    observe(pacer, 0, 10);
    pacer.reserve(SCOPE, 1000, "read");
    pacer.complete(SCOPE, 1000, {
      status: 429,
      rateLimit: { limit: 100, count: 10, retryAfterSeconds: 3 },
    });
    expect(pacer.reserve(SCOPE, 1000, "read", "speculative")).toMatchObject({
      kind: "reject",
      reason: "speculative",
      retryAfterMs: 3000,
    });
  });

  it("labels an interactive rejection as a spent budget", () => {
    const pacer = new PlanningCenterRatePacer({ maxWaitMs: 5000 });
    observe(pacer, 0, 100);
    expect(pacer.reserve(SCOPE, 2000, "read")).toMatchObject({
      kind: "reject",
      reason: "budget",
    });
  });

  it("never holds back speculative writes", () => {
    const pacer = new PlanningCenterRatePacer();
    observe(pacer, 0, 100);
    expect(waitOf(pacer.reserve(SCOPE, 1000, "write", "speculative"))).toBe(0);
  });

  it("releases reservations that end without a response", () => {
    const pacer = new PlanningCenterRatePacer();
    observe(pacer, 0, 10);
    pacer.reserve(SCOPE, 1000, "read");
    pacer.complete(SCOPE, 1000);
    expect(pacer.reserve(SCOPE, 1000, "read")).toMatchObject({
      window: { inFlight: 0 },
    });
  });
});
