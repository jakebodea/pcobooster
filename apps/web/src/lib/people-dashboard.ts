import type {
  PeopleDashboardActivity,
  PeopleDashboardLoad,
  PeopleDashboardMonth,
  PeopleDashboardRoster,
  PeopleDashboardTeam,
} from "@pcobooster/contracts/people-schemas";

import type { TeamMember } from "@/lib/team-health";

/** People whose schedules load without asking in the all-teams scope; more load on request. */
export const PEOPLE_DASHBOARD_SAMPLE_SIZE = 48;
/**
 * A team scope loads whole up to this many people, so its health covers
 * everyone; larger scopes load in samples like the all-teams scope.
 */
export const PEOPLE_DASHBOARD_TEAM_SCOPE_LIMIT = 160;
/**
 * Activity calls in flight at once. Each costs about 20 Planning Center
 * requests cold, and the user's budget is 100 per 20 seconds.
 */
export const PEOPLE_DASHBOARD_BATCH_CONCURRENCY = 2;
const MATRIX_DAY_COUNT = 5;
const DAYS_IN_LONGEST_MONTH = 31;

export interface PeopleDashboardDay {
  day: number;
  serviceCount: number;
  confirmedServiceCount: number;
  potentialServiceCount: number;
  rehearsalCount: number;
  blockoutCount: number;
}

/** The teams the viewer leads, every team, or one team by id. */
export type PeopleDashboardScope = "mine" | "all" | `team:${string}`;

const TEAM_SCOPE_PREFIX = "team:";

export const teamScope = (teamId: string): PeopleDashboardScope =>
  `${TEAM_SCOPE_PREFIX}${teamId}`;

/** A select value as a scope; anything unrecognized is null. */
export const parsePeopleDashboardScope = (
  value: string
): PeopleDashboardScope | null => {
  if (value === "mine" || value === "all") {
    return value;
  }
  return value.startsWith(TEAM_SCOPE_PREFIX) &&
    value.length > TEAM_SCOPE_PREFIX.length
    ? teamScope(value.slice(TEAM_SCOPE_PREFIX.length))
    : null;
};

export interface PeopleDashboardProgress {
  /** People in the selected scope. */
  scopePeopleCount: number;
  /** Roster people whose schedules were requested so far. */
  requestedPeopleCount: number;
  hydratedPeopleCount: number;
}

/** The dashboard as the browser assembles it from the roster and activity batches. */
export interface PeopleDashboardData {
  generatedAt: string;
  month: PeopleDashboardMonth;
  /** Roster teams, available before any activity arrives. */
  teams: PeopleDashboardTeam[];
  /** Teams the viewer leads. */
  ledTeamIds: string[];
  /** People in scope with activity loaded, heaviest load first. */
  people: TeamMember[];
  monthDays: PeopleDashboardDay[];
  matrixDays: number[];
  progress: PeopleDashboardProgress;
}

const isConfirmedStatus = (status: string | undefined) => {
  const raw = (status ?? "").trim();
  return raw === "C" || raw.toLowerCase() === "confirmed";
};

const loadRank = (load: PeopleDashboardLoad) => {
  if (load === "rest") {
    return 4;
  }
  if (load === "high") {
    return 3;
  }
  if (load === "normal") {
    return 2;
  }
  return 1;
};

const buildMonthDays = (people: TeamMember[]): PeopleDashboardDay[] =>
  Array.from({ length: DAYS_IN_LONGEST_MONTH }, (_, index) => {
    const day = index + 1;
    const peopleWith = (
      matches: (entry: TeamMember["monthDays"][number]) => boolean
    ) =>
      people.filter((person) =>
        person.monthDays.some((entry) => entry.day === day && matches(entry))
      ).length;
    return {
      day,
      serviceCount: peopleWith((entry) => entry.kind === "service"),
      confirmedServiceCount: peopleWith(
        (entry) => entry.kind === "service" && isConfirmedStatus(entry.status)
      ),
      potentialServiceCount: peopleWith(
        (entry) => entry.kind === "service" && !isConfirmedStatus(entry.status)
      ),
      rehearsalCount: peopleWith((entry) => entry.kind === "rehearsal"),
      blockoutCount: peopleWith((entry) => entry.kind === "blockout"),
    };
  });

const getServiceMatrixDays = (monthDays: PeopleDashboardDay[]) => {
  const days = monthDays
    .filter((day) => day.serviceCount > 0)
    .slice(0, MATRIX_DAY_COUNT)
    .map((day) => day.day);
  return days.length > 0
    ? days
    : monthDays.slice(0, MATRIX_DAY_COUNT).map((day) => day.day);
};

/** The scope a leader lands on: their own teams when they lead any. */
export const defaultPeopleDashboardScope = (
  roster: Pick<PeopleDashboardRoster, "ledTeamIds">
): PeopleDashboardScope => (roster.ledTeamIds.length > 0 ? "mine" : "all");

/** The teams a team scope covers; null for all teams. */
export const scopeTeamIds = (
  scope: PeopleDashboardScope,
  ledTeamIds: readonly string[]
): readonly string[] | null => {
  if (scope === "all") {
    return null;
  }
  return scope === "mine"
    ? ledTeamIds
    : [scope.slice(TEAM_SCOPE_PREFIX.length)];
};

/** The scope's people, in roster order (by last name). */
export const resolveScopePersonIds = (
  roster: PeopleDashboardRoster,
  scope: PeopleDashboardScope
): string[] => {
  const scopedTeamIds = scopeTeamIds(scope, roster.ledTeamIds);
  if (scopedTeamIds === null) {
    return roster.people.map((person) => person.id);
  }
  const teamIds = new Set(scopedTeamIds);
  const inScope = new Set(
    roster.teams.flatMap((team) => (teamIds.has(team.id) ? team.personIds : []))
  );
  return roster.people.flatMap((person) =>
    inScope.has(person.id) ? [person.id] : []
  );
};

/** How many of a scope's people load before the viewer asks for more. */
export const initialScopeLoadCount = (
  scope: PeopleDashboardScope,
  scopePeopleCount: number
) =>
  scope !== "all" && scopePeopleCount <= PEOPLE_DASHBOARD_TEAM_SCOPE_LIMIT
    ? scopePeopleCount
    : PEOPLE_DASHBOARD_SAMPLE_SIZE;

/** The first `targetPeopleCount` scope people, split into activity calls. */
export const planPeopleDashboardBatches = (
  personIds: readonly string[],
  targetPeopleCount: number,
  batchSize: number
): string[][] => {
  const ids = personIds.slice(0, Math.max(0, targetPeopleCount));
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += batchSize) {
    batches.push(ids.slice(start, start + batchSize));
  }
  return batches;
};

export const assemblePeopleDashboard = (
  roster: PeopleDashboardRoster,
  activities: readonly PeopleDashboardActivity[],
  {
    scopePersonIds,
    requestedPeopleCount,
  }: {
    scopePersonIds: readonly string[];
    requestedPeopleCount: number;
  }
): PeopleDashboardData => {
  const activityById = new Map(
    activities.map((activity) => [activity.id, activity])
  );
  const inScope = new Set(scopePersonIds);
  const people = roster.people
    .flatMap((person): TeamMember[] => {
      const activity = activityById.get(person.id);
      if (!activity || !inScope.has(person.id)) {
        return [];
      }
      const { id: _activityId, ...serving } = activity;
      return [{ ...person, ...serving }];
    })
    .toSorted(
      (a, b) =>
        loadRank(b.load) - loadRank(a.load) || b.monthCount - a.monthCount
    );
  const monthDays = buildMonthDays(people);

  return {
    generatedAt: roster.generatedAt,
    month: roster.month,
    teams: roster.teams,
    ledTeamIds: roster.ledTeamIds,
    people,
    monthDays,
    matrixDays: getServiceMatrixDays(monthDays),
    progress: {
      scopePeopleCount: inScope.size,
      requestedPeopleCount: Math.min(requestedPeopleCount, inScope.size),
      hydratedPeopleCount: people.length,
    },
  };
};
