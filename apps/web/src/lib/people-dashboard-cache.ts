import {
  peopleDashboardActivitySchema,
  peopleDashboardRosterSchema,
} from "@pcobooster/contracts/people-schemas";
import type {
  PeopleDashboardActivity,
  PeopleDashboardPersonDetail,
  PeopleDashboardRoster,
} from "@pcobooster/contracts/people-schemas";
import { z } from "zod";

import { presentationCacheKey } from "@/lib/presentation-cache";

/** Every version's entries, so clearing also drops older versions' saved people. */
const STORAGE_PREFIX = "pcobooster:people-dashboard:";
/** v2: rosters carry teams and leaders; activity carries the serving rhythm. */
const CACHE_VERSION = "v2";
const KEY_PREFIX = `${STORAGE_PREFIX}${CACHE_VERSION}:`;
const PERSON_DETAIL_KEY_PREFIX = `${KEY_PREFIX}person:`;
const ROSTER_KEY = `${KEY_PREFIX}roster`;
const ACTIVITY_KEY = `${KEY_PREFIX}activity`;
/** Activity older than this is dropped when new activity is saved. */
const ACTIVITY_RETENTION_MS = 24 * 60 * 60 * 1000;

interface CachedPayload<T> {
  savedAt: number;
  data: T;
}

export interface PeopleDashboardRosterCacheEntry {
  savedAt: number;
  data: PeopleDashboardRoster;
}

export interface PeopleDashboardActivityCacheEntry {
  savedAt: number;
  data: PeopleDashboardActivity[];
}

export interface PeopleDashboardPersonCacheEntry {
  savedAt: number;
  data: PeopleDashboardPersonDetail;
}

const dashboardMonthSchema = z.object({
  year: z.number(),
  monthIndex: z.number(),
  label: z.string(),
  daysInMonth: z.number(),
  startsOnWeekday: z.number(),
});

const personMonthDaySchema = z.object({
  day: z.number(),
  kind: z.enum(["service", "rehearsal", "blockout", "rest"]),
  positionName: z.string().optional(),
  serviceTypeName: z.string().optional(),
  status: z.string().optional(),
  planUrl: z.string().optional(),
});

const dashboardPersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  photoThumbnailUrl: z.string().nullable(),
  teams: z.array(z.string()),
  roles: z.string(),
  status: z.string(),
  load: z.enum(["low", "normal", "high", "rest"]),
  lastServed: z.string(),
  lastRehearsal: z.string().optional(),
  nextScheduled: z.string(),
  nextRehearsal: z.string().optional(),
  monthCount: z.number(),
  thirtyDayCount: z.number(),
  ninetyDayCount: z.number(),
  upcomingCount: z.number(),
  streak: z.string(),
  highlight: z.string(),
  monthDays: z.array(personMonthDaySchema),
});

const peopleDashboardPersonDetailSchema = z.object({
  generatedAt: z.string(),
  month: dashboardMonthSchema,
  previousMonth: z.string(),
  nextMonth: z.string(),
  person: dashboardPersonSchema,
  trend: z.array(
    z.object({
      month: z.string(),
      label: z.string(),
      services: z.number(),
      rehearsals: z.number(),
    })
  ),
  requestBudget: z.object({
    limit: z.number(),
    planningCenterRequests: z.number(),
    unresolvedRehearsalTimes: z.number(),
  }),
});

const cachedRosterPayloadSchema = z.object({
  savedAt: z.number(),
  data: peopleDashboardRosterSchema,
});

const cachedActivityPayloadSchema = z.record(
  z.string(),
  z.object({ savedAt: z.number(), data: peopleDashboardActivitySchema })
);
type CachedActivityPayload = z.output<typeof cachedActivityPayloadSchema>;

const cachedPersonDetailPayloadSchema = z.object({
  savedAt: z.number(),
  data: peopleDashboardPersonDetailSchema,
});

const buildPersonDetailCacheKey = (
  personId: string,
  month: string | null
): string =>
  presentationCacheKey(
    `${PERSON_DETAIL_KEY_PREFIX}${encodeURIComponent(personId)}:${encodeURIComponent(month ?? "current")}`
  );

/** Reads and validates a stored entry; throws only on malformed JSON. */
const readStorageEntry = <Entry>(
  key: string,
  schema: z.ZodType<Entry>
): Entry | undefined => {
  const raw = globalThis.window?.localStorage.getItem(
    presentationCacheKey(key)
  );
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const parsed = schema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : undefined;
};

const writeStorageJson = (
  key: string,
  value: PeopleDashboardRosterCacheEntry | CachedActivityPayload
): void => {
  globalThis.window?.localStorage.setItem(
    presentationCacheKey(key),
    JSON.stringify(value)
  );
};

export const readCachedPeopleDashboardRoster = ():
  | PeopleDashboardRosterCacheEntry
  | undefined => {
  try {
    return readStorageEntry(ROSTER_KEY, cachedRosterPayloadSchema);
  } catch {
    return undefined;
  }
};

export const writeCachedPeopleDashboardRoster = (
  data: PeopleDashboardRoster
): void => {
  try {
    writeStorageJson(ROSTER_KEY, {
      savedAt: Date.now(),
      data,
    } satisfies CachedPayload<PeopleDashboardRoster>);
  } catch {
    // Ignore storage failures; query invalidation still refreshes live data.
  }
};

const readActivityPayload = (): CachedActivityPayload =>
  readStorageEntry(ACTIVITY_KEY, cachedActivityPayloadSchema) ?? {};

/** Saved activity for every one of `personIds`, or nothing if any is missing. */
export const readCachedPeopleDashboardActivity = (
  personIds: readonly string[]
): PeopleDashboardActivityCacheEntry | undefined => {
  try {
    const payload = readActivityPayload();
    const entries = personIds.map((personId) => payload[personId]);
    const complete = entries.filter((entry) => entry !== undefined);
    if (complete.length === 0 || complete.length !== personIds.length) {
      return undefined;
    }
    return {
      savedAt: Math.min(...complete.map((entry) => entry.savedAt)),
      data: complete.map((entry) => entry.data),
    };
  } catch {
    return undefined;
  }
};

export const writeCachedPeopleDashboardActivity = (
  activities: readonly PeopleDashboardActivity[]
): void => {
  try {
    const savedAt = Date.now();
    const payload: CachedActivityPayload = Object.fromEntries(
      Object.entries(readActivityPayload()).filter(
        ([, entry]) => savedAt - entry.savedAt < ACTIVITY_RETENTION_MS
      )
    );
    for (const activity of activities) {
      payload[activity.id] = { savedAt, data: activity };
    }
    writeStorageJson(ACTIVITY_KEY, payload);
  } catch {
    // Ignore storage failures; query invalidation still refreshes live data.
  }
};

export const readCachedPeopleDashboardPerson = (
  personId: string,
  month: string | null
): PeopleDashboardPersonCacheEntry | undefined => {
  const storage = globalThis.window?.localStorage;
  if (storage === undefined) {
    return undefined;
  }

  try {
    const raw = storage.getItem(buildPersonDetailCacheKey(personId, month));
    if (raw === null) {
      return undefined;
    }
    const parsed = cachedPersonDetailPayloadSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
};

export const writeCachedPeopleDashboardPerson = (
  personId: string,
  month: string | null,
  data: PeopleDashboardPersonDetail
): void => {
  const storage = globalThis.window?.localStorage;
  if (storage === undefined) {
    return;
  }

  try {
    storage.setItem(
      buildPersonDetailCacheKey(personId, month),
      JSON.stringify({
        savedAt: Date.now(),
        data,
      } satisfies CachedPayload<PeopleDashboardPersonDetail>)
    );
  } catch {
    // Ignore storage failures; query invalidation still refreshes live data.
  }
};

export const clearCachedPeopleDashboards = (): void => {
  const storage = globalThis.window?.localStorage;
  if (storage === undefined) {
    return;
  }

  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(STORAGE_PREFIX) === true) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage read/write failures.
  }
};
