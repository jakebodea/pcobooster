import { PlanningCenterRequestAccounting } from "@pcobooster/api/planning-center/request-accounting";
import type {
  PlanningCenterLogFields,
  PlanningCenterLogger,
} from "@pcobooster/api/planning-center/request-accounting";
import { PLANNING_CENTER_REQUEST_CAP } from "@pcobooster/api/planning-center/request-budget";
import { accountPlanningCenterProcedure } from "@pcobooster/api/transport/orpc/planning-center-accounting";
import { describe, expect, it } from "vitest";

const recordingLogger = () => {
  const lines: { message: string; fields: PlanningCenterLogFields }[] = [];
  const logger: PlanningCenterLogger = {
    info: (fields, message) => {
      lines.push({ message, fields });
    },
    warn: (fields, message) => {
      lines.push({ message, fields });
    },
  };
  return { lines, logger };
};

/** A clock that advances 25 ms per reading. */
const steppingClock = () => {
  let now = 0;
  return () => {
    now += 25;
    return now;
  };
};

const procedure = {
  procedure: "people.planWindowHistory",
  requestId: "request-1",
};

describe(accountPlanningCenterProcedure, () => {
  it("logs one summary for a procedure that called Planning Center", async () => {
    const { lines, logger } = recordingLogger();
    const result = await accountPlanningCenterProcedure(
      procedure,
      async (accounting) => {
        accounting.recordRequest();
        accounting.recordRequest();
        accounting.recordPaced(400);
        accounting.recordRateLimited();
        return await Promise.resolve("done");
      },
      { logger, requestBudget: 40, now: steppingClock() }
    );
    expect(result).toBe("done");
    expect(lines).toStrictEqual([
      {
        message: "Planning Center procedure summary",
        fields: {
          procedure: "people.planWindowHistory",
          requestId: "request-1",
          priority: "interactive",
          durationMs: 25,
          outcome: "success",
          planningCenter: {
            requests: 2,
            pacedRequests: 1,
            pacedWaitMs: 400,
            rateLimited: 1,
            rateLimitRejections: 0,
            subrequestLimitHits: 0,
            requestBudget: 40,
          },
        },
      },
    ]);
  });

  it("logs the summary of a failed procedure and rethrows", async () => {
    const { lines, logger } = recordingLogger();
    const failure = new Error("provider down");
    await expect(
      accountPlanningCenterProcedure(
        procedure,
        async (accounting) => {
          accounting.recordRequest();
          await Promise.reject(failure);
        },
        { logger, now: steppingClock() }
      )
    ).rejects.toBe(failure);
    expect(lines).toMatchObject([
      {
        fields: {
          outcome: "failure",
          planningCenter: {
            requests: 1,
            requestBudget: PLANNING_CENTER_REQUEST_CAP,
          },
        },
      },
    ]);
  });

  it("caps every procedure's Planning Center requests below the Workers Free subrequest limit", async () => {
    let received: PlanningCenterRequestAccounting | undefined;
    await accountPlanningCenterProcedure(procedure, async (accounting) => {
      received = accounting;
      await Promise.resolve();
    });
    expect({
      cap: PLANNING_CENTER_REQUEST_CAP,
      requestBudget: received?.requestBudget,
    }).toStrictEqual({ cap: 40, requestBudget: 40 });
  });

  it("gives the pacer and the summary the browser's priority", async () => {
    const { lines, logger } = recordingLogger();
    let received: PlanningCenterRequestAccounting | undefined;
    await accountPlanningCenterProcedure(
      { ...procedure, priority: "speculative" },
      async (accounting) => {
        received = accounting;
        accounting.recordRateLimitRejection();
        await Promise.resolve();
      },
      { logger }
    );
    expect(received?.priority).toBe("speculative");
    expect(lines).toMatchObject([
      {
        fields: {
          priority: "speculative",
          planningCenter: { requests: 0, rateLimitRejections: 1 },
        },
      },
    ]);
  });

  it("stays quiet for procedures that never called Planning Center", async () => {
    const { lines, logger } = recordingLogger();
    await accountPlanningCenterProcedure(
      procedure,
      async () => {
        await Promise.resolve();
      },
      { logger }
    );
    expect(lines).toStrictEqual([]);
  });

  it("reuses accounting that an outer middleware already provides", async () => {
    const { lines, logger } = recordingLogger();
    const existing = new PlanningCenterRequestAccounting();
    let received: PlanningCenterRequestAccounting | undefined;
    await accountPlanningCenterProcedure(
      { ...procedure, accounting: existing },
      async (accounting) => {
        received = accounting;
        accounting.recordRequest();
        await Promise.resolve();
      },
      { logger }
    );
    expect(received).toBe(existing);
    expect(lines).toStrictEqual([]);
  });
});
