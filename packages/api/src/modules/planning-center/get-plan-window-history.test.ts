import { getPlanWindowHistory } from "@pcobooster/api/modules/planning-center/get-plan-window-history";
import type {
  PlanWindowHistoryBatch,
  PlanWindowHistoryDependencies,
  PlanWindowHistoryInput,
} from "@pcobooster/api/modules/planning-center/get-plan-window-history";
import { PlanningCenterAccounting } from "@pcobooster/api/planning-center/accounting";
import { PlanningCenterRequestAccounting } from "@pcobooster/api/planning-center/request-accounting";
import {
  PLANNING_CENTER_REQUEST_CAP,
  PROGRESSIVE_REQUEST_BUDGET,
} from "@pcobooster/api/planning-center/request-budget";
import { countedRead } from "@pcobooster/api/testing/planning-center-requests";
import { buildFrequencyFromServiceHistory } from "@pcobooster/planning-center-models/candidate-frequency";
import { isString } from "@pcobooster/planning-center-models/json";
import { expandPlanWindowHistory } from "@pcobooster/planning-center-models/plan-window-history";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

/** Sunday May 3, 2026, 10:00 UTC. */
const PLAN_DATE = "2026-05-03T10:00:00.000Z";

interface OrgFixture {
  readonly serviceTypes: number;
  readonly plansPerServiceType: number;
  /** Requests a plan-range read costs: 3 uncached, 0 cached. */
  readonly rangeRequests: number;
  /** People scheduled on each plan, by plan index within its service type. */
  readonly planPeople?: (index: number) => number;
}

const createOrg = ({
  serviceTypes,
  plansPerServiceType,
  rangeRequests,
  planPeople = () => 10,
}: OrgFixture) => {
  const serviceTypeIds = Array.from(
    { length: serviceTypes },
    (_, index) => `st-${index}`
  );
  const plansByServiceType = new Map(
    serviceTypeIds.map((serviceTypeId) => [
      serviceTypeId,
      Array.from({ length: plansPerServiceType }, (_, index): PCResource => ({
        type: "Plan",
        id: `${serviceTypeId}-plan-${index}`,
        attributes: {
          sort_date: `2026-04-${String(10 + index).padStart(2, "0")}T10:00:00Z`,
          plan_people_count: planPeople(index),
        },
      })),
    ])
  );
  const rosterPages = (planId: string): number => {
    const index = Number(planId.split("-plan-")[1]);
    return Math.max(1, Math.ceil(planPeople(index) / 100));
  };
  const dependencies = {
    catalog: {
      getServiceTypesCached: () =>
        countedRead(
          serviceTypeIds.map((id): PCResource => ({
            type: "ServiceType",
            id,
            attributes: { archived_at: null, name: id },
          }))
        ),
    },
    people: {
      getPlanWindowRoster: (serviceTypeId: string, planId: string) =>
        countedRead(
          {
            data: [
              {
                type: "PlanPerson",
                id: `${planId}-member`,
                attributes: {
                  status: "C",
                  team_position_name: "Vocals",
                  created_at: "2026-01-01T00:00:00Z",
                },
                relationships: {
                  person: {
                    data: { type: "Person", id: `${serviceTypeId}-p` },
                  },
                  plan: { data: { type: "Plan", id: planId } },
                },
              },
            ],
            included: [],
          },
          rosterPages(planId)
        ),
    },
    plans: {
      getPlansWithIncludedInDateRange: (serviceTypeId: string) =>
        countedRead(
          { data: plansByServiceType.get(serviceTypeId) ?? [], included: [] },
          rangeRequests
        ),
    },
    resolveTimeZone: countedRead("UTC"),
  } satisfies PlanWindowHistoryDependencies;
  return dependencies;
};

const runCall = async (
  input: PlanWindowHistoryInput,
  dependencies: PlanWindowHistoryDependencies
): Promise<{ batch: PlanWindowHistoryBatch; requests: number }> => {
  const accounting = new PlanningCenterRequestAccounting({
    requestBudget: PLANNING_CENTER_REQUEST_CAP,
  });
  const batch = await Effect.runPromise(
    getPlanWindowHistory(input, dependencies).pipe(
      Effect.provideService(PlanningCenterAccounting, accounting)
    )
  );
  return { batch, requests: accounting.requestCount };
};

const loadAll = async (
  dependencies: PlanWindowHistoryDependencies,
  continuation?: PlanWindowHistoryInput["continuation"]
): Promise<{ loaded: number; requests: number[] }> => {
  const { batch, requests } = await runCall(
    { date: PLAN_DATE, continuation },
    dependencies
  );
  if (continuation !== undefined && batch.loadedPlanCount === 0) {
    throw new Error("Plan window history read no roster");
  }
  if (
    batch.deferredPlans.length === 0 &&
    batch.deferredServiceTypeIds.length === 0
  ) {
    return { loaded: batch.loadedPlanCount, requests: [requests] };
  }
  const rest = await loadAll(dependencies, {
    plans: batch.deferredPlans,
    serviceTypeIds: batch.deferredServiceTypeIds,
  });
  return {
    loaded: batch.loadedPlanCount + rest.loaded,
    requests: [requests, ...rest.requests],
  };
};

const lateRehearsalPlanTime = (
  id: string,
  planId: string,
  timeType: string,
  startsAt: string
): PCResource => ({
  type: "PlanTime",
  id,
  attributes: { time_type: timeType, starts_at: startsAt },
  relationships: { plan: { data: { type: "Plan", id: planId } } },
});
const lateRehearsalPlan = (
  id: string,
  sortDate: string,
  timeIds: string[]
) => ({
  type: "Plan",
  id,
  attributes: { sort_date: sortDate, plan_people_count: 1 },
  relationships: {
    plan_times: {
      data: timeIds.map((timeId) => ({ type: "PlanTime", id: timeId })),
    },
  },
});
// The window ends Sunday May 31; the June 4 plan rehearses on May 30, the June 7 one on June 6.
const LATE_REHEARSAL_PLANS: PCResource[] = [
  lateRehearsalPlan("plan-may-31", "2026-05-31T10:00:00Z", ["svc-may-31"]),
  lateRehearsalPlan("plan-jun-4", "2026-06-04T10:00:00Z", [
    "reh-may-30",
    "svc-jun-4",
  ]),
  lateRehearsalPlan("plan-jun-7", "2026-06-07T10:00:00Z", [
    "reh-jun-6",
    "svc-jun-7",
  ]),
];
const LATE_REHEARSAL_PLAN_TIMES = [
  lateRehearsalPlanTime(
    "svc-may-31",
    "plan-may-31",
    "service",
    "2026-05-31T10:00:00Z"
  ),
  lateRehearsalPlanTime(
    "reh-may-30",
    "plan-jun-4",
    "rehearsal",
    "2026-05-30T18:00:00Z"
  ),
  lateRehearsalPlanTime(
    "svc-jun-4",
    "plan-jun-4",
    "service",
    "2026-06-04T10:00:00Z"
  ),
  lateRehearsalPlanTime(
    "reh-jun-6",
    "plan-jun-7",
    "rehearsal",
    "2026-06-06T18:00:00Z"
  ),
  lateRehearsalPlanTime(
    "svc-jun-7",
    "plan-jun-7",
    "service",
    "2026-06-07T10:00:00Z"
  ),
];

describe(getPlanWindowHistory, () => {
  it("counts real requests, so cached plan ranges leave the budget to rosters", async () => {
    const { batch, requests } = await runCall(
      { date: PLAN_DATE },
      createOrg({ serviceTypes: 10, plansPerServiceType: 2, rangeRequests: 0 })
    );

    expect({
      loaded: batch.loadedPlanCount,
      deferred:
        batch.deferredPlans.length + batch.deferredServiceTypeIds.length,
      reported: batch.requestBudget.planningCenterRequests,
    }).toStrictEqual({ loaded: 20, deferred: 0, reported: requests });
  });

  it("reads a roster in every follow-up call even when its plan ranges are not cached", async () => {
    const { loaded, requests } = await loadAll(
      createOrg({ serviceTypes: 12, plansPerServiceType: 4, rangeRequests: 3 })
    );

    expect({
      loaded,
      withinBudget: requests.every(
        (sent) => sent <= PROGRESSIVE_REQUEST_BUDGET
      ),
    }).toStrictEqual({ loaded: 48, withinBudget: true });
  });

  it("reads a pending plan with hundreds of people after uncached plan ranges", async () => {
    const { loaded, requests } = await loadAll(
      createOrg({
        serviceTypes: 12,
        plansPerServiceType: 2,
        rangeRequests: 3,
        planPeople: (index) => (index === 0 ? 1500 : 10),
      })
    );

    expect({
      loaded,
      underCap: requests.every((sent) => sent <= PLANNING_CENTER_REQUEST_CAP),
    }).toStrictEqual({ loaded: 24, underCap: true });
  });

  it("keeps rehearsals inside the window that belong to plans just after it", async () => {
    const serviceTypeId = "st-sun";
    const rostersRead: string[] = [];
    const dependencies = {
      catalog: {
        getServiceTypesCached: () =>
          countedRead([
            {
              type: "ServiceType",
              id: serviceTypeId,
              attributes: { archived_at: null, name: "Sunday" },
            },
          ]),
      },
      people: {
        getPlanWindowRoster: (_serviceTypeId: string, planId: string) => {
          rostersRead.push(planId);
          const timeIds = LATE_REHEARSAL_PLAN_TIMES.flatMap((resource) =>
            resource.relationships?.plan?.data !== null &&
            !Array.isArray(resource.relationships?.plan?.data) &&
            resource.relationships?.plan?.data?.id === planId
              ? [resource.id]
              : []
          );
          return countedRead({
            data: [
              {
                type: "PlanPerson",
                id: `${planId}-member`,
                attributes: {
                  status: "C",
                  team_position_name: "Band - Vocals",
                  created_at: "2026-01-01T00:00:00Z",
                },
                relationships: {
                  person: { data: { type: "Person", id: "p-ana" } },
                  plan: { data: { type: "Plan", id: planId } },
                  times: {
                    data: timeIds.map((id) => ({ type: "PlanTime", id })),
                  },
                  service_times: {
                    data: timeIds
                      .filter((id) => id.startsWith("svc-"))
                      .map((id) => ({ type: "PlanTime", id })),
                  },
                },
              },
            ],
            included: [],
          });
        },
      },
      plans: {
        getPlansWithIncludedInDateRange: (
          _serviceTypeId: string,
          afterDayKey: string,
          beforeDayKey: string
        ) => {
          const data = LATE_REHEARSAL_PLANS.filter(({ attributes }) => {
            const sortDate = attributes.sort_date;
            const day = isString(sortDate) ? sortDate.slice(0, 10) : "";
            return day >= afterDayKey && day <= beforeDayKey;
          });
          const planIds = new Set(data.map(({ id }) => id));
          return countedRead({
            data,
            included: LATE_REHEARSAL_PLAN_TIMES.filter((resource) => {
              const related = resource.relationships?.plan?.data;
              return (
                related !== null &&
                related !== undefined &&
                !Array.isArray(related) &&
                planIds.has(related.id)
              );
            }),
          });
        },
      },
      resolveTimeZone: countedRead("UTC"),
    } satisfies PlanWindowHistoryDependencies;

    const { batch } = await runCall({ date: PLAN_DATE }, dependencies);
    const history = expandPlanWindowHistory([batch], "plan-may-31").get(
      "p-ana"
    );
    const frequency = buildFrequencyFromServiceHistory(
      history?.serviceHistory ?? [],
      new Date(PLAN_DATE),
      "UTC"
    );

    expect({
      rostersRead: rostersRead.toSorted(),
      upcomingServices: frequency.upcomingServices,
      upcomingRehearsals: frequency.upcomingRehearsals,
      nextRehearsal: frequency.nextRehearsalDate?.toISOString(),
    }).toStrictEqual({
      rostersRead: ["plan-jun-4", "plan-may-31"],
      upcomingServices: 1,
      upcomingRehearsals: 1,
      nextRehearsal: "2026-05-30T18:00:00.000Z",
    });
  });
});
