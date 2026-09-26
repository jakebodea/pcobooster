import { logger } from "@pcobooster/api/logger";
import {
  planPersonResourceSchema,
  planTimeResourceSchema,
} from "@pcobooster/api/modules/planning-center/people/resource-schemas";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import {
  pagesFor,
  PLANNING_CENTER_REQUEST_CAP,
  planningCenterRequestsSpent,
  PROGRESSIVE_REQUEST_BUDGET,
  withPlanningCenterRequestCount,
} from "@pcobooster/api/planning-center/request-budget";
import type { PlanningCenterCatalogService } from "@pcobooster/api/planning-center/services/catalog-service";
import { PLAN_ROSTER_MAX_PAGES } from "@pcobooster/api/planning-center/services/people-service";
import type { PlanningCenterPeopleService } from "@pcobooster/api/planning-center/services/people-service";
import { PLAN_RANGE_MAX_PAGES } from "@pcobooster/api/planning-center/services/plans-service";
import type { PlanningCenterPlansService } from "@pcobooster/api/planning-center/services/plans-service";
import {
  addCalendarDaysToDayKey,
  formatCalendarDayInTimeZone,
} from "@pcobooster/planning-center-models/calendar";
import {
  isNonEmptyString,
  isNumber,
  isString,
} from "@pcobooster/planning-center-models/json";
import type {
  PlanWindowRosters,
  WindowPlanSummary,
  WindowRosterRow,
} from "@pcobooster/planning-center-models/plan-window-history";
import {
  PLAN_HISTORY_HALF_RANGE_DAYS,
  REHEARSAL_WINDOW_MARGIN_DAYS,
} from "@pcobooster/planning-center-models/schedule-constants";
import type {
  PCResource,
  RawPlanPerson,
  RawPlanTime,
} from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

const log = logger.for("planning-center/plan-window-history");

/** A Worker keeps at most 6 connections waiting for response headers. */
const READ_CONCURRENCY = 6;
export interface WindowPlanRef {
  readonly serviceTypeId: string;
  readonly planId: string;
  /** Roster pages the plan needs, so the next call can reserve them before reading ranges. */
  readonly rosterRequests: number;
}

export interface PlanWindowHistoryBatch extends PlanWindowRosters {
  generatedAt: string;
  /** Plans whose rosters this call read, including plans with no one scheduled. */
  loadedPlanCount: number;
  /** Listed plans whose rosters are left for the next call, in window order. */
  deferredPlans: WindowPlanRef[];
  /** Service types whose plans are not listed yet; they come after `deferredPlans`. */
  deferredServiceTypeIds: string[];
  requestBudget: {
    limit: number;
    /** Planning Center requests this procedure sent; cached reads cost none. */
    planningCenterRequests: number;
    planRangeRequests: number;
    rosterRequests: number;
  };
}

export interface PlanWindowHistoryInput {
  /** The selected plan's sort instant; the window spans 28 days either side. */
  readonly date: string;
  /** Where the previous call stopped; omit on the first call. */
  readonly continuation?: {
    readonly plans: readonly WindowPlanRef[];
    readonly serviceTypeIds: readonly string[];
  };
}

export interface PlanWindowHistoryDependencies {
  readonly catalog: Pick<PlanningCenterCatalogService, "getServiceTypesCached">;
  readonly people: Pick<PlanningCenterPeopleService, "getPlanWindowRoster">;
  readonly plans: Pick<
    PlanningCenterPlansService,
    "getPlansWithIncludedInDateRange"
  >;
  readonly resolveTimeZone: Effect.Effect<string, PlanningCenterError>;
}

/**
 * A plan is settled once its sort date and every one of its times fall before today in the
 * organization's time zone; its roster then rarely changes.
 */
export const isSettledPlan = (
  plan: PCResource,
  planTimes: RawPlanTime[],
  todayDayKey: string,
  orgTimeZone: string
): boolean => {
  const instants = [
    plan.attributes.sort_date,
    ...planTimes.flatMap((planTime) => [
      planTime.attributes.starts_at,
      planTime.attributes.ends_at,
    ]),
  ];
  let sawDay = false;
  for (const value of instants) {
    if (!isNonEmptyString(value)) {
      continue;
    }
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) {
      continue;
    }
    if (formatCalendarDayInTimeZone(instant, orgTimeZone) >= todayDayKey) {
      return false;
    }
    sawDay = true;
  }
  return sawDay;
};

const getIncludedPlanTimesForPlan = (
  plan: PCResource,
  included: PCResource[]
): RawPlanTime[] => {
  const relationshipData = plan.relationships?.plan_times?.data;
  const relationshipIds = new Set<string>();
  if (Array.isArray(relationshipData)) {
    for (const related of relationshipData) {
      relationshipIds.add(related.id);
    }
  } else if (relationshipData !== undefined && relationshipData !== null) {
    relationshipIds.add(relationshipData.id);
  }

  const planTimes: RawPlanTime[] = [];
  for (const resource of included) {
    const parsed = planTimeResourceSchema.safeParse(resource);
    if (!parsed.success) {
      continue;
    }
    if (relationshipIds.size > 0) {
      if (relationshipIds.has(parsed.data.id)) {
        planTimes.push(parsed.data);
      }
      continue;
    }
    const planRel = resource.relationships?.plan?.data;
    const planId = Array.isArray(planRel) ? planRel[0]?.id : planRel?.id;
    if (planId === plan.id) {
      planTimes.push(parsed.data);
    }
  }
  return planTimes;
};

const appendIncludedResources = (
  target: PCResource[],
  seen: Set<string>,
  additions: readonly PCResource[]
) => {
  for (const resource of additions) {
    const key = `${resource.type}:${resource.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      target.push(resource);
    }
  }
};

const dayKeyOf = (
  value: string | null | undefined,
  orgTimeZone: string
): string | null => {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const instant = new Date(value);
  return Number.isNaN(instant.getTime())
    ? null
    : formatCalendarDayInTimeZone(instant, orgTimeZone);
};

/**
 * Whether a plan's roster adds history to a window ending on `lastDayKey`: plans on or before it,
 * and later plans (read up to `REHEARSAL_WINDOW_MARGIN_DAYS` past it) with a rehearsal inside it.
 */
const addsWindowHistory = (
  plan: PCResource,
  planTimes: readonly RawPlanTime[],
  lastDayKey: string,
  orgTimeZone: string
): boolean => {
  const planDayKey = dayKeyOf(
    isString(plan.attributes.sort_date) ? plan.attributes.sort_date : null,
    orgTimeZone
  );
  if (planDayKey === null || planDayKey <= lastDayKey) {
    return true;
  }
  return planTimes.some(({ attributes }) => {
    if (attributes.time_type !== "rehearsal") {
      return false;
    }
    const dayKey = dayKeyOf(attributes.starts_at, orgTimeZone);
    return dayKey !== null && dayKey <= lastDayKey;
  });
};

interface WindowPlan {
  readonly serviceTypeId: string;
  readonly plan: PCResource;
  readonly planTimes: RawPlanTime[];
}

/** Roster pages a plan needs; a plan with no one scheduled needs none. */
const rosterRequestsFor = (plan: PCResource): number => {
  const count = plan.attributes.plan_people_count;
  if (!isNumber(count)) {
    return 1;
  }
  return count === 0 ? 0 : Math.min(pagesFor(count), PLAN_ROSTER_MAX_PAGES);
};

interface LoadedPlan {
  readonly planTimes: RawPlanTime[];
  readonly included: PCResource[];
  readonly members: RawPlanPerson[];
}

const loadWindowRoster = (
  { serviceTypeId, plan, planTimes }: WindowPlan,
  settled: boolean,
  people: PlanWindowHistoryDependencies["people"]
): Effect.Effect<LoadedPlan, PlanningCenterError> => {
  if (rosterRequestsFor(plan) === 0) {
    return Effect.succeed({ planTimes, included: [...planTimes], members: [] });
  }
  // Window rosters feed history only; the candidate list reads the selected plan's roster fresh.
  return people.getPlanWindowRoster(serviceTypeId, plan.id, { settled }).pipe(
    Effect.map(({ data, included }) => {
      const merged: PCResource[] = [];
      const seen = new Set<string>();
      appendIncludedResources(merged, seen, included);
      appendIncludedResources(merged, seen, planTimes);
      return {
        planTimes,
        included: merged,
        members: data.flatMap((resource) => {
          const parsed = planPersonResourceSchema.safeParse(resource);
          return parsed.success ? [parsed.data] : [];
        }),
      };
    })
  );
};

const relatedIds = (
  relationship: { data?: { id: string } | { id: string }[] | null } | undefined
): string[] => {
  const data = relationship?.data;
  if (!data) {
    return [];
  }
  return Array.isArray(data) ? data.map(({ id }) => id) : [data.id];
};

const toRosterRow = (member: RawPlanPerson): WindowRosterRow => {
  const declineReason = member.attributes.decline_reason;
  return {
    id: member.id,
    planId: member.relationships?.plan?.data?.id ?? null,
    teamId: member.relationships?.team?.data?.id ?? null,
    teamPositionName: member.attributes.team_position_name,
    status: member.attributes.status,
    createdAt: member.attributes.created_at,
    timeIds: relatedIds(member.relationships?.times),
    serviceTimeIds: relatedIds(member.relationships?.service_times),
    declineReason:
      isString(declineReason) && declineReason.trim().length > 0
        ? declineReason.trim()
        : null,
  };
};

/** A plan's title, date, and service type name, as history items show them. */
const toPlanSummary = (
  plan: PCResource,
  historyIncluded: readonly PCResource[]
): WindowPlanSummary => {
  const [serviceTypeId] = relatedIds(plan.relationships?.service_type);
  const serviceType = isNonEmptyString(serviceTypeId)
    ? historyIncluded.find(
        ({ type, id }) => type === "ServiceType" && id === serviceTypeId
      )
    : undefined;
  const { title, sort_date: sortDate } = plan.attributes;
  const serviceTypeName = serviceType?.attributes.name;
  return {
    id: plan.id,
    title: isString(title) ? title : null,
    sortDate: isString(sortDate) ? sortDate : null,
    serviceTypeName: isString(serviceTypeName) ? serviceTypeName : null,
  };
};

/**
 * Everyone's roster rows from the loaded rosters, in window order, with the plans and times
 * those rows point at.
 */
const buildRosters = (
  activeServiceTypes: readonly PCResource[],
  loadedPlans: readonly LoadedPlan[]
): PlanWindowRosters => {
  const historyIncluded: PCResource[] = [];
  const seen = new Set<string>();
  appendIncludedResources(historyIncluded, seen, activeServiceTypes);
  const rowsByPersonId = new Map<string, WindowRosterRow[]>();
  const planIds = new Set<string>();
  for (const loadedPlan of loadedPlans) {
    appendIncludedResources(historyIncluded, seen, loadedPlan.included);
    for (const member of loadedPlan.members) {
      const personId = member.relationships?.person?.data?.id;
      if (!isNonEmptyString(personId)) {
        continue;
      }
      const row = toRosterRow(member);
      if (row.planId !== null) {
        planIds.add(row.planId);
      }
      const rows = rowsByPersonId.get(personId) ?? [];
      rows.push(row);
      rowsByPersonId.set(personId, rows);
    }
  }
  const plans = historyIncluded.flatMap((resource) =>
    resource.type === "Plan" && planIds.has(resource.id)
      ? [toPlanSummary(resource, historyIncluded)]
      : []
  );
  return {
    plans,
    planTimes: loadedPlans.flatMap(({ planTimes }) =>
      planTimes.map(({ id, attributes }) => ({
        id,
        startsAt: attributes.starts_at ?? null,
        timeType: attributes.time_type ?? null,
      }))
    ),
    people: [...rowsByPersonId].map(([personId, rows]) => ({
      personId,
      rows,
    })),
  };
};

const serviceTypeIdsOf = (plans: readonly WindowPlanRef[]): string[] => [
  ...new Set(plans.map((plan) => plan.serviceTypeId)),
];

/**
 * History for the candidate list from the rosters of every plan within 28 days either side of
 * the selected plan, across active service types, plus plans up to a week after the window that
 * hold a rehearsal inside it. Each call plans against
 * `PROGRESSIVE_REQUEST_BUDGET` Planning Center requests, counting what was really sent.
 *
 * The first call lists the window's plans (one plan-range read per service type) and reads
 * rosters in window order until the budget runs out. The rest comes back as `deferredPlans`
 * (and `deferredServiceTypeIds` when even the listing does not fit) for the caller's next
 * call, so concatenating every call's rows reproduces the window's order. A follow-up call
 * reserves the first deferred plan's roster pages before locating plans again, so it always
 * reads that roster. Failed reads fail the call.
 */
export const getPlanWindowHistory = (
  { date, continuation }: PlanWindowHistoryInput,
  { catalog, people, plans, resolveTimeZone }: PlanWindowHistoryDependencies
): Effect.Effect<PlanWindowHistoryBatch, PlanningCenterError> =>
  Effect.gen(function* readPlanWindowHistory() {
    const orgTimeZone = yield* resolveTimeZone;
    const refDayKey = formatCalendarDayInTimeZone(new Date(date), orgTimeZone);
    const afterDayKey = addCalendarDaysToDayKey(
      refDayKey,
      -PLAN_HISTORY_HALF_RANGE_DAYS,
      orgTimeZone
    );
    const beforeDayKey = addCalendarDaysToDayKey(
      refDayKey,
      PLAN_HISTORY_HALF_RANGE_DAYS,
      orgTimeZone
    );
    const rangeEndDayKey = addCalendarDaysToDayKey(
      beforeDayKey,
      REHEARSAL_WINDOW_MARGIN_DAYS,
      orgTimeZone
    );
    const activeServiceTypes = (yield* catalog.getServiceTypesCached()).filter(
      (resource) => !isNonEmptyString(resource.attributes.archived_at)
    );
    const activeIds = new Set(activeServiceTypes.map(({ id }) => id));

    // Plans listed by an earlier call are located again (their ranges are usually cached) before
    // any new service type is listed, which keeps the window order across calls.
    const pendingPlans = (continuation?.plans ?? []).filter(
      ({ serviceTypeId }) => activeIds.has(serviceTypeId)
    );
    const pendingServiceTypeIds = serviceTypeIdsOf(pendingPlans);
    const unlistedServiceTypeIds =
      continuation === undefined
        ? activeServiceTypes.map(({ id }) => id)
        : continuation.serviceTypeIds.filter((id) => activeIds.has(id));
    const firstRosterRequests = Math.min(
      pendingPlans[0]?.rosterRequests ?? 1,
      PLAN_ROSTER_MAX_PAGES
    );
    const beforeRanges = yield* planningCenterRequestsSpent;
    const rangeSlots = Math.max(
      1,
      Math.floor(
        (PROGRESSIVE_REQUEST_BUDGET - beforeRanges - firstRosterRequests) /
          PLAN_RANGE_MAX_PAGES
      )
    );
    const pendingRangeIds = pendingServiceTypeIds.slice(0, rangeSlots);
    const listedIds =
      pendingRangeIds.length < pendingServiceTypeIds.length
        ? []
        : unlistedServiceTypeIds.slice(0, rangeSlots - pendingRangeIds.length);
    const rangeIds = [...pendingRangeIds, ...listedIds];

    const ranges = yield* Effect.forEach(
      rangeIds,
      (serviceTypeId) =>
        Effect.map(
          plans.getPlansWithIncludedInDateRange(
            serviceTypeId,
            afterDayKey,
            rangeEndDayKey,
            "plan_times",
            orgTimeZone
          ),
          (response) => ({ serviceTypeId, ...response })
        ),
      { concurrency: READ_CONCURRENCY }
    );
    const rangeByServiceTypeId = new Map(
      ranges.map((range) => [range.serviceTypeId, range])
    );
    const toWindowPlan = (
      serviceTypeId: string,
      plan: PCResource,
      included: PCResource[]
    ): WindowPlan => ({
      serviceTypeId,
      plan,
      planTimes: getIncludedPlanTimesForPlan(plan, included),
    });

    const windowPlans: WindowPlan[] = [];
    const unlocatedPlans: WindowPlanRef[] = [];
    for (const ref of pendingPlans) {
      const range = rangeByServiceTypeId.get(ref.serviceTypeId);
      if (range === undefined) {
        unlocatedPlans.push(ref);
        continue;
      }
      const plan = range.data.find(({ id }) => id === ref.planId);
      // A plan that left the window since the last call has no history to add.
      if (plan !== undefined) {
        windowPlans.push(toWindowPlan(ref.serviceTypeId, plan, range.included));
      }
    }
    for (const serviceTypeId of listedIds) {
      const range = rangeByServiceTypeId.get(serviceTypeId);
      for (const plan of range?.data ?? []) {
        const windowPlan = toWindowPlan(
          serviceTypeId,
          plan,
          range?.included ?? []
        );
        if (
          addsWindowHistory(
            plan,
            windowPlan.planTimes,
            beforeDayKey,
            orgTimeZone
          )
        ) {
          windowPlans.push(windowPlan);
        }
      }
    }

    const afterRanges = yield* planningCenterRequestsSpent;
    let remaining = PROGRESSIVE_REQUEST_BUDGET - afterRanges;
    let admittedCount = 0;
    for (const windowPlan of windowPlans) {
      const cost = rosterRequestsFor(windowPlan.plan);
      // The first roster may use the retry headroom, so a follow-up call always reads one.
      const limit =
        admittedCount === 0
          ? Math.max(remaining, PLANNING_CENTER_REQUEST_CAP - afterRanges)
          : remaining;
      if (cost > limit) {
        break;
      }
      remaining -= cost;
      admittedCount += 1;
    }
    const admitted = windowPlans.slice(0, admittedCount);
    const todayDayKey = formatCalendarDayInTimeZone(new Date(), orgTimeZone);
    const loadedPlans = yield* Effect.forEach(
      admitted,
      (windowPlan) =>
        loadWindowRoster(
          windowPlan,
          isSettledPlan(
            windowPlan.plan,
            windowPlan.planTimes,
            todayDayKey,
            orgTimeZone
          ),
          people
        ),
      { concurrency: READ_CONCURRENCY }
    );

    const spent = yield* planningCenterRequestsSpent;
    const batch: PlanWindowHistoryBatch = {
      generatedAt: new Date().toISOString(),
      loadedPlanCount: loadedPlans.length,
      ...buildRosters(activeServiceTypes, loadedPlans),
      deferredPlans: [
        ...windowPlans.slice(admittedCount).map(({ serviceTypeId, plan }) => ({
          serviceTypeId,
          planId: plan.id,
          rosterRequests: rosterRequestsFor(plan),
        })),
        ...unlocatedPlans,
      ],
      deferredServiceTypeIds: unlistedServiceTypeIds.slice(listedIds.length),
      requestBudget: {
        limit: PROGRESSIVE_REQUEST_BUDGET,
        planningCenterRequests: spent,
        planRangeRequests: afterRanges - beforeRanges,
        rosterRequests: spent - afterRanges,
      },
    };
    log.info(
      {
        ...batch.requestBudget,
        loadedPlanCount: batch.loadedPlanCount,
        deferredPlanCount: batch.deferredPlans.length,
        deferredServiceTypeCount: batch.deferredServiceTypeIds.length,
        rosterPeopleCount: batch.people.length,
      },
      "Plan window history read"
    );
    return batch;
  }).pipe(withPlanningCenterRequestCount);
