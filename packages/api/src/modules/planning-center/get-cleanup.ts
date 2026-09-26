import { logger } from "@pcobooster/api/logger";
import { normalizeSongCatalogEntry } from "@pcobooster/api/modules/planning-center/plan-items-shared";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import {
  planningCenterRequestsSpent,
  PROGRESSIVE_REQUEST_BUDGET,
} from "@pcobooster/api/planning-center/request-budget";
import type { PlanningCenterPeopleService } from "@pcobooster/api/planning-center/services/people-service";
import type { PlanningCenterSongsService } from "@pcobooster/api/planning-center/services/songs-service";
import { DEFAULT_CATALOG_MAX_PAGES } from "@pcobooster/api/planning-center/services/songs-service";
import type {
  CleanupPeopleActivity,
  CleanupSong,
  CleanupSongs,
} from "@pcobooster/contracts/cleanup";
import { formatCalendarDayInTimeZone } from "@pcobooster/planning-center-models/calendar";
import { isString } from "@pcobooster/planning-center-models/json";
import type { JsonValue } from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

const log = logger.for("planning-center/cleanup");

/** Planning Center pages hold 100 records. */
const CATALOG_PAGE_SIZE = 100;
/** Workers allows 6 open connections per invocation; leave headroom. */
const READ_CONCURRENCY = 4;
/** One page answers "any schedule since the cutoff?"; more would only count higher. */
const SCHEDULE_PAGES = 1;

/** `now` moved back `months` calendar months in UTC, clamped to the target month's last day. */
export const cleanupCutoff = (now: Date, months: number): Date => {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(now.getUTCDate(), lastDay),
      now.getUTCHours(),
      now.getUTCMinutes()
    )
  );
};

const readDate = (value: JsonValue | undefined): Date | null => {
  if (!isString(value) || !value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export interface StaleSongSelection {
  readonly songs: CleanupSong[];
  /** Visible songs checked. */
  readonly scannedCount: number;
}

/**
 * Visible songs last scheduled before `cutoff`, and never-scheduled songs added
 * before it. Never-scheduled songs come first, then the longest unused.
 */
export const selectStaleSongs = (
  catalog: readonly PCResource[],
  cutoff: Date
): StaleSongSelection => {
  const songs: CleanupSong[] = [];
  let scannedCount = 0;
  for (const resource of catalog) {
    const entry = normalizeSongCatalogEntry(resource);
    if (entry.hidden) {
      continue;
    }
    scannedCount += 1;
    const createdAt = readDate(resource.attributes.created_at);
    const lastUsed = entry.lastScheduledAt ?? createdAt;
    if (lastUsed !== null && lastUsed >= cutoff) {
      continue;
    }
    songs.push({
      id: entry.id,
      title: entry.title,
      author: entry.author,
      lastScheduledAt: entry.lastScheduledAt,
      createdAt,
    });
  }
  songs.sort((a, b) => {
    const aTime = a.lastScheduledAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const bTime = b.lastScheduledAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    return aTime - bTime || a.title.localeCompare(b.title);
  });
  return { songs, scannedCount };
};

export interface CleanupSongsDependencies {
  readonly cacheScope: string;
  readonly songsService: Pick<
    PlanningCenterSongsService,
    "getSongsCatalogCached"
  >;
}

/** Reads the shared, cached song catalog; its pages are the only requests. */
export const getCleanupSongs = (
  staleMonths: number,
  { cacheScope, songsService }: CleanupSongsDependencies,
  now: Date = new Date()
): Effect.Effect<CleanupSongs, PlanningCenterError> =>
  Effect.gen(function* readCleanupSongs() {
    const catalog = yield* songsService.getSongsCatalogCached(cacheScope);
    const cutoff = cleanupCutoff(now, staleMonths);
    const { songs, scannedCount } = selectStaleSongs(catalog, cutoff);
    const truncated =
      catalog.length >= DEFAULT_CATALOG_MAX_PAGES * CATALOG_PAGE_SIZE;
    log.info(
      { staleMonths, scannedCount, staleCount: songs.length, truncated },
      "Cleanup songs read"
    );
    return {
      generatedAt: now.toISOString(),
      cutoff: cutoff.toISOString(),
      scannedCount,
      truncated,
      songs,
    };
  });

const isDeclined = (schedule: PCResource) => {
  const { status } = schedule.attributes;
  return isString(status) && (status === "D" || status === "declined");
};

export interface CleanupPeopleDependencies {
  readonly peopleService: Pick<
    PlanningCenterPeopleService,
    "getPersonSchedulesAfter"
  >;
  readonly resolveTimeZone: Effect.Effect<string, PlanningCenterError>;
}

/**
 * Counts each person's schedules since the cutoff, past and upcoming, declined
 * ones excluded. Each person costs one schedule page; people past the call's
 * budget come back in `deferredPersonIds`.
 */
export const getCleanupPeopleActivity = (
  input: {
    readonly staleMonths: number;
    readonly personIds: readonly string[];
  },
  { peopleService, resolveTimeZone }: CleanupPeopleDependencies,
  now: Date = new Date()
): Effect.Effect<CleanupPeopleActivity, PlanningCenterError> =>
  Effect.gen(function* readCleanupPeopleActivity() {
    const orgTimeZone = yield* resolveTimeZone;
    const cutoff = cleanupCutoff(now, input.staleMonths);
    const afterDayKey = formatCalendarDayInTimeZone(cutoff, orgTimeZone);
    const personIds = [...new Set(input.personIds)];
    const spent = yield* planningCenterRequestsSpent;
    const admittedCount = Math.min(
      personIds.length,
      Math.max(
        1,
        Math.floor((PROGRESSIVE_REQUEST_BUDGET - spent) / SCHEDULE_PAGES)
      )
    );
    const admitted = personIds.slice(0, admittedCount);
    const people = yield* Effect.forEach(
      admitted,
      (personId) =>
        Effect.map(
          peopleService.getPersonSchedulesAfter(
            personId,
            afterDayKey,
            SCHEDULE_PAGES
          ),
          ({ data }) => ({
            id: personId,
            scheduleCount: data.filter((schedule) => !isDeclined(schedule))
              .length,
          })
        ),
      { concurrency: READ_CONCURRENCY }
    );
    const deferredPersonIds = personIds.slice(admittedCount);
    log.info(
      {
        staleMonths: input.staleMonths,
        readCount: people.length,
        staleCount: people.filter((person) => person.scheduleCount === 0)
          .length,
        deferredCount: deferredPersonIds.length,
      },
      "Cleanup people activity read"
    );
    return { cutoff: cutoff.toISOString(), people, deferredPersonIds };
  });
