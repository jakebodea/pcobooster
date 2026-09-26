import { oc } from "@orpc/contract";
import { applicationErrorMap } from "@pcobooster/contracts/errors";
import { peopleDashboardRosterSchema } from "@pcobooster/contracts/people-schemas";
import { z } from "zod";

/** How long something must go unused before cleanup suggests it. */
export const CLEANUP_STALE_MONTHS = [3, 6, 12, 24] as const;
export const DEFAULT_CLEANUP_STALE_MONTHS = 12;

const staleMonthsSchema = z.union(
  CLEANUP_STALE_MONTHS.map((months) => z.literal(months))
);

export const cleanupSongsInputSchema = z.object({
  staleMonths: staleMonthsSchema,
});

export const cleanupSongSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  /** Null when Planning Center has never scheduled the song. */
  lastScheduledAt: z.date().nullable(),
  createdAt: z.date().nullable(),
});

export const cleanupSongsSchema = z.object({
  generatedAt: z.string(),
  /** Songs not scheduled since this instant (or never) and older than it. */
  cutoff: z.string(),
  /** Visible songs read from the catalog. */
  scannedCount: z.number().int().nonnegative(),
  /** The catalog read stopped at its page limit, so older songs may be missing. */
  truncated: z.boolean(),
  songs: z.array(cleanupSongSchema),
});

/**
 * People per `cleanup.peopleActivity` call. Each person costs one schedule
 * page, so a full batch stays well under the per-call budget.
 */
export const CLEANUP_PEOPLE_BATCH_SIZE = 24;

export const cleanupPeopleActivityInputSchema = z.object({
  staleMonths: staleMonthsSchema,
  personIds: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(CLEANUP_PEOPLE_BATCH_SIZE),
});

export const cleanupPersonActivitySchema = z.object({
  id: z.string(),
  /** Schedules (not declined) since the cutoff, past or upcoming; capped at one page. */
  scheduleCount: z.number().int().nonnegative(),
});

export const cleanupPeopleActivitySchema = z.object({
  cutoff: z.string(),
  people: z.array(cleanupPersonActivitySchema),
  /** People the call had no budget for; send them again. */
  deferredPersonIds: z.array(z.string()),
});

const cleanupProcedure = oc.errors({
  UNAUTHORIZED: applicationErrorMap.UNAUTHORIZED,
  FORBIDDEN: applicationErrorMap.FORBIDDEN,
  NOT_FOUND: applicationErrorMap.NOT_FOUND,
  TOO_MANY_REQUESTS: applicationErrorMap.TOO_MANY_REQUESTS,
  BAD_GATEWAY: applicationErrorMap.BAD_GATEWAY,
  INTERNAL_SERVER_ERROR: applicationErrorMap.INTERNAL_SERVER_ERROR,
});

export const cleanupContract = {
  songs: cleanupProcedure
    .route({
      method: "GET",
      path: "/cleanup/songs",
      summary: "List songs that have not been scheduled in a while",
    })
    .input(cleanupSongsInputSchema)
    .output(cleanupSongsSchema),
  peopleRoster: cleanupProcedure
    .route({
      method: "GET",
      path: "/cleanup/people-roster",
      summary: "Read the team members cleanup checks",
    })
    .output(peopleDashboardRosterSchema),
  peopleActivity: cleanupProcedure
    .route({
      method: "POST",
      path: "/cleanup/people-activity",
      summary: "Count recent schedules for a batch of team members",
    })
    .input(cleanupPeopleActivityInputSchema)
    .output(cleanupPeopleActivitySchema),
};

export type CleanupStaleMonths = z.output<typeof staleMonthsSchema>;
export type CleanupSongsInput = z.input<typeof cleanupSongsInputSchema>;
export type CleanupSong = z.output<typeof cleanupSongSchema>;
export type CleanupSongs = z.output<typeof cleanupSongsSchema>;
export type CleanupPeopleActivityInput = z.input<
  typeof cleanupPeopleActivityInputSchema
>;
export type CleanupPeopleActivity = z.output<
  typeof cleanupPeopleActivitySchema
>;
export type CleanupPersonActivity = z.output<
  typeof cleanupPersonActivitySchema
>;
