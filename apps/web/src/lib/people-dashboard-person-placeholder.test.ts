import { describe, expect, it } from "vitest";

import type { PeopleDashboardData } from "@/lib/people-dashboard";
import { getCachedPeopleDashboardPersonDetail } from "@/lib/people-dashboard-person-placeholder";
import type { TeamMember } from "@/lib/team-health";

const dashboardPerson = (id: string): TeamMember => ({
  id,
  name: "Alex Adams",
  initials: "AA",
  photoThumbnailUrl: null,
  teams: ["Band"],
  roles: "Vocals",
  status: "Available soon",
  load: "normal",
  lastServed: "May 12",
  nextScheduled: "May 31",
  nextRehearsal: "Not scheduled",
  monthCount: 2,
  thirtyDayCount: 2,
  ninetyDayCount: 4,
  upcomingCount: 1,
  streak: "2 in 30 days",
  highlight: "Healthy cadence.",
  monthDays: [],
  rhythm: {
    lastServedOn: "2026-05-10",
    nextServingOn: "2026-05-31",
    servedDays30: 1,
    servedDays90: 2,
    servedDays180: 4,
    upcomingDays30: 1,
    typicalGapDays: 21,
    requests180: 5,
    declined180: 0,
    pendingUpcoming: 1,
    nextPendingOn: "2026-05-31",
  },
});

const dashboard = (): PeopleDashboardData => ({
  generatedAt: "2026-05-23T12:00:00.000Z",
  month: {
    year: 2026,
    monthIndex: 4,
    label: "May 2026",
    daysInMonth: 31,
    startsOnWeekday: 5,
  },
  teams: [
    {
      id: "team-1",
      name: "Band",
      serviceTypeName: null,
      personIds: ["person-1"],
    },
  ],
  ledTeamIds: [],
  people: [dashboardPerson("person-1")],
  monthDays: [],
  matrixDays: [],
  progress: {
    scopePeopleCount: 1,
    requestedPeopleCount: 1,
    hydratedPeopleCount: 1,
  },
});

describe(getCachedPeopleDashboardPersonDetail, () => {
  it("builds a person detail placeholder from cached dashboard data", () => {
    const placeholder = getCachedPeopleDashboardPersonDetail(
      [dashboard()],
      "person-1",
      null
    );

    expect(placeholder?.person.name).toBe("Alex Adams");
    expect(placeholder?.month.label).toBe("May 2026");
    expect(placeholder?.previousMonth).toBe("2026-04");
    expect(placeholder?.nextMonth).toBe("2026-06");
    expect(placeholder?.requestBudget.unresolvedRehearsalTimes).toBe(0);
  });

  it("does not reuse cached dashboard data for a different requested month", () => {
    const placeholder = getCachedPeopleDashboardPersonDetail(
      [dashboard()],
      "person-1",
      "2026-06"
    );

    expect(placeholder).toBeUndefined();
  });
});
