import { RequestContext } from "@pcobooster/api/application/context";
import type { ApplicationFault } from "@pcobooster/api/application/errors";
import { NotFound } from "@pcobooster/api/application/errors/not-found";
import { featureFlagSubjectFor } from "@pcobooster/api/application/feature-flags";
import {
  PlanningCenterAccess,
  withPlanningCenterFaults,
} from "@pcobooster/api/application/planning-center-access";
import type { PlanningCenterRequestAccess } from "@pcobooster/api/application/planning-center-access";
import { requestPresentationDependencies } from "@pcobooster/api/application/presentation";
import { loadDevBypassIdentity } from "@pcobooster/api/auth/dev-bypass";
import { getPlanningCenterIdentityForAccount } from "@pcobooster/api/auth/planning-center-account-identity";
import { getCandidateDetails } from "@pcobooster/api/modules/planning-center/get-candidate-details";
import type {
  CandidateDetailsBatch,
  CandidateDetailsInput,
} from "@pcobooster/api/modules/planning-center/get-candidate-details";
import {
  getCurrentUserScheduledPlanIds,
  resolveCurrentUserPersonId,
} from "@pcobooster/api/modules/planning-center/get-current-user-scheduled-plans";
import type { CurrentUserIdentityDependencies } from "@pcobooster/api/modules/planning-center/get-current-user-scheduled-plans";
import {
  getPeopleDashboardActivity as getPeopleDashboardActivityData,
  getPeopleDashboardRoster as getPeopleDashboardRosterData,
} from "@pcobooster/api/modules/planning-center/get-people-dashboard";
import { getPeopleDashboardPerson as getPeopleDashboardPersonDetail } from "@pcobooster/api/modules/planning-center/get-people-dashboard-person";
import { getFutureBlockoutsForPerson } from "@pcobooster/api/modules/planning-center/get-person-blockouts";
import { getPlanWindowHistory } from "@pcobooster/api/modules/planning-center/get-plan-window-history";
import type {
  PlanWindowHistoryBatch,
  PlanWindowHistoryInput,
} from "@pcobooster/api/modules/planning-center/get-plan-window-history";
import { getPositionCandidates } from "@pcobooster/api/modules/planning-center/get-position-candidates";
import type { PositionCandidatesResult } from "@pcobooster/api/modules/planning-center/get-position-candidates";
import type {
  PeopleDashboardActivityBatch,
  PeopleDashboardPersonDetail,
  PeopleDashboardRoster,
} from "@pcobooster/api/modules/planning-center/people-dashboard-types";
import {
  presentBlockouts,
  presentCandidateDetails,
  presentDashboardRoster,
  presentDashboardPerson,
  presentPlanWindowHistory,
  presentPositionCandidates,
  getPresentationIdentityMapper,
} from "@pcobooster/api/modules/planning-center/presentation";
import { searchPeople } from "@pcobooster/api/modules/planning-center/search-people";
import type { PeopleSearchResult } from "@pcobooster/api/modules/planning-center/search-people";
import { Server } from "@pcobooster/api/server";
import type { Blockout } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

const currentUserIdentityDependencies = Effect.gen(
  function* readCurrentUserIdentityDependencies() {
    const { auth, config } = yield* Server;
    const dependencies: CurrentUserIdentityDependencies = {
      isDevAuthBypassEnabled: () => config.devAuthBypass,
      loadDevBypassIdentity: async () =>
        await loadDevBypassIdentity(config.localPlanningCenterToken),
      getPlanningCenterIdentityForAccount: async (request, account) =>
        await getPlanningCenterIdentityForAccount(auth, request, account),
    };
    return dependencies;
  }
);

/** The signed-in person's Planning Center id; null for demo visitors or when unreadable. */
const currentUserPersonId = (access: PlanningCenterRequestAccess) =>
  Effect.gen(function* readCurrentUserPersonId() {
    // A demo visitor is not a person in the demo organization.
    if (access.authentication.kind === "demo") {
      return null;
    }
    const { request } = yield* RequestContext;
    return yield* resolveCurrentUserPersonId(
      request,
      access.authentication.account,
      yield* currentUserIdentityDependencies
    );
  });

/** The People dashboard exists only where the `people` flag is on for this caller. */
const requirePeopleDashboard = (access: PlanningCenterRequestAccess) =>
  Effect.gen(function* checkPeopleFlag() {
    const { featureFlags } = yield* Server;
    const enabled = yield* featureFlags.isEnabled(
      "people",
      featureFlagSubjectFor(access.authentication)
    );
    if (!enabled) {
      yield* Effect.fail(
        new NotFound({
          message: "People dashboard is not enabled.",
          resource: "people-dashboard",
        })
      );
    }
  });

export const getPeoplePositionCandidates = (input: {
  readonly serviceTypeId: string;
  readonly positionId: string;
  readonly teamId?: string;
  readonly planId: string;
}): Effect.Effect<
  PositionCandidatesResult,
  ApplicationFault,
  PlanningCenterAccess | RequestContext | Server
> =>
  Effect.gen(function* listPositionCandidates() {
    const access = yield* PlanningCenterAccess;
    const result = yield* getPositionCandidates(input, {
      people: access.services.people,
      resolveTimeZone: access.services.organizationTimeZone,
    });
    return yield* presentPositionCandidates(
      result,
      yield* requestPresentationDependencies
    );
  }).pipe(withPlanningCenterFaults);

export const getPeoplePlanWindowHistory = (
  input: PlanWindowHistoryInput
): Effect.Effect<
  PlanWindowHistoryBatch,
  ApplicationFault,
  PlanningCenterAccess | RequestContext | Server
> =>
  Effect.gen(function* readPlanWindowHistory() {
    const access = yield* PlanningCenterAccess;
    const batch = yield* getPlanWindowHistory(input, {
      catalog: access.services.catalog,
      people: access.services.people,
      plans: access.services.plans,
      resolveTimeZone: access.services.organizationTimeZone,
    });
    return presentPlanWindowHistory(batch, access.presentation);
  }).pipe(withPlanningCenterFaults);

export const getPeopleCandidateDetails = (
  input: CandidateDetailsInput
): Effect.Effect<
  CandidateDetailsBatch,
  ApplicationFault,
  PlanningCenterAccess | RequestContext | Server
> =>
  Effect.gen(function* readCandidateDetails() {
    const access = yield* PlanningCenterAccess;
    const batch = yield* getCandidateDetails(input, {
      people: access.services.people,
      resolveTimeZone: access.services.organizationTimeZone,
    });
    return presentCandidateDetails(batch, access.presentation);
  }).pipe(withPlanningCenterFaults);

export const getPeopleSearch = (input: {
  readonly query: string;
}): Effect.Effect<
  PeopleSearchResult[],
  ApplicationFault,
  PlanningCenterAccess | RequestContext | Server
> =>
  Effect.gen(function* searchDirectory() {
    const access = yield* PlanningCenterAccess;
    return yield* searchPeople(input.query, 15, {
      people: access.services.people,
      getIdentityMapper: getPresentationIdentityMapper(
        yield* requestPresentationDependencies
      ),
    });
  }).pipe(withPlanningCenterFaults);

export const getPeopleBlockouts = (input: {
  readonly personId: string;
}): Effect.Effect<
  Blockout[],
  ApplicationFault,
  PlanningCenterAccess | RequestContext | Server
> =>
  Effect.gen(function* listPeopleBlockouts() {
    const access = yield* PlanningCenterAccess;
    const blockouts = yield* getFutureBlockoutsForPerson(input.personId, {
      peopleService: access.services.people,
    });
    return presentBlockouts(blockouts, access.presentation);
  }).pipe(withPlanningCenterFaults);

export const getPeopleDashboardRoster = (): Effect.Effect<
  PeopleDashboardRoster,
  ApplicationFault,
  PlanningCenterAccess | RequestContext | Server
> =>
  Effect.gen(function* readPeopleDashboardRoster() {
    const access = yield* PlanningCenterAccess;
    yield* requirePeopleDashboard(access);
    const roster = yield* getPeopleDashboardRosterData({
      peopleService: access.services.people,
      resolveTimeZone: access.services.organizationTimeZone,
      viewerPersonId: yield* currentUserPersonId(access),
    });
    return yield* presentDashboardRoster(
      roster,
      yield* requestPresentationDependencies
    );
  }).pipe(withPlanningCenterFaults);

export const getPeopleDashboardActivity = (input: {
  readonly personIds: readonly string[];
}): Effect.Effect<
  PeopleDashboardActivityBatch,
  ApplicationFault,
  PlanningCenterAccess | RequestContext | Server
> =>
  Effect.gen(function* readPeopleDashboardActivity() {
    const access = yield* PlanningCenterAccess;
    yield* requirePeopleDashboard(access);
    return yield* getPeopleDashboardActivityData({
      personIds: input.personIds,
      dependencies: {
        peopleService: access.services.people,
        plansService: access.services.plans,
        resolveTimeZone: access.services.organizationTimeZone,
      },
    });
  }).pipe(withPlanningCenterFaults);

export const getPeopleDashboardPerson = (input: {
  readonly personId: string;
  readonly month?: string;
}): Effect.Effect<
  PeopleDashboardPersonDetail,
  ApplicationFault,
  PlanningCenterAccess | RequestContext | Server
> =>
  Effect.gen(function* readPeopleDashboardPerson() {
    const access = yield* PlanningCenterAccess;
    yield* requirePeopleDashboard(access);
    const detail = yield* getPeopleDashboardPersonDetail({
      personId: input.personId,
      month: input.month,
      dependencies: {
        peopleService: access.services.people,
        catalogService: access.services.catalog,
        plansService: access.services.plans,
        resolveTimeZone: access.services.organizationTimeZone,
        detailCache: (yield* Server).moduleReadCaches.peopleDashboardPerson,
      },
    });
    return yield* presentDashboardPerson(
      detail,
      yield* requestPresentationDependencies
    );
  }).pipe(withPlanningCenterFaults);

export const getMyScheduledPlans = (input: {
  readonly planIds: readonly string[];
}): Effect.Effect<
  { readonly planIds: string[] },
  ApplicationFault,
  PlanningCenterAccess | RequestContext | Server
> =>
  Effect.gen(function* readMyScheduledPlans() {
    const access = yield* PlanningCenterAccess;
    const { request } = yield* RequestContext;
    // A demo visitor is not a person in the demo organization.
    if (access.authentication.kind === "demo") {
      return { planIds: [] };
    }
    const { account } = access.authentication;
    const uniquePlanIds = [...new Set(input.planIds)];
    const planIds = yield* getCurrentUserScheduledPlanIds(
      request,
      account,
      uniquePlanIds,
      {
        ...(yield* currentUserIdentityDependencies),
        peopleService: access.services.people,
      }
    );
    return { planIds };
  }).pipe(withPlanningCenterFaults);
