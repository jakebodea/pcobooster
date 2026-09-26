import { Data } from "effect";

/**
 * The request was not sent. `budget`: the credential's Planning Center budget
 * is spent for longer than an interactive request should wait. `speculative`:
 * a speculative request was held back so the rest of the window stays for
 * interactive ones; an interactive caller may send the same read at once.
 */
export class PlanningCenterRateLimitError extends Data.TaggedError(
  "PlanningCenterRateLimitError"
)<{
  readonly retryAfterSeconds: number;
  readonly reason: "budget" | "speculative";
}> {
  override readonly message =
    "Planning Center rate limit budget is exhausted for this credential";
}
