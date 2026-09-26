import type {
  PeopleDashboardActivity,
  PeopleDashboardPerson,
  PeopleDashboardPersonDetail,
  PeopleDashboardRoster,
} from "@pcobooster/contracts/people-schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearCachedPeopleDashboards,
  readCachedPeopleDashboardActivity,
  readCachedPeopleDashboardPerson,
  readCachedPeopleDashboardRoster,
  writeCachedPeopleDashboardActivity,
  writeCachedPeopleDashboardPerson,
  writeCachedPeopleDashboardRoster,
} from "@/lib/people-dashboard-cache";

const installLocalStorageMock = () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      get length() {
        return storage.size;
      },
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => [...storage.keys()][index] ?? null,
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
};

const month = {
  year: 2026,
  monthIndex: 4,
  label: "May 2026",
  daysInMonth: 31,
  startsOnWeekday: 5,
};

const dashboardPerson: PeopleDashboardPerson = {
  id: "person-1",
  name: "Andrew Hinea",
  initials: "AH",
  photoThumbnailUrl: null,
  teams: ["Band"],
  roles: "Acoustic Guitar",
  status: "Available soon",
  load: "normal",
  lastServed: "May 17",
  nextScheduled: "May 31",
  monthCount: 2,
  thirtyDayCount: 2,
  ninetyDayCount: 5,
  upcomingCount: 1,
  streak: "2 this month",
  highlight: "Available soon",
  monthDays: [
    {
      day: 31,
      kind: "service",
      positionName: "Acoustic Guitar",
      serviceTypeName: "Agape Worship Services",
      status: "U",
      planUrl: "/services/service-type-1/plans/plan-1/lineup",
    },
  ],
};

const roster = (): PeopleDashboardRoster => ({
  generatedAt: "2026-05-23T12:00:00.000Z",
  month,
  people: [
    {
      id: "person-1",
      name: "Andrew Hinea",
      initials: "AH",
      photoThumbnailUrl: null,
      teams: ["Band"],
    },
  ],
  teams: [
    {
      id: "team-1",
      name: "Band",
      serviceTypeName: "Sunday",
      personIds: ["person-1"],
    },
  ],
  ledTeamIds: ["team-1"],
});

const activity = (id: string): PeopleDashboardActivity => {
  const {
    name: _name,
    initials: _initials,
    photoThumbnailUrl: _photo,
    teams: _teams,
    ...serving
  } = dashboardPerson;
  return {
    ...serving,
    id,
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
  };
};

const personDetail = (): PeopleDashboardPersonDetail => ({
  generatedAt: "2026-05-23T12:10:00.000Z",
  month,
  previousMonth: "2026-04",
  nextMonth: "2026-06",
  person: dashboardPerson,
  trend: [
    {
      month: "2026-05",
      label: "May",
      services: 2,
      rehearsals: 1,
    },
  ],
  requestBudget: {
    limit: 36,
    planningCenterRequests: 4,
    unresolvedRehearsalTimes: 0,
  },
});

const storedDashboardParts = () => ({
  roster: readCachedPeopleDashboardRoster() !== undefined,
  activity: readCachedPeopleDashboardActivity(["person-1"]) !== undefined,
});

describe("people dashboard cache", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    installLocalStorageMock();
  });

  it("round-trips the roster with the original saved timestamp", () => {
    const savedAt = new Date("2026-05-23T12:05:00.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(savedAt);

    writeCachedPeopleDashboardRoster(roster());

    expect(readCachedPeopleDashboardRoster()).toStrictEqual({
      savedAt,
      data: roster(),
    });
  });

  it("reads saved activity only when every requested person has some", () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1000);
    writeCachedPeopleDashboardActivity([activity("person-1")]);
    now.mockReturnValue(2000);
    writeCachedPeopleDashboardActivity([activity("person-2")]);

    expect(
      readCachedPeopleDashboardActivity(["person-1", "person-2"])
    ).toStrictEqual({
      savedAt: 1000,
      data: [activity("person-1"), activity("person-2")],
    });
    expect(
      readCachedPeopleDashboardActivity(["person-1", "person-3"])
    ).toBeUndefined();
  });

  it("drops activity saved more than a day before the latest save", () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(0);
    writeCachedPeopleDashboardActivity([activity("person-1")]);
    now.mockReturnValue(24 * 60 * 60 * 1000);
    writeCachedPeopleDashboardActivity([activity("person-2")]);

    expect(readCachedPeopleDashboardActivity(["person-1"])).toBeUndefined();
    expect(readCachedPeopleDashboardActivity(["person-2"])?.data).toStrictEqual(
      [activity("person-2")]
    );
  });

  it("clears all people dashboard snapshots without touching unrelated storage", () => {
    writeCachedPeopleDashboardRoster(roster());
    writeCachedPeopleDashboardActivity([activity("person-1")]);
    writeCachedPeopleDashboardPerson("person-1", "2026-05", personDetail());
    window.localStorage.setItem("unrelated", "keep");
    window.localStorage.setItem("pcobooster:people-dashboard:v1:roster", "{}");

    clearCachedPeopleDashboards();

    expect(readCachedPeopleDashboardRoster()).toBeUndefined();
    expect(readCachedPeopleDashboardActivity(["person-1"])).toBeUndefined();
    expect(
      readCachedPeopleDashboardPerson("person-1", "2026-05")
    ).toBeUndefined();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
    expect(
      window.localStorage.getItem("pcobooster:people-dashboard:v1:roster")
    ).toBeNull();
  });

  it("round-trips person detail snapshots with the saved timestamp", () => {
    const savedAt = new Date("2026-05-23T12:15:00.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(savedAt);

    writeCachedPeopleDashboardPerson("person-1", "2026-05", personDetail());

    expect(
      readCachedPeopleDashboardPerson("person-1", "2026-05")
    ).toStrictEqual({
      savedAt,
      data: personDetail(),
    });
  });

  it("does not read a different person or month detail snapshot", () => {
    writeCachedPeopleDashboardPerson("person-1", "2026-05", personDetail());

    expect(
      readCachedPeopleDashboardPerson("person-2", "2026-05")
    ).toBeUndefined();
    expect(
      readCachedPeopleDashboardPerson("person-1", "2026-06")
    ).toBeUndefined();
  });

  it("ignores invalid person detail snapshots", () => {
    window.localStorage.setItem(
      "pcobooster:people-dashboard:v1:person:person-1:2026-05",
      JSON.stringify({
        savedAt: Date.now(),
        data: { person: { id: "person-1" } },
      })
    );

    expect(
      readCachedPeopleDashboardPerson("person-1", "2026-05")
    ).toBeUndefined();
  });

  it("isolates presentation storage from live data and other seeds (roster and activity)", () => {
    const dataset = { presentationScope: "live" };
    vi.stubGlobal("document", { documentElement: { dataset } });
    writeCachedPeopleDashboardRoster(roster());
    writeCachedPeopleDashboardActivity([activity("person-1")]);
    dataset.presentationScope = "present-v1-seed-a";
    const seedA = storedDashboardParts();
    writeCachedPeopleDashboardRoster(roster());
    const seedAWritten = storedDashboardParts();
    dataset.presentationScope = "present-v1-seed-b";
    const seedB = storedDashboardParts();
    dataset.presentationScope = "live";

    expect({
      seedA,
      seedAWritten,
      seedB,
      live: storedDashboardParts(),
    }).toStrictEqual({
      seedA: { roster: false, activity: false },
      seedAWritten: { roster: true, activity: false },
      seedB: { roster: false, activity: false },
      live: { roster: true, activity: true },
    });
    vi.unstubAllGlobals();
  });

  it("isolates presentation storage from live data and other seeds (readCachedPeopleDashboardPerson)", () => {
    const dataset = { presentationScope: "live" };
    vi.stubGlobal("document", { documentElement: { dataset } });
    writeCachedPeopleDashboardPerson("person-1", "2026-05", personDetail());
    expect(
      readCachedPeopleDashboardPerson("person-1", "2026-05")
    ).toBeDefined();
    dataset.presentationScope = "present-v1-seed-a";
    expect(
      readCachedPeopleDashboardPerson("person-1", "2026-05")
    ).toBeUndefined();
    writeCachedPeopleDashboardPerson("person-1", "2026-05", personDetail());
    expect(
      readCachedPeopleDashboardPerson("person-1", "2026-05")
    ).toBeDefined();
    dataset.presentationScope = "present-v1-seed-b";
    expect(
      readCachedPeopleDashboardPerson("person-1", "2026-05")
    ).toBeUndefined();
    dataset.presentationScope = "live";
    expect(
      readCachedPeopleDashboardPerson("person-1", "2026-05")
    ).toBeDefined();
    vi.unstubAllGlobals();
  });
});
