import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import { PlanningCenterRateLimitError } from "@pcobooster/api/planning-center/rate-limit-error";
import { PlanningCenterSubrequestLimitError } from "@pcobooster/api/planning-center/subrequest-limit-error";

/**
 * Every failure that means the Planning Center budget ran out. No read may
 * recover from one of these into empty or default data.
 */
export const planningCenterBudgetFailures = (): readonly (
  | PlanningCenterApiError
  | PlanningCenterRateLimitError
  | PlanningCenterSubrequestLimitError
)[] => [
  new PlanningCenterRateLimitError({ retryAfterSeconds: 12, reason: "budget" }),
  new PlanningCenterSubrequestLimitError({ source: "worker", requests: 50 }),
  new PlanningCenterSubrequestLimitError({
    source: "budget",
    requests: 40,
    limit: 40,
  }),
  new PlanningCenterApiError({
    message: "Too many requests",
    status: 429,
    retryAfterSeconds: 20,
  }),
];

export const planningCenterNotFound = (): PlanningCenterApiError =>
  new PlanningCenterApiError({ message: "Not found", status: 404 });
