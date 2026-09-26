import { logger } from "@pcobooster/api/logger";
import { mapSchedulesToServiceHistory } from "@pcobooster/api/modules/planning-center/people/history";
import { scheduleResourceSchema } from "@pcobooster/api/modules/planning-center/people/resource-schemas";
import { selectedPlanAssignmentsFor } from "@pcobooster/api/modules/planning-center/people/selected-plan-assignments";
import {
  isBlockedOnPlanDate,
  repeatingBlockoutsToRead,
} from "@pcobooster/api/modules/planning-center/people/transforms";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import {
  planningCenterRequestsSpent,
  PROGRESSIVE_REQUEST_BUDGET,
  withPlanningCenterRequestCount,
} from "@pcobooster/api/planning-center/request-budget";
import type { PlanningCenterPeopleService } from "@pcobooster/api/planning-center/services/people-service";
import {
  addCalendarDaysToDayKey,
  formatCalendarDayInTimeZone,
} from "@pcobooster/planning-center-models/calendar";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type { CandidateHistory } from "@pcobooster/planning-center-models/position-candidates";
import {
  PLAN_HISTORY_HALF_RANGE_DAYS,
  REHEARSAL_WINDOW_MARGIN_DAYS,
} from "@pcobooster/planning-center-models/schedule-constants";
import type {
  PCRelationship,
  PCResource,
  RawSchedule,
} from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

const log = logger.for("planning-center/candidate-details");

/**
 * Schedules are read from the start of the plan window in date order, so the first page (100
 * schedules) almost always covers the window; two leave room for heavy servers.
 */
const SCHEDULE_MAX_PAGES = 2;
/**
 * Plan-times reads for one person's rehearsals, at most: a plan every week of the window and a
 * midweek one on top. Later plans in the window keep their plan dates without rehearsal times.
 */
const MAX_REHEARSAL_PLAN_READS_PER_PERSON = 12;
/**
 * First reads leave this much of the budget for the first person's remaining reads, so every
 * call can finish or advance that person.
 */
const FIRST_PERSON_RESERVE = MAX_REHEARSAL_PLAN_READS_PER_PERSON + 1;
/** A Worker keeps at most 6 connections waiting for response headers. */
const READ_CONCURRENCY = 6;

export interface CandidateDetail {
  personId: string;
  isBlockedForDate: boolean;
  /** The person's own schedule history; present only when it was asked for. */
  history?: CandidateHistory;
}

/** Blockout checks already done for a person a previous call left unfinished. */
export interface BlockoutProgress {
  readonly personId: string;
  /** Repeating blockouts read and found not to cover the plan day. */
  readonly checkedBlockoutIds: string[];
  /** A blockout was found to cover the plan day. */
  readonly blocked: boolean;
}

export interface CandidateDetailsBatch {
  generatedAt: string;
  people: CandidateDetail[];
  /** Requested people left for a follow-up call to stay within the request budget. */
  deferredPersonIds: string[];
  /** Pass back with `deferredPersonIds` so the next call skips checks already done. */
  blockoutProgress: BlockoutProgress[];
  requestBudget: {
    limit: number;
    /** Planning Center requests this procedure sent; cached reads cost none. */
    planningCenterRequests: number;
    /** Blockout lists and schedule pages. */
    firstReadRequests: number;
    blockoutDateRequests: number;
    planTimeRequests: number;
  };
}

export interface CandidateDetailsInput {
  readonly personIds: readonly string[];
  readonly planId: string;
  /** The selected plan's sort instant. */
  readonly date: string;
  /**
   * Read each person's own schedules for history. Only needed when the plan window has no plans
   * to take history from.
   */
  readonly scheduleHistory: boolean;
  /** From the previous call's `blockoutProgress`. */
  readonly blockoutProgress?: readonly BlockoutProgress[];
}

export interface CandidateDetailsDependencies {
  readonly people: Pick<
    PlanningCenterPeopleService,
    | "getPersonBlockoutDates"
    | "getPersonBlockouts"
    | "getPersonSchedulesAfter"
    | "getPlanPlanTimes"
  >;
  readonly resolveTimeZone: Effect.Effect<string, PlanningCenterError>;
}

type PersonSchedules = Effect.Success<
  ReturnType<CandidateDetailsDependencies["people"]["getPersonSchedulesAfter"]>
>;

interface FirstRead {
  readonly personId: string;
  readonly blockouts: PCResource[];
  readonly schedules: PersonSchedules | null;
}

/** What one person still needs, and what this call reads of it. */
interface PersonReads {
  readonly read: FirstRead;
  readonly progress: BlockoutProgress;
  /** Unchecked repeating blockouts whose dates this call reads. */
  readonly blockoutIds: readonly string[];
  /** Whether those are all of the person's unchecked repeating blockouts. */
  readonly allBlockouts: boolean;
  readonly planIds: readonly string[];
}

const relationshipIds = (data: PCRelationship["data"]): string[] => {
  if (data === undefined || data === null) {
    return [];
  }
  return Array.isArray(data) ? data.map(({ id }) => id) : [data.id];
};

/**
 * Plans in the rehearsal window whose schedules list PlanTimes that `include=plan_times` left
 * out: rehearsal times are listed in `times` but never sideloaded. In date order.
 */
const plansMissingRehearsalTimes = (
  { data, included }: PersonSchedules,
  lastDayKey: string,
  orgTimeZone: string
): string[] => {
  const sideloaded = new Set(
    included.flatMap(({ type, id }) => (type === "PlanTime" ? [id] : []))
  );
  const planIds = new Set<string>();
  for (const schedule of data) {
    const [planId] = relationshipIds(schedule.relationships?.plan?.data);
    const sortDate = schedule.attributes.sort_date;
    const missing = relationshipIds(schedule.relationships?.times?.data).some(
      (id) => !sideloaded.has(id)
    );
    if (
      missing &&
      isNonEmptyString(planId) &&
      isNonEmptyString(sortDate) &&
      !Number.isNaN(Date.parse(sortDate)) &&
      formatCalendarDayInTimeZone(new Date(sortDate), orgTimeZone) <= lastDayKey
    ) {
      planIds.add(planId);
    }
  }
  return [...planIds];
};

const scheduleHistoryFrom = (
  { data, included }: PersonSchedules,
  planTimes: readonly PCResource[],
  planId: string
): CandidateHistory => {
  const schedules: RawSchedule[] = [];
  for (const resource of data) {
    const parsed = scheduleResourceSchema.safeParse(resource);
    if (parsed.success) {
      schedules.push(parsed.data);
    }
  }
  const listed = new Set(
    data.flatMap((schedule) =>
      relationshipIds(schedule.relationships?.times?.data)
    )
  );
  return {
    serviceHistory: mapSchedulesToServiceHistory(schedules, [
      ...included,
      ...planTimes.filter(({ id }) => listed.has(id)),
    ]),
    selectedPlanAssignments: selectedPlanAssignmentsFor(schedules, planId),
  };
};

/**
 * Whether a blockout covers the plan date for a batch of candidates, and, when the plan window
 * has no plans, their history from their own schedules. Each call plans against
 * `PROGRESSIVE_REQUEST_BUDGET` Planning Center requests, counting what was really sent.
 *
 * Each person costs one blockout page (more for people with over 100 blockouts), one
 * `blockout_dates` read per repeating blockout that may reach the plan date, and for schedule
 * history up to two schedule pages plus one plan-times read per plan in the window with
 * rehearsal times (shared by everyone on that plan and cached; at most 12 per person). Blockout
 * lists are read unfiltered: Planning Center's `future` filter is not verified for repeating
 * blockouts that started in the past.
 *
 * People who do not fit come back in `deferredPersonIds`. Every call finishes or advances its
 * first person: when even that person's blockout dates do not fit, it reads as many as fit and
 * returns what it learned in `blockoutProgress` for the next call. Failed reads fail the call.
 */
export const getCandidateDetails = (
  {
    personIds,
    planId,
    date,
    scheduleHistory,
    blockoutProgress = [],
  }: CandidateDetailsInput,
  { people, resolveTimeZone }: CandidateDetailsDependencies
): Effect.Effect<CandidateDetailsBatch, PlanningCenterError> =>
  Effect.gen(function* readCandidateDetails() {
    const planSortAt = new Date(date);
    const orgTimeZone = yield* resolveTimeZone;
    const planDayKey = formatCalendarDayInTimeZone(planSortAt, orgTimeZone);
    const windowStartDayKey = addCalendarDaysToDayKey(
      planDayKey,
      -PLAN_HISTORY_HALF_RANGE_DAYS,
      orgTimeZone
    );
    const rehearsalLastDayKey = addCalendarDaysToDayKey(
      planDayKey,
      PLAN_HISTORY_HALF_RANGE_DAYS + REHEARSAL_WINDOW_MARGIN_DAYS,
      orgTimeZone
    );
    const progressByPersonId = new Map(
      blockoutProgress.map((progress) => [progress.personId, progress])
    );
    const uniquePersonIds = [...new Set(personIds)];

    // First reads, admitted by their upper-bound cost while leaving the first person room to
    // finish; the first person is always admitted.
    const firstReadCost = 1 + (scheduleHistory ? SCHEDULE_MAX_PAGES : 0);
    const beforeFirstReads = yield* planningCenterRequestsSpent;
    const admittedCount = Math.min(
      uniquePersonIds.length,
      Math.max(
        1,
        Math.floor(
          (PROGRESSIVE_REQUEST_BUDGET -
            beforeFirstReads -
            FIRST_PERSON_RESERVE) /
            firstReadCost
        )
      )
    );
    const firstReads = yield* Effect.forEach(
      uniquePersonIds.slice(0, admittedCount),
      (personId) =>
        Effect.map(
          Effect.all(
            [
              people.getPersonBlockouts(personId, {}),
              scheduleHistory
                ? people.getPersonSchedulesAfter(
                    personId,
                    windowStartDayKey,
                    SCHEDULE_MAX_PAGES
                  )
                : Effect.succeed(null),
            ],
            { concurrency: "unbounded" }
          ),
          ([blockouts, schedules]): FirstRead => ({
            personId,
            blockouts,
            schedules,
          })
        ),
      { concurrency: READ_CONCURRENCY }
    );
    const afterFirstReads = yield* planningCenterRequestsSpent;

    // Remaining reads go to people in order while they fit. Plans already queued cost nothing.
    let remaining = PROGRESSIVE_REQUEST_BUDGET - afterFirstReads;
    const queuedPlanIds = new Set<string>();
    const admitted: PersonReads[] = [];
    let unreadRehearsalPlans = 0;
    for (const read of firstReads) {
      const progress = progressByPersonId.get(read.personId) ?? {
        personId: read.personId,
        checkedBlockoutIds: [],
        blocked: false,
      };
      const checked = new Set(progress.checkedBlockoutIds);
      const blockoutIds = progress.blocked
        ? []
        : repeatingBlockoutsToRead(read.blockouts, planSortAt).flatMap(
            ({ id }) => (checked.has(id) ? [] : [id])
          );
      const rehearsalPlanIds =
        read.schedules === null
          ? []
          : plansMissingRehearsalTimes(
              read.schedules,
              rehearsalLastDayKey,
              orgTimeZone
            );
      unreadRehearsalPlans += Math.max(
        0,
        rehearsalPlanIds.length - MAX_REHEARSAL_PLAN_READS_PER_PERSON
      );
      const planIds = rehearsalPlanIds
        .slice(0, MAX_REHEARSAL_PLAN_READS_PER_PERSON)
        .filter((id) => !queuedPlanIds.has(id));
      const cost = blockoutIds.length + planIds.length;
      const first = admitted.length === 0;
      if (cost > remaining && !first) {
        continue;
      }
      // The first person always advances: its plans (which fit the reserve) and as many
      // blockout dates as fit beside them, at least one.
      const blockoutsNow =
        cost <= remaining
          ? blockoutIds
          : blockoutIds.slice(0, Math.max(1, remaining - planIds.length));
      admitted.push({
        read,
        progress,
        blockoutIds: blockoutsNow,
        allBlockouts: blockoutsNow.length === blockoutIds.length,
        planIds,
      });
      remaining -= blockoutsNow.length + planIds.length;
      for (const id of planIds) {
        queuedPlanIds.add(id);
      }
    }

    const dates = yield* Effect.forEach(
      admitted.flatMap(({ read, blockoutIds }) =>
        blockoutIds.map((blockoutId) => ({
          personId: read.personId,
          blockoutId,
        }))
      ),
      ({ personId, blockoutId }) =>
        Effect.map(
          people.getPersonBlockoutDates(personId, blockoutId),
          (blockoutDates) => [blockoutId, blockoutDates] as const
        ),
      { concurrency: READ_CONCURRENCY }
    );
    const datesByBlockoutId = new Map<string, readonly PCResource[]>(dates);
    const afterBlockoutDates = yield* planningCenterRequestsSpent;
    const planTimes = (yield* Effect.forEach(
      [...queuedPlanIds],
      (id) => people.getPlanPlanTimes(id),
      { concurrency: READ_CONCURRENCY }
    )).flat();

    const details: CandidateDetail[] = [];
    const nextProgress: BlockoutProgress[] = [];
    for (const { read, progress, blockoutIds, allBlockouts } of admitted) {
      // Checked blockouts do not cover the day, and unread ones are not in the map.
      const blocked =
        progress.blocked ||
        isBlockedOnPlanDate(read.blockouts, datesByBlockoutId, planSortAt);
      if (blocked || allBlockouts) {
        details.push({
          personId: read.personId,
          isBlockedForDate: blocked,
          ...(read.schedules === null
            ? undefined
            : {
                history: scheduleHistoryFrom(read.schedules, planTimes, planId),
              }),
        });
        continue;
      }
      nextProgress.push({
        personId: read.personId,
        checkedBlockoutIds: [...progress.checkedBlockoutIds, ...blockoutIds],
        blocked: false,
      });
    }
    const detailed = new Set(details.map(({ personId }) => personId));
    const deferredPersonIds = uniquePersonIds.filter((id) => !detailed.has(id));
    const advanced = new Set(nextProgress.map(({ personId }) => personId));
    const spent = yield* planningCenterRequestsSpent;
    const batch: CandidateDetailsBatch = {
      generatedAt: new Date().toISOString(),
      people: details,
      deferredPersonIds,
      blockoutProgress: [
        ...nextProgress,
        ...deferredPersonIds.flatMap((personId) => {
          const earlier = progressByPersonId.get(personId);
          return earlier === undefined || advanced.has(personId)
            ? []
            : [earlier];
        }),
      ],
      requestBudget: {
        limit: PROGRESSIVE_REQUEST_BUDGET,
        planningCenterRequests: spent,
        firstReadRequests: afterFirstReads - beforeFirstReads,
        blockoutDateRequests: afterBlockoutDates - afterFirstReads,
        planTimeRequests: spent - afterBlockoutDates,
      },
    };
    log.info(
      {
        ...batch.requestBudget,
        requestedPeopleCount: uniquePersonIds.length,
        detailedPeopleCount: details.length,
        deferredPeopleCount: deferredPersonIds.length,
        advancedPeopleCount: nextProgress.length,
        unreadRehearsalPlanCount: unreadRehearsalPlans,
      },
      "Candidate details read"
    );
    return batch;
  }).pipe(withPlanningCenterRequestCount);
