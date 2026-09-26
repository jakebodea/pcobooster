import type { RequestContext } from "@pcobooster/api/application/context";
import type { ApplicationFault } from "@pcobooster/api/application/errors";
import { NotFound } from "@pcobooster/api/application/errors/not-found";
import { featureFlagSubjectFor } from "@pcobooster/api/application/feature-flags";
import {
  PlanningCenterAccess,
  withPlanningCenterFaults,
} from "@pcobooster/api/application/planning-center-access";
import type { PlanningCenterRequestAccess } from "@pcobooster/api/application/planning-center-access";
import { requestPresentationDependencies } from "@pcobooster/api/application/presentation";
import {
  getCleanupPeopleActivity as getCleanupPeopleActivityData,
  getCleanupSongs as getCleanupSongsData,
} from "@pcobooster/api/modules/planning-center/get-cleanup";
import { getPeopleDashboardRoster } from "@pcobooster/api/modules/planning-center/get-people-dashboard";
import type { PeopleDashboardRoster } from "@pcobooster/api/modules/planning-center/people-dashboard-types";
import { presentDashboardRoster } from "@pcobooster/api/modules/planning-center/presentation";
import { Server } from "@pcobooster/api/server";
import type {
  CleanupPeopleActivity,
  CleanupPeopleActivityInput,
  CleanupSongs,
  CleanupSongsInput,
} from "@pcobooster/contracts/cleanup";
import { Effect } from "effect";

/** Data cleanup exists only where the `cleanup` flag is on for this caller. */
const requireCleanup = (access: PlanningCenterRequestAccess) =>
  Effect.gen(function* checkCleanupFlag() {
    const { featureFlags } = yield* Server;
    const enabled = yield* featureFlags.isEnabled(
      "cleanup",
      featureFlagSubjectFor(access.authentication)
    );
    if (!enabled) {
      yield* Effect.fail(
        new NotFound({
          message: "Data cleanup is not enabled.",
          resource: "data-cleanup",
        })
      );
    }
  });

export const getCleanupSongs = (
  input: CleanupSongsInput
): Effect.Effect<
  CleanupSongs,
  ApplicationFault,
  PlanningCenterAccess | RequestContext | Server
> =>
  Effect.gen(function* readCleanupSongs() {
    const access = yield* PlanningCenterAccess;
    yield* requireCleanup(access);
    return yield* getCleanupSongsData(input.staleMonths, {
      cacheScope: access.cacheScope,
      songsService: access.services.songs,
    });
  }).pipe(withPlanningCenterFaults);

/** The same cached team roster the People dashboard reads. */
export const getCleanupPeopleRoster = (): Effect.Effect<
  PeopleDashboardRoster,
  ApplicationFault,
  PlanningCenterAccess | RequestContext | Server
> =>
  Effect.gen(function* readCleanupPeopleRoster() {
    const access = yield* PlanningCenterAccess;
    yield* requireCleanup(access);
    const roster = yield* getPeopleDashboardRoster({
      peopleService: access.services.people,
      resolveTimeZone: access.services.organizationTimeZone,
    });
    return yield* presentDashboardRoster(
      roster,
      yield* requestPresentationDependencies
    );
  }).pipe(withPlanningCenterFaults);

export const getCleanupPeopleActivity = (
  input: CleanupPeopleActivityInput
): Effect.Effect<
  CleanupPeopleActivity,
  ApplicationFault,
  PlanningCenterAccess | RequestContext | Server
> =>
  Effect.gen(function* readCleanupPeopleActivity() {
    const access = yield* PlanningCenterAccess;
    yield* requireCleanup(access);
    return yield* getCleanupPeopleActivityData(input, {
      peopleService: access.services.people,
      resolveTimeZone: access.services.organizationTimeZone,
    });
  }).pipe(withPlanningCenterFaults);
