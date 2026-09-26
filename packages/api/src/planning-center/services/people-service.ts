import { buildPlanningCenterUrl } from "@pcobooster/api/planning-center/core-client";
import type {
  PlanningCenterCoreClient,
  PlanningCenterError,
} from "@pcobooster/api/planning-center/core-client";
import { recoverPlanningCenterFailure } from "@pcobooster/api/planning-center/recover-failure";
import { cachedRead } from "@pcobooster/api/planning-center/services/cached-read";
import {
  PlanningCenterReadCache,
  stableParams,
} from "@pcobooster/api/planning-center/services/read-cache";
import {
  isNonEmptyString,
  isString,
} from "@pcobooster/planning-center-models/json";
import type {
  PCApiResponse,
  PCRelationship,
  PCResource,
  PCResourceIdentifier,
} from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

const ASSIGNMENTS_CACHE_TTL_MS = 5 * 60 * 1000;
const PERSON_READ_CACHE_TTL_MS = 60 * 1000;
/** The selected plan's roster, whose statuses a scheduler acts on. */
const PLAN_TEAM_MEMBERS_CACHE_TTL_MS = 30 * 1000;
/** Rosters around a plan date feed history only, so they may lag a little. */
const PLAN_WINDOW_ROSTER_CACHE_TTL_MS = 5 * 60 * 1000;
/** Rosters of plans that already happened rarely change. */
const SETTLED_PLAN_WINDOW_ROSTER_CACHE_TTL_MS = 30 * 60 * 1000;
/** Volunteers add blockouts rarely; this app never writes them. */
const PERSON_BLOCKOUTS_CACHE_TTL_MS = 5 * 60 * 1000;
const PLAN_TIMES_CACHE_TTL_MS = 5 * 60 * 1000;
const PERSON_TEAM_POSITION_ASSIGNMENTS_CACHE_TTL_MS = 5 * 60 * 1000;
const ALL_TEAM_PEOPLE_CACHE_TTL_MS = 5 * 60 * 1000;
const PEOPLE_SEARCH_CACHE_TTL_MS = 60 * 1000;
/** Pages of 100 people `getPlanTeamMembers` reads, at most. */
export const PLAN_ROSTER_MAX_PAGES = 25;
/** 100 teams per page; an organization with more than 1,000 teams is cut off. */
const TEAM_PAGES_MAX = 10;

/** One active team: who is on it and who leads it. */
export interface TeamRoster {
  id: string;
  name: string;
  /** The team's primary service type, to tell same-named teams apart. */
  serviceTypeName: string | null;
  personIds: string[];
  leaderPersonIds: string[];
}

export interface AllTeamPeopleResponse {
  /** Each team member once, in the order teams list them. */
  people: PCResource[];
  included: PCResource[];
  teams: TeamRoster[];
}

interface ResourceCollectionResponse {
  data: PCResource[];
  included: PCResource[];
}

export interface PlanningCenterPeopleServiceCaches {
  readonly people: PlanningCenterReadCache<PCResource>;
  readonly resourceLists: PlanningCenterReadCache<PCResource[]>;
  readonly collections: PlanningCenterReadCache<ResourceCollectionResponse>;
  readonly allTeamPeople: PlanningCenterReadCache<AllTeamPeopleResponse>;
  /** Rosters of the plans around a plan date, read for candidate history. */
  readonly planWindowRosters: PlanningCenterReadCache<ResourceCollectionResponse>;
}

export const createPlanningCenterPeopleServiceCaches =
  (): PlanningCenterPeopleServiceCaches => ({
    people: new PlanningCenterReadCache<PCResource>(),
    resourceLists: new PlanningCenterReadCache<PCResource[]>(),
    collections: new PlanningCenterReadCache<ResourceCollectionResponse>(),
    allTeamPeople: new PlanningCenterReadCache<AllTeamPeopleResponse>(),
    planWindowRosters:
      new PlanningCenterReadCache<ResourceCollectionResponse>(),
  });

const getRelationshipIdentifiers = (
  data: PCRelationship["data"]
): PCResourceIdentifier[] => {
  if (data === undefined || data === null) {
    return [];
  }
  return Array.isArray(data) ? data : [data];
};

const cloneAllTeamPeopleResponse = (
  response: AllTeamPeopleResponse
): AllTeamPeopleResponse => structuredClone(response);

const cloneResourceCollectionResponse = (
  response: ResourceCollectionResponse
): ResourceCollectionResponse => ({
  data: structuredClone(response.data),
  included: structuredClone(response.included),
});

const toResourceCollection = (
  fetched: PCApiResponse<PCResource[]>
): ResourceCollectionResponse => ({
  data: fetched.data,
  included: fetched.included ?? [],
});

const relatedId = (relationship: PCRelationship | undefined) =>
  getRelationshipIdentifiers(relationship?.data)[0]?.id;

interface TeamIncludes {
  peopleById: Map<string, PCResource>;
  leaderPersonIdByLeaderId: Map<string, string>;
  serviceTypeNameById: Map<string, string>;
}

const indexTeamIncludes = (included: readonly PCResource[]): TeamIncludes => {
  const indexes: TeamIncludes = {
    peopleById: new Map(),
    leaderPersonIdByLeaderId: new Map(),
    serviceTypeNameById: new Map(),
  };
  for (const resource of included) {
    if (resource.type === "Person") {
      indexes.peopleById.set(resource.id, resource);
      continue;
    }
    const leaderPersonId =
      resource.type === "TeamLeader"
        ? relatedId(resource.relationships?.person)
        : undefined;
    if (isNonEmptyString(leaderPersonId)) {
      indexes.leaderPersonIdByLeaderId.set(resource.id, leaderPersonId);
    }
    if (
      resource.type === "ServiceType" &&
      isNonEmptyString(resource.attributes.name)
    ) {
      indexes.serviceTypeNameById.set(
        resource.id,
        resource.attributes.name.trim()
      );
    }
  }
  return indexes;
};

/** A team's members that were sideloaded, its leaders, and its service type. */
const toTeamRoster = (team: PCResource, includes: TeamIncludes): TeamRoster => {
  const personIds = getRelationshipIdentifiers(
    team.relationships?.people?.data
  ).flatMap(({ id }) => (includes.peopleById.has(id) ? [id] : []));
  const leaderPersonIds = getRelationshipIdentifiers(
    team.relationships?.team_leaders?.data
  ).flatMap(({ id }) => {
    const personId = includes.leaderPersonIdByLeaderId.get(id);
    return personId === undefined ? [] : [personId];
  });
  const serviceTypeId = relatedId(team.relationships?.service_type);
  const name = isString(team.attributes.name)
    ? team.attributes.name.trim()
    : "";
  return {
    id: team.id,
    name: name || "Unnamed team",
    serviceTypeName:
      serviceTypeId === undefined
        ? null
        : (includes.serviceTypeNameById.get(serviceTypeId) ?? null),
    personIds,
    leaderPersonIds: [...new Set(leaderPersonIds)],
  };
};

/**
 * `teams?include=people,team_leaders,service_types` lists every member and
 * leader of each team in one response (measured: a 65-person team arrives
 * whole), unlike `teams/{id}/people`, which needs one request per team and
 * pages at 25.
 */
const collectTeamPeople = ({
  data: teams,
  included,
}: ResourceCollectionResponse): AllTeamPeopleResponse => {
  const includes = indexTeamIncludes(included);
  const rosters = teams.flatMap((team) =>
    isNonEmptyString(team.attributes.archived_at)
      ? []
      : [toTeamRoster(team, includes)]
  );
  const personIds = new Set(rosters.flatMap((team) => team.personIds));
  const people = [...personIds].flatMap((id) => {
    const person = includes.peopleById.get(id);
    return person === undefined ? [] : [person];
  });
  return { people, included: [], teams: rosters };
};

export class PlanningCenterPeopleService {
  private readonly core: PlanningCenterCoreClient;
  private readonly caches: PlanningCenterPeopleServiceCaches;

  constructor(
    core: PlanningCenterCoreClient,
    caches: PlanningCenterPeopleServiceCaches = createPlanningCenterPeopleServiceCaches()
  ) {
    this.core = core;
    this.caches = caches;
  }

  getPeopleFromTeam(
    teamId: string
  ): Effect.Effect<PCResource[], PlanningCenterError> {
    return this.core.fetchAll(
      `/services/v2/teams/${teamId}/people?include=person`,
      {},
      10
    );
  }

  getPerson(personId: string): Effect.Effect<PCResource, PlanningCenterError> {
    return cachedRead(
      this.caches.people,
      this.buildCacheKey("person", personId),
      PERSON_READ_CACHE_TTL_MS,
      () =>
        Effect.map(
          this.core.fetch(`/services/v2/people/${personId}`),
          (response) => response.data
        )
    ).pipe(Effect.map((person) => structuredClone(person)));
  }

  searchPeopleByName(
    query: string,
    limit = 15
  ): Effect.Effect<PCResource[], PlanningCenterError> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return Effect.succeed([]);
    }

    const endpoint = buildPlanningCenterUrl("/people/v2/people", {
      "where[search_name]": normalizedQuery,
      order: "last_name,first_name",
      per_page: String(limit),
    });
    return cachedRead(
      this.caches.resourceLists,
      this.buildCacheKey(
        "people-search",
        normalizedQuery.toLowerCase(),
        String(limit)
      ),
      PEOPLE_SEARCH_CACHE_TTL_MS,
      () =>
        Effect.map(this.core.fetchCollection(endpoint), (response) =>
          response.data.slice(0, limit)
        )
    ).pipe(Effect.map((data) => structuredClone(data)));
  }

  getAllPeople(): Effect.Effect<PCResource[], PlanningCenterError> {
    return cachedRead(
      this.caches.resourceLists,
      this.buildCacheKey("all-people"),
      ALL_TEAM_PEOPLE_CACHE_TTL_MS,
      () =>
        this.core.fetchAll("/people/v2/people", {}, Number.POSITIVE_INFINITY)
    ).pipe(Effect.map((people) => structuredClone(people)));
  }

  getPersonTeamPositions(
    personId: string
  ): Effect.Effect<PCResource[], PlanningCenterError> {
    return this.core.fetchAll(
      `/services/v2/people/${personId}/person_team_position_assignments?include=team_position`,
      {},
      10
    );
  }

  getAllPeopleFromTeams(): Effect.Effect<
    AllTeamPeopleResponse,
    PlanningCenterError
  > {
    return cachedRead(
      this.caches.allTeamPeople,
      this.buildCacheKey("all-team-people"),
      ALL_TEAM_PEOPLE_CACHE_TTL_MS,
      () => this.loadAllPeopleFromTeams()
    ).pipe(Effect.map(cloneAllTeamPeopleResponse));
  }

  getPersonBlockouts(
    personId: string,
    params: Record<string, string> = {}
  ): Effect.Effect<PCResource[], PlanningCenterError> {
    return cachedRead(
      this.caches.resourceLists,
      this.buildCacheKey("person-blockouts", personId, stableParams(params)),
      PERSON_BLOCKOUTS_CACHE_TTL_MS,
      () =>
        this.core.fetchAll(
          `/services/v2/people/${personId}/blockouts`,
          params,
          10
        )
    ).pipe(Effect.map((blockouts) => structuredClone(blockouts)));
  }

  getPersonBlockoutDates(
    personId: string,
    blockoutId: string
  ): Effect.Effect<PCResource[], PlanningCenterError> {
    return cachedRead(
      this.caches.resourceLists,
      this.buildCacheKey("person-blockout-dates", personId, blockoutId),
      PERSON_BLOCKOUTS_CACHE_TTL_MS,
      () =>
        this.core.fetchAll(
          `/services/v2/people/${personId}/blockouts/${blockoutId}/blockout_dates`,
          {},
          10
        )
    ).pipe(Effect.map((dates) => structuredClone(dates)));
  }

  /**
   * A person's schedules with service PlanTimes sideloaded. Rehearsal PlanTimes are listed in
   * `relationships.times` but not sideloaded; callers that need them resolve them within their
   * request budget.
   */
  getPersonSchedules(
    personId: string,
    params: Record<string, string> = {},
    maxPages = 2
  ): Effect.Effect<ResourceCollectionResponse, PlanningCenterError> {
    return cachedRead(
      this.caches.collections,
      this.buildCacheKey(
        "person-schedules",
        personId,
        stableParams(params),
        String(maxPages)
      ),
      PERSON_READ_CACHE_TTL_MS,
      () =>
        this.core
          .fetchAllWithIncluded(
            `/services/v2/people/${personId}/schedules`,
            { include: "plan_times", ...params },
            maxPages
          )
          .pipe(Effect.map(toResourceCollection))
    ).pipe(Effect.map(cloneResourceCollectionResponse));
  }

  /**
   * Schedules from `after` (a YYYY-MM-DD day or an ISO instant) onward, with service PlanTimes sideloaded. Like
   * `getPersonSchedules`, it leaves rehearsal PlanTimes for callers to resolve. Planning Center's default scope returns only future schedules, so the explicit
   * `after` filter is what makes past schedules visible. Declined schedules stay excluded
   * unless `includeDeclined` asks for them (status `D`). `newestFirst` reads the latest
   * schedules first, so a read cut off at `maxPages` drops the oldest history instead of
   * upcoming dates.
   */
  getPersonSchedulesAfter(
    personId: string,
    after: string,
    maxPages = 3,
    {
      includeDeclined = false,
      newestFirst = false,
    }: {
      readonly includeDeclined?: boolean;
      readonly newestFirst?: boolean;
    } = {}
  ): Effect.Effect<ResourceCollectionResponse, PlanningCenterError> {
    const params = {
      filter: includeDeclined ? "after,with_declined" : "after",
      after,
      include: "plan_times",
      order: newestFirst ? "-starts_at" : "starts_at",
    };
    return cachedRead(
      this.caches.collections,
      this.buildCacheKey(
        "person-schedules",
        personId,
        "after",
        stableParams(params),
        String(maxPages)
      ),
      PERSON_READ_CACHE_TTL_MS,
      () =>
        this.core
          .fetchAllWithIncluded(
            `/services/v2/people/${personId}/schedules`,
            params,
            maxPages
          )
          .pipe(Effect.map(toResourceCollection))
    ).pipe(Effect.map(cloneResourceCollectionResponse));
  }

  /**
   * The person's upcoming plan people with their plans and teams. Unlike schedules, these include
   * requests that were prepared but not sent yet.
   */
  getPersonPlanPeople(
    personId: string
  ): Effect.Effect<ResourceCollectionResponse, PlanningCenterError> {
    return cachedRead(
      this.caches.collections,
      this.buildCacheKey("person-schedules", personId, "plan-people"),
      PERSON_READ_CACHE_TTL_MS,
      () =>
        this.core
          .fetchAllWithIncluded(
            `/services/v2/people/${personId}/plan_people`,
            { include: "plan,team" },
            3
          )
          .pipe(Effect.map(toResourceCollection))
    ).pipe(Effect.map(cloneResourceCollectionResponse));
  }

  /**
   * Cached fetch of all PlanTimes for a plan. Shared across candidates so a position page with
   * 30 candidates serving on the same Sunday plan triggers one fetch, not 30. PlanTimes rarely
   * change, so the TTL is longer than per-person caches. A plan Planning Center does not find
   * (deleted, or in another organization) has no times; every other failure fails the read.
   */
  getPlanPlanTimes(
    planId: string
  ): Effect.Effect<PCResource[], PlanningCenterError> {
    return cachedRead(
      this.caches.resourceLists,
      this.buildCacheKey("plan-plan-times", planId),
      PLAN_TIMES_CACHE_TTL_MS,
      () =>
        this.core
          .fetchAll(
            `/services/v2/plans/${planId}/plan_times`,
            { per_page: "200" },
            10
          )
          .pipe(
            recoverPlanningCenterFailure({
              kinds: ["not-found"],
              reason: "Plan not found; reading it as having no plan times",
              details: { planId },
              fallback: (): PCResource[] => [],
            })
          )
    ).pipe(Effect.map((planTimes) => structuredClone(planTimes)));
  }

  getPeopleForTeamPosition(
    serviceTypeId: string,
    positionId: string
  ): Effect.Effect<ResourceCollectionResponse, PlanningCenterError> {
    return cachedRead(
      this.caches.collections,
      this.buildCacheKey(
        "team-position-assignments",
        serviceTypeId,
        positionId
      ),
      ASSIGNMENTS_CACHE_TTL_MS,
      () =>
        this.core
          .fetchAllWithIncluded(
            `/services/v2/service_types/${serviceTypeId}/team_positions/${positionId}/person_team_position_assignments`,
            { include: "person,team_position" },
            10
          )
          .pipe(Effect.map(toResourceCollection))
    ).pipe(Effect.map(cloneResourceCollectionResponse));
  }

  /** A plan's roster, cached 30 seconds so the statuses a scheduler acts on are fresh. */
  getPlanTeamMembers(
    serviceTypeId: string,
    planId: string
  ): Effect.Effect<ResourceCollectionResponse, PlanningCenterError> {
    return cachedRead(
      this.caches.collections,
      this.buildCacheKey("plan-team-members", serviceTypeId, planId),
      PLAN_TEAM_MEMBERS_CACHE_TTL_MS,
      () => this.loadPlanTeamMembers(serviceTypeId, planId)
    ).pipe(Effect.map(cloneResourceCollectionResponse));
  }

  /**
   * A roster read for history around a plan date: cached 5 minutes, or 30 when the plan already
   * happened (`settled`). Its own key keeps it from standing in for the fresh selected-plan read.
   * Schedule writes clear the plan's copy, and plan time writes clear them all through
   * `invalidatePlanWindowRosters`.
   */
  getPlanWindowRoster(
    serviceTypeId: string,
    planId: string,
    { settled }: { readonly settled: boolean }
  ): Effect.Effect<ResourceCollectionResponse, PlanningCenterError> {
    return cachedRead(
      this.caches.planWindowRosters,
      this.buildCacheKey("plan-window-roster", serviceTypeId, planId),
      settled
        ? SETTLED_PLAN_WINDOW_ROSTER_CACHE_TTL_MS
        : PLAN_WINDOW_ROSTER_CACHE_TTL_MS,
      () => this.loadPlanTeamMembers(serviceTypeId, planId)
    ).pipe(Effect.map(cloneResourceCollectionResponse));
  }

  private loadPlanTeamMembers(
    serviceTypeId: string,
    planId: string
  ): Effect.Effect<ResourceCollectionResponse, PlanningCenterError> {
    return this.core
      .fetchAllWithIncluded(
        `/services/v2/service_types/${serviceTypeId}/plans/${planId}/team_members`,
        { include: "person,team,plan", per_page: "100" },
        PLAN_ROSTER_MAX_PAGES
      )
      .pipe(Effect.map(toResourceCollection));
  }

  getPersonTeamPositionAssignments(
    personId: string
  ): Effect.Effect<ResourceCollectionResponse, PlanningCenterError> {
    return cachedRead(
      this.caches.collections,
      this.buildCacheKey("person-team-position-assignments", personId),
      PERSON_TEAM_POSITION_ASSIGNMENTS_CACHE_TTL_MS,
      () =>
        this.core
          .fetchCollection(
            `/services/v2/people/${personId}/person_team_position_assignments?include=team_position,team_position.team`
          )
          .pipe(Effect.map(toResourceCollection))
    ).pipe(Effect.map(cloneResourceCollectionResponse));
  }

  updatePlanPersonStatus(
    planPersonId: string,
    status: "C" | "U" | "D",
    context?: { personId?: string; serviceTypeId?: string; planId?: string }
  ): Effect.Effect<PCResource, PlanningCenterError> {
    return this.core
      .fetch(`/services/v2/plan_people/${planPersonId}`, {
        method: "PATCH",
        body: {
          data: {
            type: "PlanPerson",
            id: planPersonId,
            attributes: { status },
          },
        },
      })
      .pipe(
        Effect.map((response) => {
          if (
            isNonEmptyString(context?.serviceTypeId) &&
            isNonEmptyString(context.planId)
          ) {
            this.invalidateScheduleReadCaches({
              personId: context.personId,
              serviceTypeId: context.serviceTypeId,
              planId: context.planId,
            });
          }
          return response.data;
        })
      );
  }

  updatePlanPersonTimes({
    personId,
    planPersonId,
    serviceTypeId,
    planId,
    planTimeIds,
  }: {
    personId: string;
    planPersonId: string;
    serviceTypeId: string;
    planId: string;
    planTimeIds: string[];
  }): Effect.Effect<PCResource, PlanningCenterError> {
    return this.core
      .fetch(`/services/v2/people/${personId}/plan_people/${planPersonId}`, {
        method: "PATCH",
        body: {
          data: {
            type: "PlanPerson",
            id: planPersonId,
            relationships: {
              times: {
                data: planTimeIds.map((id) => ({ type: "PlanTime", id })),
              },
            },
          },
        },
      })
      .pipe(
        Effect.map((response) => {
          this.invalidateScheduleReadCaches({
            personId,
            serviceTypeId,
            planId,
          });
          return response.data;
        })
      );
  }

  deletePlanPerson(
    planPersonId: string,
    context?: { personId?: string; serviceTypeId?: string; planId?: string }
  ): Effect.Effect<void, PlanningCenterError> {
    let endpoint = `/services/v2/plan_people/${planPersonId}`;
    if (
      isNonEmptyString(context?.serviceTypeId) &&
      isNonEmptyString(context.planId)
    ) {
      endpoint = `/services/v2/service_types/${context.serviceTypeId}/plans/${context.planId}/team_members/${planPersonId}`;
    } else if (isNonEmptyString(context?.personId)) {
      endpoint = `/services/v2/people/${context.personId}/plan_people/${planPersonId}`;
    }

    return this.core.request(endpoint, { method: "DELETE" }).pipe(
      Effect.asVoid,
      Effect.tap(() =>
        Effect.sync(() => {
          if (
            isNonEmptyString(context?.serviceTypeId) &&
            isNonEmptyString(context.planId)
          ) {
            this.invalidateScheduleReadCaches({
              personId: context.personId,
              serviceTypeId: context.serviceTypeId,
              planId: context.planId,
            });
          }
        })
      )
    );
  }

  /**
   * Schedule a person to a plan for a team. Creates a PlanPerson in Planning Center Services.
   */
  createPlanPerson(
    serviceTypeId: string,
    personId: string,
    planId: string,
    teamId: string,
    teamPositionName: string
  ): Effect.Effect<PCResource, PlanningCenterError> {
    return this.core
      .fetch(
        `/services/v2/service_types/${serviceTypeId}/plans/${planId}/team_members`,
        {
          method: "POST",
          body: {
            data: {
              type: "PlanPerson",
              attributes: {
                status: "U",
                person_id: personId,
                team_id: teamId,
                team_position_name: teamPositionName,
              },
            },
          },
        }
      )
      .pipe(
        Effect.map((response) => {
          this.invalidateScheduleReadCaches({
            personId,
            serviceTypeId,
            planId,
          });
          return response.data;
        })
      );
  }

  invalidateScheduleReadCaches({
    personId,
    serviceTypeId,
    planId,
  }: {
    personId?: string;
    serviceTypeId: string;
    planId: string;
  }) {
    const scope = this.core.getCacheScope();
    const personSchedulesPrefix = isNonEmptyString(personId)
      ? [scope, "person-schedules", encodeURIComponent(personId), ""].join(":")
      : null;
    const planTeamMembersKey = this.buildCacheKey(
      "plan-team-members",
      serviceTypeId,
      planId
    );
    const planWindowRosterKey = this.buildCacheKey(
      "plan-window-roster",
      serviceTypeId,
      planId
    );

    this.caches.collections.deleteWhere(
      (key) =>
        (isNonEmptyString(personSchedulesPrefix)
          ? key.startsWith(personSchedulesPrefix)
          : false) || key === planTeamMembersKey
    );
    this.caches.planWindowRosters.deleteWhere(
      (key) => key === planWindowRosterKey
    );
  }

  /** Schedule and plan time writes change rosters, so this account's window copies go. */
  invalidatePlanWindowRosters() {
    const prefix = [this.core.getCacheScope(), "plan-window-roster", ""].join(
      ":"
    );
    this.caches.planWindowRosters.deleteWhere((key) => key.startsWith(prefix));
  }

  invalidatePlanTimeSensitiveReadCaches(planId: string) {
    const scope = this.core.getCacheScope();
    const planTimesKey = this.buildCacheKey("plan-plan-times", planId);
    const personSchedulesPrefix = [scope, "person-schedules"].join(":");

    this.caches.resourceLists.deleteWhere((key) => key === planTimesKey);
    this.caches.collections.deleteWhere((key) =>
      key.startsWith(personSchedulesPrefix)
    );
  }

  private buildCacheKey(namespace: string, ...parts: string[]): string {
    return [
      this.core.getCacheScope(),
      namespace,
      ...parts.map((part) => encodeURIComponent(part)),
    ].join(":");
  }

  private loadAllPeopleFromTeams(): Effect.Effect<
    AllTeamPeopleResponse,
    PlanningCenterError
  > {
    return this.core
      .fetchAllWithIncluded(
        "/services/v2/teams",
        { include: "people,team_leaders,service_types" },
        TEAM_PAGES_MAX
      )
      .pipe(Effect.map(collectTeamPeople));
  }

  getCacheScope(): string {
    return this.core.getCacheScope();
  }
}
