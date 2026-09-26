import type { ServingRhythm } from "@pcobooster/api/modules/planning-center/people-dashboard-types";
import {
  formatCalendarDayInTimeZone,
  orgCalendarDaysRefMinusItem,
} from "@pcobooster/planning-center-models/calendar";
import {
  isNonEmptyString,
  isString,
} from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";

/** How far back the rhythm reads; schedules must be fetched from at least this far back. */
export const RHYTHM_HISTORY_DAYS = 180;
/** A typical gap needs at least this many gaps between served days to mean anything. */
const MIN_GAPS_FOR_RHYTHM = 2;

/** One schedule's serving days, already mapped to org calendar days. */
export interface RhythmSchedule {
  readonly status: string;
  /** The schedule's own date, for request and response counts. */
  readonly sortDate: Date;
  /** Service (not rehearsal) instants this schedule covers. */
  readonly serviceDates: readonly Date[];
}

const normalizedStatus = (status: string) => status.trim().toLowerCase();

export const isDeclinedStatus = (status: string) => {
  const normalized = normalizedStatus(status);
  return normalized === "d" || normalized === "declined";
};

const isUnconfirmedStatus = (status: string) => {
  const normalized = normalizedStatus(status);
  return normalized === "u" || normalized === "unconfirmed";
};

export const scheduleStatus = (schedule: PCResource) =>
  isString(schedule.attributes.status) ? schedule.attributes.status : "";

export const scheduleSortDate = (schedule: PCResource): Date | undefined =>
  isNonEmptyString(schedule.attributes.sort_date)
    ? new Date(schedule.attributes.sort_date)
    : undefined;

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/**
 * How a person has been serving and responding, on org calendar days. Served
 * days are distinct past service days (rehearsals excluded) from schedules the
 * person did not decline; the typical gap is the median gap between them.
 * Requests and declines count schedules dated in the history window or later.
 */
export const buildServingRhythm = (
  schedules: readonly RhythmSchedule[],
  now: Date,
  orgTimeZone: string
): ServingRhythm => {
  const todayKey = formatCalendarDayInTimeZone(now, orgTimeZone);
  const daysAgo = (date: Date) =>
    orgCalendarDaysRefMinusItem(
      formatCalendarDayInTimeZone(date, orgTimeZone),
      todayKey
    );

  const pastDays = new Map<string, number>();
  const futureDays = new Map<string, number>();
  let requests = 0;
  let declined = 0;
  let pendingUpcoming = 0;
  let nextPending: Date | undefined;

  for (const schedule of schedules) {
    const scheduleDaysAgo = daysAgo(schedule.sortDate);
    const inWindow = scheduleDaysAgo <= RHYTHM_HISTORY_DAYS;
    if (inWindow) {
      requests += 1;
    }
    if (isDeclinedStatus(schedule.status)) {
      declined += inWindow ? 1 : 0;
      continue;
    }
    // Today's unanswered request still needs an answer.
    if (scheduleDaysAgo <= 0 && isUnconfirmedStatus(schedule.status)) {
      pendingUpcoming += 1;
      if (!nextPending || schedule.sortDate < nextPending) {
        nextPending = schedule.sortDate;
      }
    }
    for (const date of schedule.serviceDates) {
      const dayKey = formatCalendarDayInTimeZone(date, orgTimeZone);
      const ago = daysAgo(date);
      if (ago >= 0) {
        pastDays.set(dayKey, ago);
      } else {
        futureDays.set(dayKey, ago);
      }
    }
  }

  const pastAgo = [...pastDays.values()].filter(
    (ago) => ago <= RHYTHM_HISTORY_DAYS
  );
  const servedWithin = (days: number) =>
    pastAgo.filter((ago) => ago <= days).length;
  const sortedPastAgo = pastAgo.toSorted((a, b) => a - b);
  const gaps = sortedPastAgo
    .slice(1)
    .map((ago, index) => ago - (sortedPastAgo[index] ?? ago));
  const pastKeys = [...pastDays.keys()].toSorted();
  const futureKeys = [...futureDays.keys()].toSorted();

  return {
    lastServedOn: pastKeys.at(-1) ?? null,
    nextServingOn: futureKeys[0] ?? null,
    servedDays30: servedWithin(30),
    servedDays90: servedWithin(90),
    servedDays180: pastAgo.length,
    upcomingDays30: [...futureDays.values()].filter((ago) => ago >= -30).length,
    typicalGapDays:
      gaps.length >= MIN_GAPS_FOR_RHYTHM ? Math.round(median(gaps)) : null,
    requests180: requests,
    declined180: declined,
    pendingUpcoming,
    nextPendingOn: nextPending
      ? formatCalendarDayInTimeZone(nextPending, orgTimeZone)
      : null,
  };
};
