import { logger } from "@pcobooster/api/logger";
import {
  PlanningCenterRequestAccounting,
  logPlanningCenterProcedureSummary,
} from "@pcobooster/api/planning-center/request-accounting";
import type { PlanningCenterLogger } from "@pcobooster/api/planning-center/request-accounting";
import { PLANNING_CENTER_REQUEST_CAP } from "@pcobooster/api/planning-center/request-budget";
import type { RequestPriority } from "@pcobooster/contracts/request-priority";

export interface PlanningCenterProcedureAccountingOptions {
  readonly logger?: PlanningCenterLogger;
  /** Defaults to `PLANNING_CENTER_REQUEST_CAP`. */
  readonly requestBudget?: number;
  readonly now?: () => number;
}

export interface PlanningCenterProcedure {
  /** Dotted oRPC path, for example `people.planWindowHistory`. */
  readonly procedure: string;
  readonly requestId: string;
  /** From the browser's priority header; defaults to interactive. */
  readonly priority?: RequestPriority;
  /** Present when an outer middleware already counts this procedure. */
  readonly accounting?: PlanningCenterRequestAccounting;
}

/**
 * Runs one oRPC procedure with fresh Planning Center accounting and logs
 * its summary once it settles. Every application execution in the procedure
 * shares the accounting through the oRPC context.
 */
export const accountPlanningCenterProcedure = async <Result>(
  {
    procedure,
    requestId,
    priority = "interactive",
    accounting: existing,
  }: PlanningCenterProcedure,
  run: (accounting: PlanningCenterRequestAccounting) => Promise<Result>,
  options: PlanningCenterProcedureAccountingOptions = {}
): Promise<Result> => {
  if (existing !== undefined) {
    return await run(existing);
  }
  const now = options.now ?? Date.now;
  const accounting = new PlanningCenterRequestAccounting({
    requestBudget: options.requestBudget ?? PLANNING_CENTER_REQUEST_CAP,
    priority,
  });
  const startedAt = now();
  let outcome: "success" | "failure" = "failure";
  try {
    const result = await run(accounting);
    outcome = "success";
    return result;
  } finally {
    logPlanningCenterProcedureSummary(
      options.logger ?? logger.for("planning-center/procedure"),
      {
        procedure,
        requestId,
        priority,
        durationMs: now() - startedAt,
        outcome,
      },
      accounting
    );
  }
};
