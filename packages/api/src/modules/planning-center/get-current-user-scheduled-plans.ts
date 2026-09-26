import type { DevBypassIdentity } from "@pcobooster/api/auth/dev-bypass";
import type { PlanningCenterIdentity } from "@pcobooster/api/auth/planning-center-identity";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import type { PlanningCenterPeopleService } from "@pcobooster/api/planning-center/services/people-service";
import {
  isNonEmptyString,
  isString,
} from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

const PERSON_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;

const extractPersonIdFromIdentitySub = (sub: string | null): string | null => {
  if (!isNonEmptyString(sub)) {
    return null;
  }
  const trimmed = sub.trim();
  if (!trimmed) {
    return null;
  }

  if (PERSON_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const urlParts = parsed.pathname.split("/").filter(Boolean);
    return urlParts.at(-1) ?? null;
  } catch {
    const parts = trimmed.split("/").filter(Boolean);
    return parts.at(-1) ?? null;
  }
};

const getRelatedPlanId = (schedule: PCResource): string | null => {
  const planRel = schedule.relationships?.plan?.data;
  if (!planRel || Array.isArray(planRel)) {
    return null;
  }
  return planRel.id;
};

const isScheduledStatus = (status: string | undefined): boolean => {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized !== "declined" && normalized !== "d";
};

export interface CurrentUserIdentityDependencies {
  readonly isDevAuthBypassEnabled: () => boolean;
  readonly loadDevBypassIdentity: () => Promise<DevBypassIdentity>;
  readonly getPlanningCenterIdentityForAccount: (
    request: Request,
    account: { id: string; accountId: string }
  ) => Promise<PlanningCenterIdentity | null>;
}

export interface CurrentUserScheduledPlansDependencies extends CurrentUserIdentityDependencies {
  readonly peopleService: Pick<
    PlanningCenterPeopleService,
    "getPersonSchedules"
  >;
}

const collectScheduledPlanIds = (
  schedules: PCResource[],
  requestedPlanIds: Set<string>
): string[] => {
  const matchedPlanIds = new Set<string>();

  for (const schedule of schedules) {
    if (
      !isScheduledStatus(
        isString(schedule.attributes.status)
          ? schedule.attributes.status
          : undefined
      )
    ) {
      continue;
    }

    const planId = getRelatedPlanId(schedule);
    if (!isNonEmptyString(planId) || !requestedPlanIds.has(planId)) {
      continue;
    }
    matchedPlanIds.add(planId);

    if (matchedPlanIds.size === requestedPlanIds.size) {
      break;
    }
  }

  return [...matchedPlanIds];
};

/** The signed-in account's Planning Center person id; null when it cannot be read. */
export const resolveCurrentUserPersonId = (
  request: Request,
  account: { id: string; accountId: string },
  dependencies: CurrentUserIdentityDependencies
): Effect.Effect<string | null> =>
  Effect.gen(function* readCurrentUserPersonId() {
    if (dependencies.isDevAuthBypassEnabled()) {
      const identity = yield* Effect.promise(
        async () => await dependencies.loadDevBypassIdentity()
      );
      return isNonEmptyString(identity.personId) ? identity.personId : null;
    }
    const identity = yield* Effect.promise(
      async () =>
        await dependencies.getPlanningCenterIdentityForAccount(request, account)
    );
    return extractPersonIdFromIdentitySub(identity?.sub ?? null);
  });

export const getCurrentUserScheduledPlanIds = (
  request: Request,
  account: { id: string; accountId: string },
  planIds: string[],
  dependencies: CurrentUserScheduledPlansDependencies
): Effect.Effect<string[], PlanningCenterError> =>
  Effect.gen(function* readCurrentUserScheduledPlanIds() {
    if (planIds.length === 0) {
      return [];
    }

    const personId = yield* resolveCurrentUserPersonId(
      request,
      account,
      dependencies
    );
    if (!isNonEmptyString(personId)) {
      return [];
    }

    const response = yield* dependencies.peopleService.getPersonSchedules(
      personId,
      { order: "-starts_at" },
      5
    );
    return collectScheduledPlanIds(response.data, new Set(planIds));
  });
