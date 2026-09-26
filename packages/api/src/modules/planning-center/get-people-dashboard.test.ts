import {
  getPeopleDashboardActivity,
  getPeopleDashboardRoster,
} from "@pcobooster/api/modules/planning-center/get-people-dashboard";
import type { PeopleDashboardActivityDependencies } from "@pcobooster/api/modules/planning-center/get-people-dashboard";
import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import { PlanningCenterNetworkError } from "@pcobooster/api/planning-center/network-error";
import {
  pagesFor,
  PLANNING_CENTER_REQUEST_CAP,
  PROGRESSIVE_REQUEST_BUDGET,
} from "@pcobooster/api/planning-center/request-budget";
import type {
  PlanningCenterPeopleService,
  TeamRoster,
} from "@pcobooster/api/planning-center/services/people-service";
import type { PlanningCenterPlansService } from "@pcobooster/api/planning-center/services/plans-service";
import { planningCenterBudgetFailures } from "@pcobooster/api/testing/planning-center-failures";
import { countedRead } from "@pcobooster/api/testing/planning-center-requests";
import type { JsonObject } from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

const person = (
  id: string,
  firstName: string,
  lastName: string,
  attributes: JsonObject = {}
): PCResource => ({
  id,
  type: "Person",
  attributes: { first_name: firstName, last_name: lastName, ...attributes },
});

const schedule = (
  id: string,
  sortDate: string,
  {
    serviceTypeId = "sunday",
    timeIds = [],
    status = "C",
  }: { serviceTypeId?: string; timeIds?: string[]; status?: string } = {}
): PCResource => ({
  id,
  type: "Schedule",
  attributes: {
    sort_date: sortDate,
    status,
    team_position_name: "Vocals",
    service_type_name: "Sunday",
  },
  relationships: {
    plan: { data: { id: `plan-${id}`, type: "Plan" } },
    service_type: { data: { id: serviceTypeId, type: "ServiceType" } },
    times: {
      data: timeIds.map((timeId) => ({ id: timeId, type: "PlanTime" })),
    },
  },
});

const planTime = (
  id: string,
  timeType: "service" | "rehearsal",
  startsAt: string
): PCResource => ({
  id,
  type: "PlanTime",
  attributes: { time_type: timeType, starts_at: startsAt },
});

const teamRoster = (
  id: string,
  name: string,
  personIds: string[],
  {
    leaderPersonIds = [],
    serviceTypeName = "Sunday",
  }: { leaderPersonIds?: string[]; serviceTypeName?: string | null } = {}
): TeamRoster => ({ id, name, serviceTypeName, personIds, leaderPersonIds });

const rosterService = (people: PCResource[], teams: TeamRoster[] = []) => ({
  getAllPeopleFromTeams: vi
    .fn<PlanningCenterPeopleService["getAllPeopleFromTeams"]>()
    .mockReturnValue(Effect.succeed({ people, included: [], teams })),
});

const activityDependencies = ({
  schedulesByPerson = {},
  plansByServiceType = {},
  orgTimeZone = "UTC",
}: {
  orgTimeZone?: string;
  schedulesByPerson?: Record<
    string,
    { data: PCResource[]; included?: PCResource[] }
  >;
  plansByServiceType?: Record<
    string,
    { data: PCResource[]; included: PCResource[] }
  >;
}) => {
  const getPersonSchedulesAfter = vi.fn<
    PlanningCenterPeopleService["getPersonSchedulesAfter"]
  >((personId) => {
    const data = schedulesByPerson[personId]?.data ?? [];
    return countedRead(
      { data, included: schedulesByPerson[personId]?.included ?? [] },
      pagesFor(data.length)
    );
  });
  const getPlansWithIncludedInDateRange = vi.fn<
    PlanningCenterPlansService["getPlansWithIncludedInDateRange"]
  >((serviceTypeId) =>
    countedRead(plansByServiceType[serviceTypeId] ?? { data: [], included: [] })
  );
  const dependencies: PeopleDashboardActivityDependencies = {
    peopleService: { getPersonSchedulesAfter },
    plansService: { getPlansWithIncludedInDateRange },
    resolveTimeZone: countedRead(orgTimeZone),
  };
  return {
    dependencies,
    getPersonSchedulesAfter,
    getPlansWithIncludedInDateRange,
  };
};

const plan = (id: string): PCResource => ({
  id,
  type: "Plan",
  attributes: {},
});

describe(getPeopleDashboardRoster, () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists active roster people by last name with their teams and the org month", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-01T01:00:00.000Z") });
    const service = rosterService(
      [
        person("person-3", "Casey", "Carter"),
        person("person-1", "Alex", "Adams", {
          photo_thumbnail_url: "https://example.com/alex.png",
        }),
        person("person-2", "Blair", "Adams"),
        person("person-4", "Drew", "Archived", {
          archived_at: "2026-01-01T00:00:00Z",
        }),
      ],
      [
        teamRoster("band", "Band", ["person-1", "person-3"]),
        teamRoster("vocals", "Vocals", ["person-1"]),
        teamRoster("tech", "Tech", ["person-1"]),
        teamRoster("hosts", "Hosts", ["person-1"]),
      ]
    );

    const roster = await Effect.runPromise(
      getPeopleDashboardRoster({
        peopleService: service,
        resolveTimeZone: Effect.succeed("America/Los_Angeles"),
        viewerPersonId: null,
      })
    );

    expect(roster.month.label).toBe("April 2026");
    expect(roster.people).toStrictEqual([
      {
        id: "person-1",
        name: "Alex Adams",
        initials: "AA",
        photoThumbnailUrl: "https://example.com/alex.png",
        teams: ["Band", "Vocals", "Tech"],
      },
      {
        id: "person-2",
        name: "Blair Adams",
        initials: "BA",
        photoThumbnailUrl: null,
        teams: ["Services"],
      },
      {
        id: "person-3",
        name: "Casey Carter",
        initials: "CC",
        photoThumbnailUrl: null,
        teams: ["Band"],
      },
    ]);
    expect(service.getAllPeopleFromTeams).toHaveBeenCalledOnce();
    expect(roster.ledTeamIds).toStrictEqual([]);
  });

  it("lists teams with their listed members and the teams the viewer leads", async () => {
    const service = rosterService(
      [
        person("person-1", "Alex", "Adams"),
        person("person-2", "Blair", "Brown"),
        person("person-3", "Casey", "Archived", {
          archived_at: "2026-01-01T00:00:00Z",
        }),
      ],
      [
        teamRoster("youth-band", "Band", ["person-2"], {
          serviceTypeName: "Youth",
          leaderPersonIds: ["person-1"],
        }),
        teamRoster("band", "Band", ["person-1", "person-2", "person-3"], {
          leaderPersonIds: ["person-1"],
        }),
        teamRoster("hosts", "Hosts", ["person-2"], {
          leaderPersonIds: ["person-2"],
        }),
        teamRoster("empty", "Archived only", ["person-3"], {
          leaderPersonIds: ["person-1"],
        }),
      ]
    );

    const roster = await Effect.runPromise(
      getPeopleDashboardRoster({
        peopleService: service,
        resolveTimeZone: Effect.succeed("UTC"),
        viewerPersonId: "person-1",
      })
    );

    expect(roster.teams).toStrictEqual([
      {
        id: "band",
        name: "Band",
        serviceTypeName: "Sunday",
        personIds: ["person-1", "person-2"],
      },
      {
        id: "youth-band",
        name: "Band",
        serviceTypeName: "Youth",
        personIds: ["person-2"],
      },
      {
        id: "hosts",
        name: "Hosts",
        serviceTypeName: "Sunday",
        personIds: ["person-2"],
      },
    ]);
    expect(roster.ledTeamIds).toStrictEqual(["youth-band", "band"]);
  });

  it("fails instead of returning an empty roster when the team read fails", async () => {
    const failure = new PlanningCenterNetworkError({
      cause: new Error("Too many subrequests"),
    });
    const service = rosterService([]);
    service.getAllPeopleFromTeams.mockReturnValue(Effect.fail(failure));

    await expect(
      Effect.runPromise(
        Effect.flip(
          getPeopleDashboardRoster({
            peopleService: service,
            resolveTimeZone: Effect.succeed("UTC"),
            viewerPersonId: null,
          })
        )
      )
    ).resolves.toBe(failure);
  });
});

describe(getPeopleDashboardActivity, () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts past and upcoming services from schedules after the 90-day window start", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-23T12:00:00.000Z") });
    const { dependencies, getPersonSchedulesAfter } = activityDependencies({
      schedulesByPerson: {
        "person-1": {
          data: [
            schedule("past", "2026-05-10T17:00:00.000Z"),
            schedule("next", "2026-05-31T17:00:00.000Z", { status: "U" }),
          ],
        },
      },
    });

    const batch = await Effect.runPromise(
      getPeopleDashboardActivity({ personIds: ["person-1"], dependencies })
    );

    expect(getPersonSchedulesAfter.mock.calls).toStrictEqual([
      [
        "person-1",
        "2025-11-23",
        2,
        { includeDeclined: true, newestFirst: true },
      ],
    ]);
    expect(batch).toMatchObject({
      deferredPersonIds: [],
      people: [
        {
          id: "person-1",
          lastServed: "May 10",
          nextScheduled: "May 31",
          monthCount: 2,
          thirtyDayCount: 2,
          upcomingCount: 1,
        },
      ],
    });
    expect(batch.people[0]?.monthDays.map(({ day }) => day)).toStrictEqual([
      10, 31,
    ]);
    expect(batch.requestBudget).toStrictEqual({
      limit: PROGRESSIVE_REQUEST_BUDGET,
      planningCenterRequests: 2,
      scheduleRequests: 1,
      planTimeRequests: 0,
    });
  });

  it("labels late-evening services with their org calendar day, not the host's", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-15T19:00:00.000Z") });
    const { dependencies } = activityDependencies({
      orgTimeZone: "America/Los_Angeles",
      schedulesByPerson: {
        "person-1": {
          data: [
            // Wednesday September 9, 7:00 PM Pacific; September 10 in UTC.
            schedule("past", "2026-09-10T02:00:00.000Z"),
            // Saturday September 19, 8:30 PM Pacific; September 20 in UTC.
            schedule("next", "2026-09-20T03:30:00.000Z", { status: "U" }),
          ],
        },
      },
    });

    const batch = await Effect.runPromise(
      getPeopleDashboardActivity({ personIds: ["person-1"], dependencies })
    );

    expect(batch.people[0]).toMatchObject({
      lastServed: "Sep 9",
      nextScheduled: "Sep 19",
    });
    expect(batch.people[0]?.monthDays.map(({ day }) => day)).toStrictEqual([
      9, 19,
    ]);
  });

  it("reports the serving rhythm and leaves declined schedules out of serving counts", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-23T12:00:00.000Z") });
    const { dependencies, getPlansWithIncludedInDateRange } =
      activityDependencies({
        schedulesByPerson: {
          "person-1": {
            data: [
              // Older than the plan-time window: counted, times not resolved.
              schedule("old", "2026-01-04T17:00:00.000Z", {
                serviceTypeId: "old-type",
                timeIds: ["rehearsal-old"],
              }),
              schedule("feb", "2026-02-22T17:00:00.000Z"),
              schedule("apr", "2026-04-19T17:00:00.000Z"),
              schedule("declined", "2026-05-17T17:00:00.000Z", {
                status: "D",
                timeIds: ["rehearsal-declined"],
              }),
              schedule("pending", "2026-06-07T17:00:00.000Z", {
                status: "U",
              }),
            ],
          },
        },
      });

    const batch = await Effect.runPromise(
      getPeopleDashboardActivity({ personIds: ["person-1"], dependencies })
    );

    expect(getPlansWithIncludedInDateRange).not.toHaveBeenCalled();
    expect(batch.people[0]?.rhythm).toStrictEqual({
      lastServedOn: "2026-04-19",
      nextServingOn: "2026-06-07",
      servedDays30: 0,
      servedDays90: 2,
      servedDays180: 3,
      upcomingDays30: 1,
      typicalGapDays: 53,
      requests180: 5,
      declined180: 1,
      pendingUpcoming: 1,
      nextPendingOn: "2026-06-07",
    });
    expect(batch.people[0]).toMatchObject({ lastServed: "Apr 19" });
    expect(batch.people[0]?.monthDays).toStrictEqual([]);
  });

  it("classifies rehearsals with one plan-range read per service type, not per plan", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-23T12:00:00.000Z") });
    const { dependencies, getPlansWithIncludedInDateRange } =
      activityDependencies({
        schedulesByPerson: {
          "person-1": {
            data: [
              schedule("a", "2026-05-17T17:00:00.000Z", {
                timeIds: ["service-a", "rehearsal-a"],
              }),
            ],
            included: [
              planTime("service-a", "service", "2026-05-17T17:00:00.000Z"),
            ],
          },
          "person-2": {
            data: [
              schedule("b", "2026-05-24T17:00:00.000Z", {
                timeIds: ["rehearsal-b"],
              }),
            ],
          },
        },
        plansByServiceType: {
          sunday: {
            data: [plan("plan-a"), plan("plan-b")],
            included: [
              planTime("rehearsal-a", "rehearsal", "2026-05-14T01:00:00.000Z"),
              planTime("rehearsal-b", "rehearsal", "2026-05-21T01:00:00.000Z"),
            ],
          },
        },
      });

    const batch = await Effect.runPromise(
      getPeopleDashboardActivity({
        personIds: ["person-1", "person-2"],
        dependencies,
      })
    );

    expect(getPlansWithIncludedInDateRange.mock.calls).toStrictEqual([
      ["sunday", "2026-02-21", "2027-05-24", "plan_times", "UTC"],
    ]);
    expect(
      batch.people.map(({ id, monthDays }) => [
        id,
        monthDays.map(({ day, kind }) => `${day}:${kind}`),
      ])
    ).toStrictEqual([
      ["person-1", ["14:rehearsal", "17:service"]],
      ["person-2", ["21:rehearsal"]],
    ]);
    expect(batch.people[1]).toMatchObject({ monthCount: 0 });
    expect(batch.requestBudget.planTimeRequests).toBe(1);
  });

  it("defers people whose rehearsal times do not fit in the request budget", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-23T12:00:00.000Z") });
    const personIds = Array.from(
      { length: 16 },
      (_, index) => `person-${index}`
    );
    // Every person fills two schedule pages (1 + 32 requests), which leaves
    // room for one plan-range read; the other service types have to wait.
    const heavySchedules = (serviceTypeId: string) => ({
      data: Array.from({ length: 150 }, (_, index) =>
        schedule(`${serviceTypeId}-${index}`, "2026-05-17T17:00:00.000Z", {
          serviceTypeId,
          timeIds: [`rehearsal-${serviceTypeId}`],
        })
      ),
    });
    const { dependencies, getPlansWithIncludedInDateRange } =
      activityDependencies({
        schedulesByPerson: {
          ...Object.fromEntries(
            personIds.map((id) => [id, heavySchedules("st-a")])
          ),
          "person-1": heavySchedules("st-b"),
          "person-2": heavySchedules("st-c"),
        },
      });

    const batch = await Effect.runPromise(
      getPeopleDashboardActivity({ personIds, dependencies })
    );

    expect(
      getPlansWithIncludedInDateRange.mock.calls.map(([id]) => id)
    ).toStrictEqual(["st-a"]);
    expect(batch.deferredPersonIds).toStrictEqual(["person-1", "person-2"]);
    expect(batch.people.map(({ id }) => id)).toStrictEqual(
      personIds.filter((id) => id !== "person-1" && id !== "person-2")
    );
    expect(batch.requestBudget).toStrictEqual({
      limit: PROGRESSIVE_REQUEST_BUDGET,
      planningCenterRequests: 34,
      scheduleRequests: 32,
      planTimeRequests: 1,
    });
  });

  it("finishes the first person even when their service types need more ranges than the budget leaves", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-23T12:00:00.000Z") });
    const personIds = Array.from(
      { length: 16 },
      (_, index) => `person-${index}`
    );
    const serviceTypes = ["st-0", "st-1", "st-2", "st-3", "st-4"];
    const heavySchedules = (types: readonly string[]) => ({
      data: Array.from({ length: 150 }, (_, index) => {
        const serviceTypeId = types[index % types.length] ?? "st-0";
        return schedule(
          `${serviceTypeId}-${index}`,
          "2026-05-17T17:00:00.000Z",
          {
            serviceTypeId,
            timeIds: [`rehearsal-${serviceTypeId}`],
          }
        );
      }),
    });
    const { dependencies, getPlansWithIncludedInDateRange } =
      activityDependencies({
        schedulesByPerson: {
          ...Object.fromEntries(
            personIds.map((id) => [id, heavySchedules(["st-9"])])
          ),
          "person-0": heavySchedules(serviceTypes),
        },
      });

    const batch = await Effect.runPromise(
      getPeopleDashboardActivity({ personIds, dependencies })
    );

    expect({
      firstPerson: batch.people[0]?.id,
      ranges: getPlansWithIncludedInDateRange.mock.calls.map(([id]) => id),
      underCap:
        batch.requestBudget.planningCenterRequests <=
        PLANNING_CENTER_REQUEST_CAP,
    }).toStrictEqual({
      firstPerson: "person-0",
      ranges: ["st-0", "st-1"],
      underCap: true,
    });
  });

  it("defers people beyond what the budget can read schedules for", async () => {
    const personIds = Array.from(
      { length: 25 },
      (_, index) => `person-${index}`
    );
    const { dependencies, getPersonSchedulesAfter } = activityDependencies({});

    const batch = await Effect.runPromise(
      getPeopleDashboardActivity({ personIds, dependencies })
    );

    expect(getPersonSchedulesAfter).toHaveBeenCalledTimes(16);
    expect(batch.people).toHaveLength(16);
    expect(batch.deferredPersonIds).toStrictEqual(personIds.slice(16));
  });

  it("still counts schedules in another organization whose plan times it cannot read", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-23T12:00:00.000Z") });
    const { dependencies, getPlansWithIncludedInDateRange } =
      activityDependencies({
        schedulesByPerson: {
          "person-1": {
            data: [
              schedule("a", "2026-05-17T17:00:00.000Z", {
                serviceTypeId: "elsewhere",
                timeIds: ["rehearsal-a"],
              }),
            ],
          },
        },
      });
    getPlansWithIncludedInDateRange.mockReturnValue(
      Effect.fail(
        new PlanningCenterApiError({ message: "Not Found", status: 404 })
      )
    );

    const batch = await Effect.runPromise(
      getPeopleDashboardActivity({ personIds: ["person-1"], dependencies })
    );

    expect(batch.people[0]).toMatchObject({
      lastServed: "May 17",
      thirtyDayCount: 1,
    });
  });

  it.each(planningCenterBudgetFailures())(
    "fails the batch when a plan-range read fails with %s",
    async (failure) => {
      vi.useFakeTimers({ now: new Date("2026-05-23T12:00:00.000Z") });
      const { dependencies, getPlansWithIncludedInDateRange } =
        activityDependencies({
          schedulesByPerson: {
            "person-1": {
              data: [
                schedule("a", "2026-05-17T17:00:00.000Z", {
                  timeIds: ["rehearsal-a"],
                }),
              ],
            },
          },
        });
      getPlansWithIncludedInDateRange.mockReturnValue(Effect.fail(failure));

      await expect(
        Effect.runPromiseExit(
          getPeopleDashboardActivity({ personIds: ["person-1"], dependencies })
        )
      ).resolves.toStrictEqual(Exit.fail(failure));
    }
  );

  it("fails the batch instead of reporting a person as unscheduled when a read fails", async () => {
    const failure = new PlanningCenterNetworkError({
      cause: new Error("Too many subrequests"),
    });
    const { dependencies, getPersonSchedulesAfter } = activityDependencies({});
    getPersonSchedulesAfter.mockReturnValue(Effect.fail(failure));

    await expect(
      Effect.runPromise(
        Effect.flip(
          getPeopleDashboardActivity({ personIds: ["person-1"], dependencies })
        )
      )
    ).resolves.toBe(failure);
  });
});
