import type { PeopleDashboardRoster } from "@pcobooster/contracts/people-schemas";
import { describe, expect, it } from "vitest";

import {
  assembleCleanupPeople,
  parseCleanupStaleMonths,
  planCleanupPeopleBatches,
} from "@/lib/cleanup";

const roster = (ids: string[]): PeopleDashboardRoster => ({
  generatedAt: "2026-09-25T00:00:00.000Z",
  month: {
    year: 2026,
    monthIndex: 8,
    label: "September 2026",
    daysInMonth: 30,
    startsOnWeekday: 2,
  },
  people: ids.map((id) => ({
    id,
    name: `Person ${id}`,
    initials: "P",
    photoThumbnailUrl: null,
    teams: ["Band"],
  })),
});

describe(planCleanupPeopleBatches, () => {
  it("splits the roster into fixed-size batches", () => {
    expect(
      planCleanupPeopleBatches(roster(["a", "b", "c", "d", "e"]), 2)
    ).toStrictEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("plans nothing before the roster loads", () => {
    expect(planCleanupPeopleBatches(undefined, 2)).toStrictEqual([]);
  });
});

describe(assembleCleanupPeople, () => {
  it("lists only checked people with no schedules, in roster order", () => {
    const result = assembleCleanupPeople(roster(["a", "b", "c", "d"]), [
      { id: "c", scheduleCount: 0 },
      { id: "a", scheduleCount: 0 },
      { id: "b", scheduleCount: 3 },
    ]);
    expect(result.stale.map((person) => person.id)).toStrictEqual(["a", "c"]);
    expect(result.checkedCount).toBe(3);
    expect(result.rosterCount).toBe(4);
  });
});

describe(parseCleanupStaleMonths, () => {
  it("accepts only the offered thresholds", () => {
    expect(parseCleanupStaleMonths("12")).toBe(12);
    expect(parseCleanupStaleMonths("5")).toBeNull();
  });
});
