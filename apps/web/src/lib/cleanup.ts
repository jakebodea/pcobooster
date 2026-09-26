import type {
  CleanupPersonActivity,
  CleanupStaleMonths,
} from "@pcobooster/contracts/cleanup";
import { CLEANUP_STALE_MONTHS } from "@pcobooster/contracts/cleanup";
import type { PeopleDashboardRoster } from "@pcobooster/contracts/people-schemas";

export type CleanupRosterPerson = PeopleDashboardRoster["people"][number];

const staleMonthLabels: Record<CleanupStaleMonths, string> = {
  3: "3 months",
  6: "6 months",
  12: "12 months",
  24: "2 years",
};

export const cleanupStaleMonthOptions = CLEANUP_STALE_MONTHS.map((months) => ({
  value: months,
  label: staleMonthLabels[months],
}));

export const parseCleanupStaleMonths = (
  value: string
): CleanupStaleMonths | null =>
  CLEANUP_STALE_MONTHS.find((months) => String(months) === value) ?? null;

/** Roster ids in fixed-size batches, in roster order. */
export const planCleanupPeopleBatches = (
  roster: PeopleDashboardRoster | undefined,
  batchSize: number
): string[][] => {
  const batches: string[][] = [];
  const ids = roster?.people.map((person) => person.id) ?? [];
  for (let start = 0; start < ids.length; start += batchSize) {
    batches.push(ids.slice(start, start + batchSize));
  }
  return batches;
};

export interface CleanupPeopleResult {
  /** Roster people with no schedules since the cutoff, in roster order. */
  stale: CleanupRosterPerson[];
  checkedCount: number;
  rosterCount: number;
}

/** Joins checked activity onto the roster; unchecked people are left out. */
export const assembleCleanupPeople = (
  roster: PeopleDashboardRoster,
  activities: readonly CleanupPersonActivity[]
): CleanupPeopleResult => {
  const countsById = new Map(
    activities.map((activity) => [activity.id, activity.scheduleCount])
  );
  return {
    stale: roster.people.filter((person) => countsById.get(person.id) === 0),
    checkedCount: roster.people.filter((person) => countsById.has(person.id))
      .length,
    rosterCount: roster.people.length,
  };
};

/** Planning Center's own pages, where songs are hidden and people archived. */
export const planningCenterSongUrl = (songId: string) =>
  `https://services.planningcenteronline.com/songs/${encodeURIComponent(songId)}`;

export const planningCenterPersonUrl = (personId: string) =>
  `https://people.planningcenteronline.com/people/AC${encodeURIComponent(personId)}`;
