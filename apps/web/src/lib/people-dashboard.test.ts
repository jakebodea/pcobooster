import type {
  PeopleDashboardActivity,
  PeopleDashboardRoster,
} from "@pcobooster/contracts/people-schemas";
import { describe, expect, it } from "vitest";

import {
  assemblePeopleDashboard,
  defaultPeopleDashboardScope,
  initialScopeLoadCount,
  parsePeopleDashboardScope,
  PEOPLE_DASHBOARD_SAMPLE_SIZE,
  planPeopleDashboardBatches,
  resolveScopePersonIds,
  teamScope,
} from "@/lib/people-dashboard";

const roster = (
  count: number,
  ledTeamIds: string[] = []
): PeopleDashboardRoster => ({
  generatedAt: "2026-05-23T12:00:00.000Z",
  month: {
    year: 2026,
    monthIndex: 4,
    label: "May 2026",
    daysInMonth: 31,
    startsOnWeekday: 5,
  },
  people: Array.from({ length: count }, (_, index) => ({
    id: `person-${index}`,
    name: `Person ${index}`,
    initials: "P",
    photoThumbnailUrl: null,
    teams: index % 2 === 0 ? ["Vocals", "Band"] : ["Band"],
  })),
  teams: [
    {
      id: "band",
      name: "Band",
      serviceTypeName: "Sunday",
      personIds: Array.from({ length: count }, (_, index) => `person-${index}`),
    },
    {
      id: "vocals",
      name: "Vocals",
      serviceTypeName: "Sunday",
      personIds: Array.from({ length: count }, (_, index) => index)
        .filter((index) => index % 2 === 0)
        .map((index) => `person-${index}`),
    },
  ],
  ledTeamIds,
});

const activity = (
  id: string,
  overrides: Partial<PeopleDashboardActivity> = {}
): PeopleDashboardActivity => ({
  id,
  rhythm: {
    lastServedOn: "2026-05-10",
    nextServingOn: "2026-05-31",
    servedDays30: 1,
    servedDays90: 2,
    servedDays180: 4,
    upcomingDays30: 1,
    typicalGapDays: 21,
    requests180: 4,
    declined180: 0,
    pendingUpcoming: 0,
    nextPendingOn: null,
  },
  roles: "Vocals",
  status: "Upcoming",
  load: "normal",
  lastServed: "May 10",
  nextScheduled: "May 31",
  monthCount: 1,
  thirtyDayCount: 1,
  ninetyDayCount: 2,
  upcomingCount: 1,
  streak: "1 in 30 days",
  highlight: "Healthy cadence.",
  monthDays: [{ day: 31, kind: "service", status: "C" }],
  ...overrides,
});

describe(planPeopleDashboardBatches, () => {
  it("splits the first requested scope people into fixed-size calls", () => {
    expect(
      planPeopleDashboardBatches(["a", "b", "c", "d", "e"], 4, 3)
    ).toStrictEqual([["a", "b", "c"], ["d"]]);
    expect(planPeopleDashboardBatches([], 4, 3)).toStrictEqual([]);
  });
});

describe("people dashboard scopes", () => {
  it("lands a leader on their teams and everyone else on all teams", () => {
    expect(defaultPeopleDashboardScope(roster(2, ["vocals"]))).toBe("mine");
    expect(defaultPeopleDashboardScope(roster(2))).toBe("all");
  });

  it("resolves a scope to its people in roster order", () => {
    const data = roster(5, ["vocals"]);

    expect(resolveScopePersonIds(data, "mine")).toStrictEqual([
      "person-0",
      "person-2",
      "person-4",
    ]);
    expect(resolveScopePersonIds(data, teamScope("band"))).toHaveLength(5);
    expect(resolveScopePersonIds(data, teamScope("gone"))).toStrictEqual([]);
    expect(resolveScopePersonIds(data, "all")).toHaveLength(5);
  });

  it("loads a team scope whole and samples all teams", () => {
    expect(initialScopeLoadCount("mine", 70)).toBe(70);
    expect(initialScopeLoadCount(teamScope("band"), 500)).toBe(
      PEOPLE_DASHBOARD_SAMPLE_SIZE
    );
    expect(initialScopeLoadCount("all", 70)).toBe(PEOPLE_DASHBOARD_SAMPLE_SIZE);
  });

  it("reads scopes back from select values", () => {
    expect(parsePeopleDashboardScope("mine")).toBe("mine");
    expect(parsePeopleDashboardScope("team:42")).toBe("team:42");
    expect(parsePeopleDashboardScope("team:")).toBeNull();
    expect(parsePeopleDashboardScope("elsewhere")).toBeNull();
  });
});

describe(assemblePeopleDashboard, () => {
  it("shows the roster teams before any activity arrives", () => {
    const dashboard = assemblePeopleDashboard(roster(3, ["band"]), [], {
      scopePersonIds: ["person-0", "person-1", "person-2"],
      requestedPeopleCount: 3,
    });

    expect(dashboard.teams.map(({ id }) => id)).toStrictEqual([
      "band",
      "vocals",
    ]);
    expect(dashboard.ledTeamIds).toStrictEqual(["band"]);
    expect(dashboard.people).toStrictEqual([]);
    expect(dashboard.progress).toStrictEqual({
      scopePeopleCount: 3,
      requestedPeopleCount: 3,
      hydratedPeopleCount: 0,
    });
  });

  it("merges loaded activity into the scope's people, heaviest load first", () => {
    const dashboard = assemblePeopleDashboard(
      roster(4),
      [
        activity("person-0", { load: "low", monthCount: 0 }),
        activity("person-1", { load: "rest", monthCount: 4 }),
        activity("person-2", {
          load: "high",
          monthCount: 3,
          monthDays: [
            { day: 3, kind: "rehearsal" },
            { day: 4, kind: "service", status: "U" },
          ],
        }),
        // Loaded for another scope; not part of this one.
        activity("person-3", { load: "rest", monthCount: 5 }),
        activity("person-9"),
      ],
      {
        scopePersonIds: ["person-0", "person-1", "person-2"],
        requestedPeopleCount: 8,
      }
    );

    expect(dashboard.people.map(({ id }) => id)).toStrictEqual([
      "person-1",
      "person-2",
      "person-0",
    ]);
    expect(dashboard.people[0]).toMatchObject({
      id: "person-1",
      name: "Person 1",
      teams: ["Band"],
      load: "rest",
      rhythm: { lastServedOn: "2026-05-10" },
    });
    expect(dashboard.monthDays.find(({ day }) => day === 4)).toStrictEqual({
      day: 4,
      serviceCount: 1,
      confirmedServiceCount: 0,
      potentialServiceCount: 1,
      rehearsalCount: 0,
      blockoutCount: 0,
    });
    expect({
      matrixDays: dashboard.matrixDays,
      progress: dashboard.progress,
    }).toStrictEqual({
      matrixDays: [4, 31],
      progress: {
        scopePeopleCount: 3,
        requestedPeopleCount: 3,
        hydratedPeopleCount: 3,
      },
    });
  });
});
