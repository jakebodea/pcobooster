import { createBasicPlanningCenterClient } from "@pcobooster/api/planning-center/core-client";
import {
  createPlanningCenterPeopleServiceCaches,
  PlanningCenterPeopleService,
} from "@pcobooster/api/planning-center/services/people-service";
import {
  noContentResponse,
  unreachableHttpClient,
} from "@pcobooster/api/testing/http-client";
import {
  planningCenterBudgetFailures,
  planningCenterNotFound,
} from "@pcobooster/api/testing/planning-center-failures";
import { testPlanningCenterToken } from "@pcobooster/api/testing/server";
import type { JsonObject } from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

const resource = (
  id: string,
  type: string,
  attributes: JsonObject = {}
): PCResource => ({
  id,
  type,
  attributes,
});

describe("PlanningCenterPeopleService.getAllPeople", () => {
  it("loads every directory page, caches by account, and returns independent copies", async () => {
    let scope = "account-a";
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetchAll = vi
      .spyOn(core, "fetchAll")
      .mockReturnValue(
        Effect.succeed([
          resource("person-1", "Person", { first_name: "Original" }),
        ])
      );
    vi.spyOn(core, "getCacheScope").mockImplementation(() => scope);
    const service = new PlanningCenterPeopleService(core);
    const first = await Effect.runPromise(service.getAllPeople());
    first[0].attributes.first_name = "Changed";
    const second = await Effect.runPromise(service.getAllPeople());
    expect(second[0].attributes.first_name).toBe("Original");
    expect(fetchAll).toHaveBeenCalledExactlyOnceWith(
      "/people/v2/people",
      {},
      Number.POSITIVE_INFINITY
    );
    scope = "account-b";
    await Effect.runPromise(service.getAllPeople());
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });
});

describe("PlanningCenterPeopleService.getPlanTeamMembers", () => {
  it("uses fetchAllWithIncluded so large rosters are not truncated to the first page", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetchAllWithIncluded = vi
      .spyOn(core, "fetchAllWithIncluded")
      .mockReturnValue(Effect.succeed({ data: [], included: [] }));
    const service = new PlanningCenterPeopleService(core);

    await Effect.runPromise(service.getPlanTeamMembers("st-123", "plan-456"));

    expect(fetchAllWithIncluded).toHaveBeenCalledExactlyOnceWith(
      "/services/v2/service_types/st-123/plans/plan-456/team_members",
      { include: "person,team,plan", per_page: "100" },
      25
    );
  });
});

describe("PlanningCenterPeopleService.getPersonTeamPositionAssignments", () => {
  it("caches assignment validation reads used by schedule POST", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetch = vi.spyOn(core, "fetchCollection").mockReturnValue(
      Effect.succeed({
        data: [],
        included: [],
      })
    );
    const service = new PlanningCenterPeopleService(core);

    await Effect.runPromise(
      service.getPersonTeamPositionAssignments("person-123")
    );
    await Effect.runPromise(
      service.getPersonTeamPositionAssignments("person-123")
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "/services/v2/people/person-123/person_team_position_assignments?include=team_position,team_position.team"
    );
  });
});

describe("PlanningCenterPeopleService.searchPeopleByName", () => {
  it("caches normalized people search reads and returns mutation-safe copies", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetch = vi.spyOn(core, "fetchCollection").mockReturnValue(
      Effect.succeed({
        data: [resource("person-1", "Person", { first_name: "Andrew" })],
      })
    );
    const service = new PlanningCenterPeopleService(core);

    const first = await Effect.runPromise(
      service.searchPeopleByName("  Andrew  ")
    );
    first[0].attributes.first_name = "Mutated";
    const second = await Effect.runPromise(
      service.searchPeopleByName("andrew")
    );

    expect(fetch).toHaveBeenCalledOnce();
    const requestedUrl = new URL(fetch.mock.calls[0][0]);
    expect(requestedUrl.pathname).toBe("/people/v2/people");
    expect(Object.fromEntries(requestedUrl.searchParams)).toStrictEqual({
      "where[search_name]": "Andrew",
      order: "last_name,first_name",
      per_page: "15",
    });
    expect(second[0].attributes.first_name).toBe("Andrew");
  });
});

const team = (
  id: string,
  name: string,
  personIds: string[],
  archivedAt: string | null = null
): PCResource => ({
  id,
  type: "Team",
  attributes: { name, archived_at: archivedAt },
  relationships: {
    people: {
      data: personIds.map((personId) => ({ id: personId, type: "Person" })),
    },
  },
});

describe("PlanningCenterPeopleService.getAllPeopleFromTeams", () => {
  it("reads every team roster and its leaders in one request and returns mutation-safe copies", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const band = team("team-1", "Band", ["person-1", "person-2"]);
    band.relationships = {
      ...band.relationships,
      team_leaders: { data: [{ id: "leader-1", type: "TeamLeader" }] },
      service_type: { data: { id: "st-1", type: "ServiceType" } },
    };
    const fetchAllWithIncluded = vi
      .spyOn(core, "fetchAllWithIncluded")
      .mockReturnValue(
        Effect.succeed({
          data: [
            band,
            team("team-2", "Hosts", ["person-1"]),
            team("team-3", "Retired", ["person-3"], "2026-01-01T00:00:00Z"),
          ],
          included: [
            resource("person-1", "Person", { first_name: "Alex" }),
            resource("person-2", "Person", { first_name: "Blair" }),
            resource("person-3", "Person", { first_name: "Casey" }),
            {
              ...resource("leader-1", "TeamLeader", {}),
              relationships: {
                person: { data: { id: "person-2", type: "Person" } },
              },
            },
            resource("st-1", "ServiceType", { name: "Sunday" }),
          ],
        })
      );
    const service = new PlanningCenterPeopleService(core);

    const first = await Effect.runPromise(service.getAllPeopleFromTeams());
    first.people[0].attributes.first_name = "Mutated";
    first.teams[0]?.personIds.push("mutated");
    const second = await Effect.runPromise(service.getAllPeopleFromTeams());

    expect(fetchAllWithIncluded).toHaveBeenCalledOnce();
    expect(fetchAllWithIncluded.mock.calls[0]?.slice(0, 2)).toStrictEqual([
      "/services/v2/teams",
      { include: "people,team_leaders,service_types" },
    ]);
    expect(second.people.map((person) => person.id)).toStrictEqual([
      "person-1",
      "person-2",
    ]);
    expect(second.people[0].attributes.first_name).toBe("Alex");
    expect(second.teams).toStrictEqual([
      {
        id: "team-1",
        name: "Band",
        serviceTypeName: "Sunday",
        personIds: ["person-1", "person-2"],
        leaderPersonIds: ["person-2"],
      },
      {
        id: "team-2",
        name: "Hosts",
        serviceTypeName: null,
        personIds: ["person-1"],
        leaderPersonIds: [],
      },
    ]);
  });
});

describe("PlanningCenterPeopleService.getPersonSchedulesAfter", () => {
  it("reads past and future schedules after a day without per-plan reads", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetchAllWithIncluded = vi
      .spyOn(core, "fetchAllWithIncluded")
      .mockReturnValue(
        Effect.succeed({
          data: [
            {
              ...resource("schedule-1", "Schedule"),
              relationships: {
                plan: { data: { id: "plan-1", type: "Plan" } },
                times: { data: [{ id: "rehearsal-1", type: "PlanTime" }] },
              },
            },
          ],
          included: [],
        })
      );
    const service = new PlanningCenterPeopleService(core);

    const first = await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-06-24", 2)
    );
    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-06-24", 2)
    );

    expect(fetchAllWithIncluded).toHaveBeenCalledOnce();
    expect(fetchAllWithIncluded.mock.calls[0]).toStrictEqual([
      "/services/v2/people/person-1/schedules",
      {
        filter: "after",
        after: "2026-06-24",
        include: "plan_times",
        order: "starts_at",
      },
      2,
    ]);
    expect(first.data.map((schedule) => schedule.id)).toStrictEqual([
      "schedule-1",
    ]);
  });

  it("adds declined schedules only when asked, under their own cache entry", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetchAllWithIncluded = vi
      .spyOn(core, "fetchAllWithIncluded")
      .mockReturnValue(Effect.succeed({ data: [], included: [] }));
    const service = new PlanningCenterPeopleService(core);

    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-03-24", 2)
    );
    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-03-24", 2, {
        includeDeclined: true,
      })
    );

    expect(fetchAllWithIncluded).toHaveBeenCalledTimes(2);
    expect(fetchAllWithIncluded.mock.calls[1]?.[1]).toStrictEqual({
      filter: "after,with_declined",
      after: "2026-03-24",
      include: "plan_times",
      order: "starts_at",
    });
  });

  it("reads newest first when asked, so a capped read keeps upcoming dates", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetchAllWithIncluded = vi
      .spyOn(core, "fetchAllWithIncluded")
      .mockReturnValue(Effect.succeed({ data: [], included: [] }));
    const service = new PlanningCenterPeopleService(core);

    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-03-24", 2, {
        includeDeclined: true,
      })
    );
    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-03-24", 2, {
        includeDeclined: true,
        newestFirst: true,
      })
    );

    expect(fetchAllWithIncluded).toHaveBeenCalledTimes(2);
    expect(fetchAllWithIncluded.mock.calls[1]?.[1]).toStrictEqual({
      filter: "after,with_declined",
      after: "2026-03-24",
      include: "plan_times",
      order: "-starts_at",
    });
  });
});

describe("PlanningCenterPeopleService.updatePlanPersonStatus", () => {
  it("invalidates cached plan team members when plan context is available", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetchAllWithIncluded = vi
      .spyOn(core, "fetchAllWithIncluded")
      .mockReturnValue(Effect.succeed({ data: [], included: [] }));
    const fetch = vi.spyOn(core, "fetch").mockReturnValue(
      Effect.succeed({
        data: { id: "pp-123", type: "PlanPerson", attributes: {} },
      })
    );
    const service = new PlanningCenterPeopleService(core);

    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));
    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));

    await Effect.runPromise(
      service.updatePlanPersonStatus("pp-123", "C", {
        personId: "person-456",
        serviceTypeId: "st-789",
        planId: "plan-101",
      })
    );

    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));

    expect(fetchAllWithIncluded).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith("/services/v2/plan_people/pp-123", {
      method: "PATCH",
      body: {
        data: {
          type: "PlanPerson",
          id: "pp-123",
          attributes: {
            status: "C",
          },
        },
      },
    });
  });
});

describe("PlanningCenterPeopleService.updatePlanPersonTimes", () => {
  it("patches PlanPerson time relationships and invalidates cached plan members", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetchAllWithIncluded = vi
      .spyOn(core, "fetchAllWithIncluded")
      .mockReturnValue(Effect.succeed({ data: [], included: [] }));
    const fetch = vi.spyOn(core, "fetch").mockReturnValue(
      Effect.succeed({
        data: { id: "pp-123", type: "PlanPerson", attributes: {} },
      })
    );
    const service = new PlanningCenterPeopleService(core);

    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));
    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));

    await Effect.runPromise(
      service.updatePlanPersonTimes({
        personId: "person-456",
        planPersonId: "pp-123",
        serviceTypeId: "st-789",
        planId: "plan-101",
        planTimeIds: ["time-1", "time-2"],
      })
    );

    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));

    expect(fetchAllWithIncluded).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(
      "/services/v2/people/person-456/plan_people/pp-123",
      {
        method: "PATCH",
        body: {
          data: {
            type: "PlanPerson",
            id: "pp-123",
            relationships: {
              times: {
                data: [
                  { type: "PlanTime", id: "time-1" },
                  { type: "PlanTime", id: "time-2" },
                ],
              },
            },
          },
        },
      }
    );
  });
});

describe("PlanningCenterPeopleService.invalidateScheduleReadCaches", () => {
  it("clears cached plan team members and person schedules for conflict reconciliation", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetchAllWithIncluded = vi
      .spyOn(core, "fetchAllWithIncluded")
      .mockReturnValue(Effect.succeed({ data: [], included: [] }));
    const service = new PlanningCenterPeopleService(core);

    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));
    await Effect.runPromise(service.getPersonSchedules("person-456"));
    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));
    await Effect.runPromise(service.getPersonSchedules("person-456"));

    service.invalidateScheduleReadCaches({
      personId: "person-456",
      serviceTypeId: "st-789",
      planId: "plan-101",
    });

    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));
    await Effect.runPromise(service.getPersonSchedules("person-456"));

    expect(
      fetchAllWithIncluded.mock.calls.filter(([endpoint]) =>
        endpoint.includes("/plans/plan-101/team_members")
      )
    ).toHaveLength(2);
    expect(
      fetchAllWithIncluded.mock.calls.filter(([endpoint]) =>
        endpoint.includes("/people/person-456/schedules")
      )
    ).toHaveLength(2);
  });
});

describe("PlanningCenterPeopleService.getPlanPlanTimes", () => {
  it("fetches all plan times through the shared cache-backed endpoint", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetchAll = vi
      .spyOn(core, "fetchAll")
      .mockReturnValue(Effect.succeed([]));
    const service = new PlanningCenterPeopleService(core);

    await Effect.runPromise(service.getPlanPlanTimes("plan-456"));

    expect(fetchAll).toHaveBeenCalledExactlyOnceWith(
      "/services/v2/plans/plan-456/plan_times",
      { per_page: "200" },
      10
    );
  });

  it("reads a plan Planning Center does not find as having no times", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    vi.spyOn(core, "fetchAll").mockReturnValue(
      Effect.fail(planningCenterNotFound())
    );
    const service = new PlanningCenterPeopleService(core);

    await expect(
      Effect.runPromise(service.getPlanPlanTimes("plan-456"))
    ).resolves.toStrictEqual([]);
  });

  it.each(planningCenterBudgetFailures())(
    "fails with %s instead of caching no times",
    async (failure) => {
      const core = createBasicPlanningCenterClient(
        testPlanningCenterToken,
        unreachableHttpClient
      );
      const fetchAll = vi
        .spyOn(core, "fetchAll")
        .mockReturnValueOnce(Effect.fail(failure))
        .mockReturnValueOnce(Effect.succeed([resource("time-1", "PlanTime")]));
      const service = new PlanningCenterPeopleService(core);

      await expect(
        Effect.runPromiseExit(service.getPlanPlanTimes("plan-456"))
      ).resolves.toStrictEqual(Exit.fail(failure));
      await expect(
        Effect.runPromise(service.getPlanPlanTimes("plan-456"))
      ).resolves.toStrictEqual([resource("time-1", "PlanTime")]);
      expect(fetchAll).toHaveBeenCalledTimes(2);
    }
  );
});

describe("PlanningCenterPeopleService.deletePlanPerson", () => {
  it("uses the plan team_members endpoint when plan context is available", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const request = vi
      .spyOn(core, "request")
      .mockReturnValue(Effect.succeed(noContentResponse()));
    const service = new PlanningCenterPeopleService(core);

    await Effect.runPromise(
      service.deletePlanPerson("pp-123", {
        personId: "person-456",
        serviceTypeId: "st-789",
        planId: "plan-101",
      })
    );

    expect(request).toHaveBeenCalledWith(
      "/services/v2/service_types/st-789/plans/plan-101/team_members/pp-123",
      { method: "DELETE" }
    );
  });

  it("falls back to the person-scoped plan_people endpoint without plan context", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const request = vi
      .spyOn(core, "request")
      .mockReturnValue(Effect.succeed(noContentResponse()));
    const service = new PlanningCenterPeopleService(core);

    await Effect.runPromise(
      service.deletePlanPerson("pp-123", {
        personId: "person-456",
      })
    );

    expect(request).toHaveBeenCalledWith(
      "/services/v2/people/person-456/plan_people/pp-123",
      { method: "DELETE" }
    );
  });
});

const rosterService = (caches = createPlanningCenterPeopleServiceCaches()) => {
  const core = createBasicPlanningCenterClient(
    testPlanningCenterToken,
    unreachableHttpClient
  );
  const fetchAllWithIncluded = vi
    .spyOn(core, "fetchAllWithIncluded")
    .mockReturnValue(Effect.succeed({ data: [], included: [] }));
  return {
    service: new PlanningCenterPeopleService(core, caches),
    fetchAllWithIncluded,
  };
};
const rosterPath = (planId: string) =>
  `/services/v2/service_types/st-1/plans/${planId}/team_members`;

const readWindowRoster = async (service: PlanningCenterPeopleService) =>
  await Effect.runPromise(
    service.getPlanWindowRoster("st-1", "plan-1", { settled: false })
  );

describe("PlanningCenterPeopleService plan rosters", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the selected plan fresh even while the window keeps a settled copy", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-24T18:00:00.000Z") });
    const { service, fetchAllWithIncluded } = rosterService();
    const readBoth = async () => {
      await Effect.runPromise(
        service.getPlanWindowRoster("st-1", "plan-past", { settled: true })
      );
      await Effect.runPromise(service.getPlanTeamMembers("st-1", "plan-past"));
    };

    await readBoth();
    vi.advanceTimersByTime(31 * 1000);
    await readBoth();

    expect(fetchAllWithIncluded.mock.calls.map(([path]) => path)).toStrictEqual(
      [
        rosterPath("plan-past"),
        rosterPath("plan-past"),
        rosterPath("plan-past"),
      ]
    );
  });

  it("keeps a settled window roster for 30 minutes and a live one for 5", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-24T18:00:00.000Z") });
    const { service, fetchAllWithIncluded } = rosterService();
    const readBoth = async () => {
      await Effect.runPromise(
        service.getPlanWindowRoster("st-1", "plan-past", { settled: true })
      );
      await Effect.runPromise(
        service.getPlanWindowRoster("st-1", "plan-next", { settled: false })
      );
    };

    await readBoth();
    vi.advanceTimersByTime(6 * 60 * 1000);
    await readBoth();

    expect(fetchAllWithIncluded.mock.calls.map(([path]) => path)).toStrictEqual(
      [
        rosterPath("plan-past"),
        rosterPath("plan-next"),
        rosterPath("plan-next"),
      ]
    );
  });

  it("clears the fresh roster and the window's copy when this app changes the plan", async () => {
    const { service, fetchAllWithIncluded } = rosterService();
    const read = async () => {
      await Effect.runPromise(
        service.getPlanWindowRoster("st-1", "plan-past", { settled: true })
      );
      await Effect.runPromise(service.getPlanTeamMembers("st-1", "plan-past"));
    };

    await read();
    service.invalidateScheduleReadCaches({
      serviceTypeId: "st-1",
      planId: "plan-past",
    });
    await read();

    expect(fetchAllWithIncluded).toHaveBeenCalledTimes(4);
  });

  it("shares window rosters across requests of the isolate until a write clears them", async () => {
    const caches = createPlanningCenterPeopleServiceCaches();
    const first = rosterService(caches);
    const second = rosterService(caches);

    await readWindowRoster(first.service);
    await readWindowRoster(second.service);
    second.service.invalidatePlanWindowRosters();
    await readWindowRoster(first.service);

    expect([
      first.fetchAllWithIncluded.mock.calls.length,
      second.fetchAllWithIncluded.mock.calls.length,
    ]).toStrictEqual([2, 0]);
  });
});

describe("PlanningCenterPeopleService.getPersonSchedulesAfter with an instant", () => {
  it("reads past and future schedules after an instant without per-plan time reads", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetchAllWithIncluded = vi
      .spyOn(core, "fetchAllWithIncluded")
      .mockReturnValue(
        Effect.succeed({
          data: [
            {
              type: "Schedule",
              id: "schedule-1",
              attributes: {},
              relationships: {
                plan: { data: { type: "Plan", id: "plan-1" } },
                times: { data: [{ type: "PlanTime", id: "rehearsal-1" }] },
              },
            },
          ],
          included: [],
        })
      );
    const fetchAll = vi.spyOn(core, "fetchAll");
    const service = new PlanningCenterPeopleService(core);

    const first = await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-03-31T07:00:00.000Z", 5)
    );
    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-03-31T07:00:00.000Z", 5)
    );

    expect(first.data).toHaveLength(1);
    expect(fetchAll).not.toHaveBeenCalled();
    expect(fetchAllWithIncluded).toHaveBeenCalledExactlyOnceWith(
      "/services/v2/people/person-1/schedules",
      {
        filter: "after",
        after: "2026-03-31T07:00:00.000Z",
        include: "plan_times",
        order: "starts_at",
      },
      5
    );
  });

  it("drops cached schedules and plan people when the person's schedule changes", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetchAllWithIncluded = vi
      .spyOn(core, "fetchAllWithIncluded")
      .mockReturnValue(Effect.succeed({ data: [], included: [] }));
    const service = new PlanningCenterPeopleService(core);
    const readBoth = async () => {
      await Effect.runPromise(
        service.getPersonSchedulesAfter("person-1", "2026-03-31T07:00:00.000Z")
      );
      await Effect.runPromise(service.getPersonPlanPeople("person-1"));
    };

    await readBoth();
    await readBoth();
    service.invalidateScheduleReadCaches({
      personId: "person-1",
      serviceTypeId: "st-1",
      planId: "plan-1",
    });
    await readBoth();

    expect(fetchAllWithIncluded).toHaveBeenCalledTimes(4);
    expect(fetchAllWithIncluded).toHaveBeenCalledWith(
      "/services/v2/people/person-1/plan_people",
      { include: "plan,team" },
      3
    );
  });
});
