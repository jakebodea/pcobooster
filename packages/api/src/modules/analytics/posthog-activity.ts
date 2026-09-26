import type { ActivityEventInput } from "@pcobooster/api/db/activity-events";
import {
  createPostHogCaptureSender,
  toPostHogPersonSet,
} from "@pcobooster/api/modules/analytics/posthog-capture";
import type {
  PostHogPersonProperties,
  PostHogPersonSet,
} from "@pcobooster/api/modules/analytics/posthog-capture";
import { z } from "zod";

const EVENT_NAMES = {
  auth_session_created: "signed in",
  auth_session_deleted: "signed out",
  auth_account_linked: "planning center account linked",
  auth_sign_in_failed: "sign in failed",
  schedule_attempt: "schedule assign attempted",
  schedule_status_change: "schedule status changed",
  schedule_remove: "schedule person removed",
} as const satisfies Record<ActivityEventInput["eventType"], string>;

interface PostHogActivityProperties {
  readonly source: "server";
  readonly success: boolean | null;
  readonly status_code: number | null;
  readonly error_code: string | null;
  readonly service_type_id: string | null;
  readonly plan_id: string | null;
  readonly team_id: string | null;
  readonly position_id: string | null;
  readonly schedule_status: string | null;
  readonly organization_id: string | null;
  readonly one_off: boolean | null;
  readonly $set?: PostHogPersonSet;
}

export interface PostHogCapture {
  readonly api_key: string;
  readonly event: string;
  readonly distinct_id: string;
  readonly timestamp: string;
  readonly properties: PostHogActivityProperties;
}

const metadataStringSchema = z.string();
const metadataBooleanSchema = z.boolean();

/**
 * Forwards audit rows without request fingerprints (IP, user agent) or
 * Planning Center person IDs; the database remains the full audit log.
 */
export const toPostHogCapture = (
  apiKey: string,
  input: ActivityEventInput,
  person: PostHogPersonProperties | null,
  now: Date
): PostHogCapture | null => {
  if (input.actorUserId === null || input.actorUserId === undefined) {
    return null;
  }
  const oneOff = metadataBooleanSchema.safeParse(input.metadata?.oneOff);
  const activity: PostHogActivityProperties = {
    source: "server",
    success: input.success ?? null,
    status_code: input.statusCode ?? null,
    error_code: input.errorCode ?? null,
    service_type_id: input.serviceTypeId ?? null,
    plan_id: input.planId ?? null,
    team_id: input.teamId ?? null,
    position_id: input.positionId ?? null,
    schedule_status:
      metadataStringSchema.safeParse(input.metadata?.status).data ?? null,
    organization_id:
      metadataStringSchema.safeParse(input.metadata?.organizationId).data ??
      null,
    one_off: oneOff.success ? oneOff.data : null,
  };
  const properties: PostHogActivityProperties =
    person === null
      ? activity
      : { ...activity, $set: toPostHogPersonSet(person) };
  return {
    api_key: apiKey,
    event: EVENT_NAMES[input.eventType],
    distinct_id: input.actorUserId,
    timestamp: now.toISOString(),
    properties,
  };
};

export type ForwardActivityEvent = (
  input: ActivityEventInput,
  person?: PostHogPersonProperties | null
) => Promise<void>;

export const createPostHogActivityForwarder = ({
  apiKey,
  fetch: send,
  now = () => new Date(),
}: {
  apiKey: string | undefined;
  fetch: typeof globalThis.fetch;
  now?: () => Date;
}): ForwardActivityEvent => {
  if (apiKey === undefined || apiKey === "") {
    return async () => {
      // Analytics is disabled outside production.
    };
  }
  const sendCapture = createPostHogCaptureSender(send);
  return async (input, person = null) => {
    const capture = toPostHogCapture(apiKey, input, person, now());
    if (capture !== null) {
      await sendCapture(capture);
    }
  };
};
