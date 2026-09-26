import {
  cleanupCutoff,
  getCleanupPeopleActivity,
  getCleanupSongs,
  selectStaleSongs,
} from "@pcobooster/api/modules/planning-center/get-cleanup";
import type { PlanningCenterPeopleService } from "@pcobooster/api/planning-center/services/people-service";
import type { PlanningCenterSongsService } from "@pcobooster/api/planning-center/services/songs-service";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-09-25T18:00:00.000Z");

const song = (
  id: string,
  attributes: Record<string, string | boolean | null>
): PCResource => ({
  id,
  type: "Song",
  attributes: { title: `Song ${id}`, author: "", hidden: false, ...attributes },
});

describe(cleanupCutoff, () => {
  it("moves back whole calendar months", () => {
    expect(cleanupCutoff(NOW, 12).toISOString()).toBe(
      "2025-09-25T18:00:00.000Z"
    );
  });

  it("clamps to the last day of a shorter month", () => {
    expect(
      cleanupCutoff(new Date("2026-05-31T12:00:00.000Z"), 3).toISOString()
    ).toBe("2026-02-28T12:00:00.000Z");
  });
});

describe(selectStaleSongs, () => {
  it("lists never-scheduled songs first, then the longest unused, skipping hidden and recent songs", () => {
    const cutoff = cleanupCutoff(NOW, 12);
    const { songs, scannedCount } = selectStaleSongs(
      [
        song("recent", { last_scheduled_at: "2026-08-01T00:00:00Z" }),
        song("old", { last_scheduled_at: "2024-01-07T00:00:00Z" }),
        song("older", { last_scheduled_at: "2021-03-14T00:00:00Z" }),
        song("hidden", {
          hidden: true,
          last_scheduled_at: "2019-01-01T00:00:00Z",
        }),
        song("never-old", {
          last_scheduled_at: null,
          created_at: "2020-01-01T00:00:00Z",
        }),
        song("never-new", {
          last_scheduled_at: null,
          created_at: "2026-09-01T00:00:00Z",
        }),
      ],
      cutoff
    );

    expect(songs.map((entry) => entry.id)).toStrictEqual([
      "never-old",
      "older",
      "old",
    ]);
    expect(scannedCount).toBe(5);
    expect(songs[0]?.lastScheduledAt).toBeNull();
    expect(songs[0]?.createdAt).toStrictEqual(new Date("2020-01-01T00:00:00Z"));
  });

  it("treats a song with no dates at all as stale", () => {
    const { songs } = selectStaleSongs(
      [song("unknown", {})],
      cleanupCutoff(NOW, 6)
    );
    expect(songs.map((entry) => entry.id)).toStrictEqual(["unknown"]);
  });
});

describe(getCleanupSongs, () => {
  it("reads the shared catalog and reports a full page limit as truncated", async () => {
    const catalog = Array.from({ length: 1500 }, (_, index) =>
      song(String(index), { last_scheduled_at: "2026-09-01T00:00:00Z" })
    );
    const getSongsCatalogCached = vi.fn<
      PlanningCenterSongsService["getSongsCatalogCached"]
    >(() => Effect.succeed(catalog));

    const result = await Effect.runPromise(
      getCleanupSongs(
        12,
        { cacheScope: "scope", songsService: { getSongsCatalogCached } },
        NOW
      )
    );

    expect(getSongsCatalogCached).toHaveBeenCalledWith("scope");
    expect(result.truncated).toBeTruthy();
    expect(result.scannedCount).toBe(1500);
    expect(result.songs).toStrictEqual([]);
    expect(result.cutoff).toBe("2025-09-25T18:00:00.000Z");
  });
});

const schedule = (status: string): PCResource => ({
  id: `schedule-${status}`,
  type: "Schedule",
  attributes: { status },
});

describe(getCleanupPeopleActivity, () => {
  it("counts schedules since the org-day cutoff, ignoring declined ones", async () => {
    const schedulesByPerson = new Map([
      ["active", [schedule("C"), schedule("U")]],
      ["declined", [schedule("D")]],
    ]);
    const getPersonSchedulesAfter = vi.fn<
      PlanningCenterPeopleService["getPersonSchedulesAfter"]
    >((personId) =>
      Effect.succeed({
        data: schedulesByPerson.get(personId) ?? [],
        included: [],
      })
    );

    const result = await Effect.runPromise(
      getCleanupPeopleActivity(
        { staleMonths: 6, personIds: ["active", "declined", "idle", "idle"] },
        {
          peopleService: { getPersonSchedulesAfter },
          resolveTimeZone: Effect.succeed("America/Los_Angeles"),
        },
        new Date("2026-09-25T03:00:00.000Z")
      )
    );

    expect(result.people).toStrictEqual([
      { id: "active", scheduleCount: 2 },
      { id: "declined", scheduleCount: 0 },
      { id: "idle", scheduleCount: 0 },
    ]);
    expect(result.deferredPersonIds).toStrictEqual([]);
    // 03:00 UTC on Mar 25 is still Mar 24 in Los Angeles.
    expect(getPersonSchedulesAfter).toHaveBeenCalledWith(
      "active",
      "2026-03-24",
      1
    );
  });
});
