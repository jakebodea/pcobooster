import { logger } from "@pcobooster/api/logger";
import type {
  PeopleDashboardActivity,
  PeopleDashboardActivityBatch,
  PeopleDashboardDayKind,
  PeopleDashboardLoad,
  PeopleDashboardRoster,
  PeopleDashboardRosterPerson,
  PeopleDashboardTeam,
} from "@pcobooster/api/modules/planning-center/people-dashboard-types";
import {
  buildServingRhythm,
  isDeclinedStatus,
  RHYTHM_HISTORY_DAYS,
  scheduleSortDate,
  scheduleStatus,
} from "@pcobooster/api/modules/planning-center/serving-rhythm";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import { recoverPlanningCenterFailure } from "@pcobooster/api/planning-center/recover-failure";
import {
  PLANNING_CENTER_REQUEST_CAP,
  planningCenterRequestsSpent,
  PROGRESSIVE_REQUEST_BUDGET,
  withPlanningCenterRequestCount,
} from "@pcobooster/api/planning-center/request-budget";
import type {
  PlanningCenterPeopleService,
  TeamRoster,
} from "@pcobooster/api/planning-center/services/people-service";
import { PLAN_RANGE_MAX_PAGES } from "@pcobooster/api/planning-center/services/plans-service";
import type { PlanningCenterPlansService } from "@pcobooster/api/planning-center/services/plans-service";
import { findIncluded } from "@pcobooster/api/planning-center/utils";
import {
  formatCalendarDateLabel,
  formatCalendarDayInTimeZone,
  orgCalendarDaysRefMinusItem,
} from "@pcobooster/planning-center-models/calendar";
import { buildFrequencyFromServiceHistory } from "@pcobooster/planning-center-models/candidate-frequency";
import {
  isNonEmptyString,
  isString,
} from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

/**
 * 100 schedules per page. The busiest volunteer measured had 23 schedules in
 * the window, so one page is typical and two leave room for heavy servers.
 * Schedules are read newest first, so a person past the cap loses their
 * oldest history, never their upcoming dates.
 */
const SCHEDULE_MAX_PAGES = 2;
const SCHEDULE_PAGE_SIZE = 100;
/** Workers allows 6 open connections per invocation; leave headroom. */
const READ_CONCURRENCY = 4;
/**
 * Rehearsal times are resolved for the 90-day cadence counts and the month
 * view, plus one day for the org-day boundary; older schedules keep their
 * plan dates.
 */
const PLAN_TIME_WINDOW_DAYS = 91;
/** Schedules are read for the serving rhythm, plus one day for the org-day boundary. */
const SCHEDULE_HISTORY_DAYS = RHYTHM_HISTORY_DAYS + 1;
/** Upcoming schedules and plans are read up to a year ahead. */
const FUTURE_WINDOW_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const log = logger.for("planning-center/people-dashboard");

export interface PeopleDashboardRosterDependencies {
  readonly peopleService: Pick<
    PlanningCenterPeopleService,
    "getAllPeopleFromTeams"
  >;
  readonly resolveTimeZone: Effect.Effect<string, PlanningCenterError>;
  /** The signed-in person, to find the teams they lead; null when unknown. */
  readonly viewerPersonId: string | null;
}

export interface PeopleDashboardActivityDependencies {
  readonly peopleService: Pick<
    PlanningCenterPeopleService,
    "getPersonSchedulesAfter"
  >;
  readonly plansService: Pick<
    PlanningCenterPlansService,
    "getPlansWithIncludedInDateRange"
  >;
  readonly resolveTimeZone: Effect.Effect<string, PlanningCenterError>;
}

export interface ScheduleItem {
  id: string;
  sourceScheduleId: string;
  date: Date;
  teamPositionName: string;
  teamName?: string;
  serviceTypeName?: string;
  planTitle?: string;
  status: string;
  planUrl?: string;
  timeType?: "service" | "rehearsal" | "other";
}

const getRelationshipIds = (
  relationship: { data?: { id: string } | { id: string }[] | null } | undefined
): string[] => {
  const data = relationship?.data;
  if (!data) {
    return [];
  }
  return Array.isArray(data) ? data.map((item) => item.id) : [data.id];
};

const getSingleRelationshipId = (
  relationship: { data?: { id: string } | { id: string }[] | null } | undefined
) => getRelationshipIds(relationship)[0];

const buildPlanWorkspaceUrl = (serviceTypeId: string, planId: string) =>
  `/services/${encodeURIComponent(serviceTypeId)}/plans/${encodeURIComponent(planId)}/lineup`;

export const mapScheduleToDashboardItems = (
  schedule: PCResource,
  included: PCResource[]
): ScheduleItem[] => {
  const fallbackDate = isNonEmptyString(schedule.attributes.sort_date)
    ? new Date(schedule.attributes.sort_date)
    : new Date();
  const planTimeIds = getRelationshipIds(schedule.relationships?.plan_times);
  const timeIds = getRelationshipIds(schedule.relationships?.times);
  const ids = [...new Set([...planTimeIds, ...timeIds])];

  const planId = getSingleRelationshipId(schedule.relationships?.plan);
  const serviceTypeId = getSingleRelationshipId(
    schedule.relationships?.service_type
  );
  const planUrl =
    planId && serviceTypeId
      ? buildPlanWorkspaceUrl(serviceTypeId, planId)
      : undefined;

  const buildItem = (
    id: string,
    date: Date,
    timeType?: "service" | "rehearsal" | "other"
  ) => ({
    id,
    sourceScheduleId: schedule.id,
    date,
    teamPositionName: isString(schedule.attributes.team_position_name)
      ? schedule.attributes.team_position_name
      : "",
    teamName: isString(schedule.attributes.team_name)
      ? schedule.attributes.team_name
      : undefined,
    serviceTypeName: isString(schedule.attributes.service_type_name)
      ? schedule.attributes.service_type_name
      : undefined,
    status: isString(schedule.attributes.status)
      ? schedule.attributes.status
      : "",
    planUrl,
    timeType,
  });

  if (ids.length === 0) {
    return [buildItem(schedule.id, fallbackDate, "service")];
  }

  return ids.flatMap((id) => {
    const planTime = findIncluded(included, "PlanTime", id);
    const rawType = planTime?.attributes.time_type;
    const timeType =
      rawType === "service" || rawType === "rehearsal" || rawType === "other"
        ? rawType
        : undefined;
    if (timeType === "other") {
      return [];
    }
    const startsAt = planTime?.attributes.starts_at;
    const date = isString(startsAt) ? new Date(startsAt) : fallbackDate;
    return [buildItem(`${schedule.id}:${id}`, date, timeType)];
  });
};

const isConfirmedStatus = (status: string | undefined) => {
  const raw = (status ?? "").trim();
  const normalized = raw.toLowerCase();
  return raw === "C" || normalized === "confirmed";
};

const pickDisplayStatus = (statuses: Set<string>) => {
  const values = [...statuses];
  return values.find(isConfirmedStatus) ?? values[0];
};

const dayKindRank = (kind: PeopleDashboardDayKind) => {
  if (kind === "service") {
    return 0;
  }
  if (kind === "rehearsal") {
    return 1;
  }
  if (kind === "blockout") {
    return 2;
  }
  return 3;
};

export const buildPersonMonthDays = (
  items: ScheduleItem[],
  orgTimeZone: string
): PeopleDashboardActivity["monthDays"] => {
  const byDay = new Map<
    string,
    {
      day: number;
      kind: PeopleDashboardDayKind;
      positions: Set<string>;
      serviceTypes: Set<string>;
      statuses: Set<string>;
      serviceStatuses: Set<string>;
      planUrls: Set<string>;
    }
  >();
  for (const item of items) {
    const dayKey = formatCalendarDayInTimeZone(item.date, orgTimeZone);
    const day = Number(dayKey.slice(-2));
    const kind = item.timeType === "rehearsal" ? "rehearsal" : "service";
    const key = [
      day,
      kind,
      item.status || "",
      item.teamPositionName || "",
      item.serviceTypeName ?? "",
    ].join(":");
    const existing = byDay.get(key);
    const next = existing ?? {
      day,
      kind,
      positions: new Set<string>(),
      serviceTypes: new Set<string>(),
      statuses: new Set<string>(),
      serviceStatuses: new Set<string>(),
      planUrls: new Set<string>(),
    };
    if (kind === "service") {
      next.kind = "service";
    }
    if (item.teamPositionName) {
      next.positions.add(item.teamPositionName);
    }
    if (isNonEmptyString(item.serviceTypeName)) {
      next.serviceTypes.add(item.serviceTypeName);
    }
    if (item.status) {
      next.statuses.add(item.status);
    }
    if (kind === "service" && item.status) {
      next.serviceStatuses.add(item.status);
    }
    if (isNonEmptyString(item.planUrl)) {
      next.planUrls.add(item.planUrl);
    }
    byDay.set(key, next);
  }
  return [...byDay.values()]
    .map((value) => ({
      day: value.day,
      kind: value.kind,
      positionName: [...value.positions].join(", ") || undefined,
      serviceTypeName: [...value.serviceTypes].join(", ") || undefined,
      status: pickDisplayStatus(
        value.kind === "service" ? value.serviceStatuses : value.statuses
      ),
      planUrl: [...value.planUrls][0],
    }))
    .toSorted(
      (a, b) => a.day - b.day || dayKindRank(a.kind) - dayKindRank(b.kind)
    );
};

export const getMonthInfo = (date: Date, orgTimeZone: string) => {
  const dayKey = formatCalendarDayInTimeZone(date, orgTimeZone);
  const year = Number(dayKey.slice(0, 4));
  const month = Number(dayKey.slice(5, 7));
  const monthIndex = month - 1;
  // UTC noon on the org month's first day: a civil-date carrier, so read it in UTC.
  const first = new Date(Date.UTC(year, monthIndex, 1, 12));
  const daysInMonth = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  return {
    year,
    monthIndex,
    label: formatCalendarDateLabel(first, "UTC", "monthYear"),
    daysInMonth,
    startsOnWeekday: first.getUTCDay(),
  };
};

const getLoad = (
  monthCount: number,
  last90Days: number
): PeopleDashboardLoad => {
  if (monthCount >= 4) {
    return "rest";
  }
  if (monthCount >= 3 || last90Days >= 10) {
    return "high";
  }
  if (monthCount === 0 && last90Days <= 3) {
    return "low";
  }
  return "normal";
};

const getStatus = (
  load: PeopleDashboardLoad,
  monthCount: number,
  nextDate: Date | undefined
): string => {
  if (load === "rest") {
    return "Needs rest";
  }
  if (load === "high") {
    return "High load";
  }
  if (monthCount === 0) {
    return nextDate ? "Upcoming" : "Underused";
  }
  return nextDate ? "Available soon" : "Recently served";
};

const getCadenceLabel = (thirtyDayCount: number, ninetyDayCount: number) => {
  if (thirtyDayCount > 0) {
    return `${thirtyDayCount} in 30 days`;
  }
  if (ninetyDayCount === 0) {
    return "No services in 90 days";
  }
  return `${ninetyDayCount} in 90 days`;
};

const getHighlight = (
  load: PeopleDashboardLoad,
  monthCount: number,
  nextDate: Date | undefined
) => {
  if (load === "rest") {
    return "Serving heavily this month.";
  }
  if (load === "high") {
    return "Above normal cadence for the selected range.";
  }
  if (load === "low") {
    return nextDate
      ? "Light recent load with an upcoming assignment."
      : "Light recent load and no current assignment.";
  }
  if (nextDate) {
    return "Healthy cadence with upcoming availability context.";
  }
  return monthCount > 0
    ? "Served recently and has room in the upcoming rotation."
    : "No current month services found.";
};

export const getMostCommonRoles = (items: ScheduleItem[]) => {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.teamPositionName.trim()) {
      continue;
    }
    counts.set(
      item.teamPositionName,
      (counts.get(item.teamPositionName) ?? 0) + 1
    );
  }
  const roles = [...counts.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([role]) => role);
  return roles.length > 0 ? roles.join(", ") : "No recent role";
};

/** "Sep 9" for the org calendar day `date` falls on; `fallback` when there is no date. */
export const formatShortDate = (
  date: Date | undefined,
  orgTimeZone: string,
  fallback = "-"
) => {
  if (!date || Number.isNaN(date.getTime())) {
    return fallback;
  }
  return formatCalendarDateLabel(date, orgTimeZone, "monthDay");
};

export const countServiceDaysInWindow = (
  items: ScheduleItem[],
  referenceDate: Date,
  orgTimeZone: string,
  days: number
) => {
  const refDayKey = formatCalendarDayInTimeZone(referenceDate, orgTimeZone);
  const serviceDays = new Set<string>();
  for (const item of items) {
    if (item.timeType === "rehearsal") {
      continue;
    }
    const status = item.status.trim();
    const normalizedStatus = status.toLowerCase();
    if (status === "D" || normalizedStatus === "declined") {
      continue;
    }
    const dayKey = formatCalendarDayInTimeZone(item.date, orgTimeZone);
    if (Math.abs(orgCalendarDaysRefMinusItem(dayKey, refDayKey)) <= days) {
      serviceDays.add(dayKey);
    }
  }
  return serviceDays.size;
};

const buildPersonActivity = (
  personId: string,
  allSchedules: PCResource[],
  included: PCResource[],
  now: Date,
  orgTimeZone: string
): PeopleDashboardActivity => {
  const rhythmSchedules = allSchedules.map((resource) => {
    const status = scheduleStatus(resource);
    const items = isDeclinedStatus(status)
      ? []
      : mapScheduleToDashboardItems(resource, included);
    return {
      status,
      sortDate: scheduleSortDate(resource) ?? items[0]?.date ?? now,
      items,
    };
  });
  const rhythm = buildServingRhythm(
    rhythmSchedules.map(({ status, sortDate, items }) => ({
      status,
      sortDate,
      serviceDates: items.flatMap((item) =>
        item.timeType === "rehearsal" ? [] : [item.date]
      ),
    })),
    now,
    orgTimeZone
  );
  const serviceHistory = rhythmSchedules
    .flatMap(({ items }) => items)
    .toSorted((a, b) => a.date.getTime() - b.date.getTime());

  const frequency = buildFrequencyFromServiceHistory(
    serviceHistory,
    now,
    orgTimeZone
  );
  const nowDayKey = formatCalendarDayInTimeZone(now, orgTimeZone);
  const monthPrefix = nowDayKey.slice(0, 8);
  const monthItems = serviceHistory.filter(
    (item) =>
      formatCalendarDayInTimeZone(item.date, orgTimeZone).startsWith(
        monthPrefix
      ) &&
      (item.timeType === "service" || item.timeType === "rehearsal")
  );
  const serviceDaysThisMonth = new Set<string>();
  for (const item of monthItems) {
    if (item.timeType !== "rehearsal") {
      serviceDaysThisMonth.add(
        formatCalendarDayInTimeZone(item.date, orgTimeZone)
      );
    }
  }
  const monthDays = buildPersonMonthDays(monthItems, orgTimeZone);
  const roles = getMostCommonRoles(serviceHistory);
  const thirtyDayCount = countServiceDaysInWindow(
    serviceHistory,
    now,
    orgTimeZone,
    30
  );
  const ninetyDayCount = countServiceDaysInWindow(
    serviceHistory,
    now,
    orgTimeZone,
    90
  );
  const load = getLoad(serviceDaysThisMonth.size, ninetyDayCount);

  return {
    id: personId,
    rhythm,
    roles,
    status: getStatus(
      load,
      serviceDaysThisMonth.size,
      frequency.nextUpcomingDate
    ),
    load,
    lastServed: formatShortDate(frequency.lastServedDate, orgTimeZone),
    lastRehearsal: formatShortDate(frequency.lastRehearsalDate, orgTimeZone),
    nextScheduled: formatShortDate(
      frequency.nextUpcomingDate,
      orgTimeZone,
      "Not scheduled"
    ),
    nextRehearsal: formatShortDate(
      frequency.nextRehearsalDate,
      orgTimeZone,
      "Not scheduled"
    ),
    monthCount: serviceDaysThisMonth.size,
    thirtyDayCount,
    ninetyDayCount,
    upcomingCount: frequency.upcomingServices,
    streak: getCadenceLabel(thirtyDayCount, ninetyDayCount),
    highlight: getHighlight(
      load,
      serviceDaysThisMonth.size,
      frequency.nextUpcomingDate
    ),
    monthDays,
  };
};

export const initialsFromName = (name: string) => {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) {
    return "WA";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
};

const teamNamesByPersonId = (teams: readonly TeamRoster[]) => {
  const names = new Map<string, Set<string>>();
  for (const team of teams) {
    for (const personId of team.personIds) {
      const personNames = names.get(personId) ?? new Set<string>();
      personNames.add(team.name);
      names.set(personId, personNames);
    }
  }
  return names;
};

const buildRosterPeople = (
  people: PCResource[],
  teams: readonly TeamRoster[]
): PeopleDashboardRosterPerson[] => {
  const namesByPersonId = teamNamesByPersonId(teams);
  const rosterPeople = new Map<
    string,
    { firstName: string; lastName: string; person: PeopleDashboardRosterPerson }
  >();
  for (const resource of people) {
    if (
      resource.type !== "Person" ||
      rosterPeople.has(resource.id) ||
      isNonEmptyString(resource.attributes.archived_at)
    ) {
      continue;
    }
    const { first_name: rawFirstName, last_name: rawLastName } =
      resource.attributes;
    const firstName = isString(rawFirstName) ? rawFirstName : "";
    const lastName = isString(rawLastName) ? rawLastName : "";
    const name = `${firstName} ${lastName}`.trim();
    const personTeams = [...(namesByPersonId.get(resource.id) ?? [])];
    const photo = resource.attributes.photo_thumbnail_url;
    rosterPeople.set(resource.id, {
      firstName,
      lastName,
      person: {
        id: resource.id,
        name: name || "Unknown person",
        initials: initialsFromName(name),
        photoThumbnailUrl: isString(photo) ? photo : null,
        teams: personTeams.length > 0 ? personTeams.slice(0, 3) : ["Services"],
      },
    });
  }

  return [...rosterPeople.values()]
    .toSorted(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName)
    )
    .map(({ person }) => person);
};

/** Teams with at least one listed member, by name, then service type. */
const buildDashboardTeams = (
  teams: readonly TeamRoster[],
  rosterPersonIds: ReadonlySet<string>
): PeopleDashboardTeam[] =>
  teams
    .flatMap(({ id, name, serviceTypeName, personIds }) => {
      const listed = personIds.filter((personId) =>
        rosterPersonIds.has(personId)
      );
      return listed.length > 0
        ? [{ id, name, serviceTypeName, personIds: listed }]
        : [];
    })
    .toSorted(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        (a.serviceTypeName ?? "").localeCompare(b.serviceTypeName ?? "")
    );

/** One read of every active team's members and leaders; no schedules. */
export const getPeopleDashboardRoster = ({
  peopleService,
  resolveTimeZone,
  viewerPersonId,
}: PeopleDashboardRosterDependencies): Effect.Effect<
  PeopleDashboardRoster,
  PlanningCenterError
> =>
  Effect.gen(function* readPeopleDashboardRoster() {
    const orgTimeZone = yield* resolveTimeZone;
    const now = new Date();
    const roster = yield* peopleService.getAllPeopleFromTeams();
    const people = buildRosterPeople(roster.people, roster.teams);
    const teams = buildDashboardTeams(
      roster.teams,
      new Set(people.map((person) => person.id))
    );
    const listedTeamIds = new Set(teams.map((team) => team.id));
    const ledTeamIds =
      viewerPersonId === null
        ? []
        : roster.teams.flatMap((team) =>
            listedTeamIds.has(team.id) &&
            team.leaderPersonIds.includes(viewerPersonId)
              ? [team.id]
              : []
          );
    log.info(
      {
        rosterPeopleCount: people.length,
        teamCount: teams.length,
        ledTeamCount: ledTeamIds.length,
      },
      "People dashboard roster read"
    );
    return {
      generatedAt: now.toISOString(),
      month: getMonthInfo(now, orgTimeZone),
      people,
      teams,
      ledTeamIds,
    };
  });

interface PersonSchedules {
  readonly personId: string;
  readonly data: PCResource[];
  readonly included: PCResource[];
}

/**
 * Service types whose plans hold PlanTimes the schedules list but
 * `include=plan_times` left out (rehearsals), with the people who need them.
 */
export const findServiceTypesMissingPlanTimes = (
  people: readonly PersonSchedules[]
): Map<string, Set<string>> => {
  const personIdsByServiceType = new Map<string, Set<string>>();
  for (const { personId, data, included } of people) {
    const sideloaded = new Set<string>();
    for (const resource of included) {
      if (resource.type === "PlanTime") {
        sideloaded.add(resource.id);
      }
    }
    for (const schedule of data) {
      const serviceTypeId = getSingleRelationshipId(
        schedule.relationships?.service_type
      );
      const missing = getRelationshipIds(schedule.relationships?.times).some(
        (id) => !sideloaded.has(id)
      );
      if (!missing || !isNonEmptyString(serviceTypeId)) {
        continue;
      }
      const personIds =
        personIdsByServiceType.get(serviceTypeId) ?? new Set<string>();
      personIds.add(personId);
      personIdsByServiceType.set(serviceTypeId, personIds);
    }
  }
  return personIdsByServiceType;
};

/**
 * Serving activity for a batch of roster people. Each call plans against
 * `PROGRESSIVE_REQUEST_BUDGET` Planning Center requests, counting what was
 * really sent.
 *
 * Each person costs one schedule page (two at most), read from 91 days ago
 * onward. Rehearsal PlanTimes are then read per service type (one plan-range
 * read each, shared across the batch and cached for 5 minutes) instead of per
 * plan, first the service types of the batch's first person. People whose
 * service types do not fit come back in `deferredPersonIds` for the caller's
 * next call; failed reads fail the call.
 *
 * Every call finishes its first person. That person's plan ranges may use the
 * retry headroom up to the procedure cap; beyond it (a person serving in more
 * than about ten service types), their remaining schedules keep their plan
 * dates without rehearsal times, and the call logs how many service types it
 * left unread.
 */
export const getPeopleDashboardActivity = ({
  personIds,
  dependencies: { peopleService, plansService, resolveTimeZone },
}: {
  personIds: readonly string[];
  dependencies: PeopleDashboardActivityDependencies;
}): Effect.Effect<PeopleDashboardActivityBatch, PlanningCenterError> =>
  Effect.gen(function* readPeopleDashboardActivity() {
    const orgTimeZone = yield* resolveTimeZone;
    const now = new Date();
    const historyDayKey = formatCalendarDayInTimeZone(
      new Date(now.getTime() - SCHEDULE_HISTORY_DAYS * DAY_MS),
      orgTimeZone
    );
    const planTimeStart = new Date(
      now.getTime() - PLAN_TIME_WINDOW_DAYS * DAY_MS
    );
    const afterDayKey = formatCalendarDayInTimeZone(planTimeStart, orgTimeZone);
    const beforeDayKey = formatCalendarDayInTimeZone(
      new Date(now.getTime() + FUTURE_WINDOW_DAYS * DAY_MS),
      orgTimeZone
    );
    const uniquePersonIds = [...new Set(personIds)];

    // Schedules first, by their upper-bound cost, leaving room for a plan range.
    const beforeSchedules = yield* planningCenterRequestsSpent;
    const admittedCount = Math.min(
      uniquePersonIds.length,
      Math.max(
        1,
        Math.floor(
          (PROGRESSIVE_REQUEST_BUDGET -
            beforeSchedules -
            PLAN_RANGE_MAX_PAGES) /
            SCHEDULE_MAX_PAGES
        )
      )
    );
    const admitted = uniquePersonIds.slice(0, admittedCount);
    const deferred = new Set(uniquePersonIds.slice(admittedCount));
    const schedules = yield* Effect.forEach(
      admitted,
      (personId) =>
        Effect.map(
          peopleService.getPersonSchedulesAfter(
            personId,
            historyDayKey,
            SCHEDULE_MAX_PAGES,
            { includeDeclined: true, newestFirst: true }
          ),
          ({ data, included }): PersonSchedules => ({
            personId,
            data,
            included,
          })
        ),
      { concurrency: READ_CONCURRENCY }
    );
    const afterSchedules = yield* planningCenterRequestsSpent;

    // In order of first need, so the first person's service types come first.
    // Only schedules the plan-range reads cover need their rehearsal times.
    const missing = findServiceTypesMissingPlanTimes(
      schedules.map((person) => ({
        ...person,
        data: person.data.filter((schedule) => {
          const sortDate = scheduleSortDate(schedule);
          return (
            !isDeclinedStatus(scheduleStatus(schedule)) &&
            (sortDate === undefined || sortDate >= planTimeStart)
          );
        }),
      }))
    );
    const serviceTypeIds = [...missing.keys()];
    const [firstPersonId] = admitted;
    const firstPersonTypes = serviceTypeIds.filter(
      (id) => missing.get(id)?.has(firstPersonId ?? "") === true
    ).length;
    const slots = Math.max(
      Math.floor(
        (PROGRESSIVE_REQUEST_BUDGET - afterSchedules) / PLAN_RANGE_MAX_PAGES
      ),
      Math.min(
        firstPersonTypes,
        Math.floor(
          (PLANNING_CENTER_REQUEST_CAP - afterSchedules) / PLAN_RANGE_MAX_PAGES
        )
      ),
      0
    );
    let unreadFirstPersonTypes = 0;
    for (const serviceTypeId of serviceTypeIds.slice(slots)) {
      for (const personId of missing.get(serviceTypeId) ?? []) {
        if (personId === firstPersonId) {
          unreadFirstPersonTypes += 1;
        } else {
          deferred.add(personId);
        }
      }
    }
    const planRanges = yield* Effect.forEach(
      serviceTypeIds.slice(0, slots),
      (serviceTypeId) =>
        plansService
          .getPlansWithIncludedInDateRange(
            serviceTypeId,
            afterDayKey,
            beforeDayKey,
            "plan_times",
            orgTimeZone
          )
          .pipe(
            // A schedule in another organization names a service type this
            // one cannot read; those schedules keep their plan date and
            // still count, without rehearsal or month-day detail.
            recoverPlanningCenterFailure({
              kinds: ["not-found"],
              reason:
                "Service type not found; its schedules keep their plan dates without rehearsal times",
              details: { serviceTypeId },
              fallback: () => ({ data: [], included: [] }),
            })
          ),
      { concurrency: READ_CONCURRENCY }
    );
    const planTimes = planRanges.flatMap(({ included }) =>
      included.filter((resource) => resource.type === "PlanTime")
    );

    const people = schedules.flatMap(({ personId, data, included }) =>
      deferred.has(personId)
        ? []
        : [
            buildPersonActivity(
              personId,
              data,
              [...included, ...planTimes],
              now,
              orgTimeZone
            ),
          ]
    );
    const spent = yield* planningCenterRequestsSpent;
    const requestBudget = {
      limit: PROGRESSIVE_REQUEST_BUDGET,
      planningCenterRequests: spent,
      scheduleRequests: afterSchedules - beforeSchedules,
      planTimeRequests: spent - afterSchedules,
    };
    log.info(
      {
        ...requestBudget,
        requestedPeopleCount: uniquePersonIds.length,
        hydratedPeopleCount: people.length,
        deferredPeopleCount: deferred.size,
        unreadFirstPersonServiceTypeCount: unreadFirstPersonTypes,
        // Full reads may have stopped at the page cap, dropping oldest history.
        scheduleCapReachedPeopleCount: schedules.filter(
          ({ data }) => data.length >= SCHEDULE_MAX_PAGES * SCHEDULE_PAGE_SIZE
        ).length,
      },
      "People dashboard activity read"
    );
    return {
      generatedAt: now.toISOString(),
      people,
      deferredPersonIds: uniquePersonIds.filter((id) => deferred.has(id)),
      requestBudget,
    };
  }).pipe(withPlanningCenterRequestCount);
