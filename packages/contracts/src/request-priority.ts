/**
 * Who is waiting on an oRPC call. `interactive` loads what is on screen or what a click just
 * asked for; `speculative` loads ahead of a likely next step (a hover, a warm-up). Every call
 * spends the same Planning Center user's budget, so the API admits speculative reads only while
 * most of that budget is unused and rejects them before sending anything otherwise.
 */
export type RequestPriority = "interactive" | "speculative";

/** Request header the browser sets on speculative calls; absent means interactive. */
export const REQUEST_PRIORITY_HEADER = "x-pcobooster-priority";

/** Unknown or missing values are interactive, so a stray header never demotes a call. */
export const parseRequestPriority = (
  value: string | null | undefined
): RequestPriority => (value === "speculative" ? "speculative" : "interactive");
