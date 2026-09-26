import type { ServingRhythm } from "@pcobooster/contracts/people-schemas";
import { describe, expect, it } from "vitest";

import {
  checkInReasons,
  computeTeamHealth,
  describeCadence,
  describeCheckInReason,
  dueThresholdDays,
  heavyThirtyDayLoad,
} from "@/lib/team-health";
import type { TeamMember } from "@/lib/team-health";

const TODAY = "2026-09-25";

const rhythm = (overrides: Partial<ServingRhythm> = {}): ServingRhythm => ({
  lastServedOn: "2026-09-20",
  nextServingOn: "2026-10-11",
  servedDays30: 1,
  servedDays90: 4,
  servedDays180: 8,
  upcomingDays30: 1,
  typicalGapDays: 21,
  requests180: 9,
  declined180: 0,
  pendingUpcoming: 0,
  nextPendingOn: null,
  ...overrides,
});

const member = (
  name: string,
  overrides: Partial<ServingRhythm> = {}
): TeamMember => ({
  id: name.toLowerCase(),
  name,
  initials: name.slice(0, 2).toUpperCase(),
  photoThumbnailUrl: null,
  teams: ["Band"],
  roles: "Vocals",
  status: "Upcoming",
  load: "normal",
  lastServed: "Sep 20",
  nextScheduled: "Oct 11",
  monthCount: 1,
  thirtyDayCount: 1,
  ninetyDayCount: 4,
  upcomingCount: 1,
  streak: "1 in 30 days",
  highlight: "",
  monthDays: [],
  rhythm: rhythm(overrides),
});

describe(dueThresholdDays, () => {
  it("scales with the person's own rhythm but never drops below six weeks", () => {
    expect(dueThresholdDays(null)).toBe(42);
    expect(dueThresholdDays(7)).toBe(42);
    expect(dueThresholdDays(42)).toBe(63);
  });
});

describe(checkInReasons, () => {
  it("has nothing to say about a steady server", () => {
    expect(checkInReasons(rhythm(), TODAY, 4)).toStrictEqual([]);
  });

  it("flags a regular who stopped serving, relative to their usual gap", () => {
    const monthly = rhythm({
      lastServedOn: "2026-08-02",
      nextServingOn: null,
      typicalGapDays: 28,
      servedDays180: 5,
    });

    // 54 days is still inside the eight-week floor.
    expect(checkInReasons(monthly, TODAY, null)).toStrictEqual([]);
    expect(
      checkInReasons({ ...monthly, lastServedOn: "2026-07-25" }, TODAY, null)
    ).toStrictEqual([
      { kind: "drifting", lastServedOn: "2026-07-25", typicalGapDays: 28 },
    ]);
  });

  it("does not call someone drifting when they are already scheduled", () => {
    expect(
      checkInReasons(
        rhythm({ lastServedOn: "2026-05-03", servedDays180: 5 }),
        TODAY,
        null
      )
    ).toStrictEqual([]);
  });

  it("flags unanswered requests that are close or piling up", () => {
    expect(
      checkInReasons(
        rhythm({ pendingUpcoming: 1, nextPendingOn: "2026-10-01" }),
        TODAY,
        null
      )
    ).toStrictEqual([
      { kind: "unanswered", pending: 1, nextPendingOn: "2026-10-01" },
    ]);
    expect(
      checkInReasons(
        rhythm({ pendingUpcoming: 1, nextPendingOn: "2026-10-25" }),
        TODAY,
        null
      )
    ).toStrictEqual([]);
  });

  it("flags a pattern of declines, not a single one", () => {
    expect(
      checkInReasons(rhythm({ declined180: 1, requests180: 2 }), TODAY, null)
    ).toStrictEqual([]);
    expect(
      checkInReasons(rhythm({ declined180: 3, requests180: 6 }), TODAY, null)
    ).toStrictEqual([{ kind: "declining", declined: 3, requests: 6 }]);
  });

  it("scales the heavy 30-day load with the team's pace, between weekly and weekly-plus", () => {
    expect(heavyThirtyDayLoad(null)).toBe(4);
    expect(heavyThirtyDayLoad(3)).toBe(4);
    expect(heavyThirtyDayLoad(7)).toBe(5);
    expect(heavyThirtyDayLoad(12)).toBe(6);
    // A weekly team does not flag a weekly server.
    expect(
      checkInReasons(rhythm({ servedDays30: 5 }), TODAY, 12)
    ).toStrictEqual([]);
  });

  it("flags heavy recent serving and serving at twice the team's pace", () => {
    expect(
      checkInReasons(rhythm({ servedDays30: 4 }), TODAY, null)
    ).toStrictEqual([
      { kind: "overloaded", basis: "recent", days: 4, teamPace: null },
    ]);
    expect(checkInReasons(rhythm({ servedDays90: 9 }), TODAY, 4)).toStrictEqual(
      [{ kind: "overloaded", basis: "team-pace", days: 9, teamPace: 4 }]
    );
    expect(checkInReasons(rhythm({ servedDays90: 9 }), TODAY, 5)).toStrictEqual(
      []
    );
  });

  it("flags team members with no serving at all", () => {
    expect(
      checkInReasons(
        rhythm({
          lastServedOn: null,
          nextServingOn: null,
          servedDays30: 0,
          servedDays90: 0,
          servedDays180: 0,
          upcomingDays30: 0,
          typicalGapDays: null,
          requests180: 0,
        }),
        TODAY,
        null
      )
    ).toStrictEqual([{ kind: "not-serving" }]);
  });
});

describe(computeTeamHealth, () => {
  it("lists who is due for a slot, most overdue for their rhythm first", () => {
    const health = computeTeamHealth(
      [
        member("Scheduled"),
        member("Recent", { lastServedOn: "2026-09-06", nextServingOn: null }),
        member("Weekly", {
          lastServedOn: "2026-08-02",
          nextServingOn: null,
          typicalGapDays: 7,
        }),
        member("Monthly", {
          lastServedOn: "2026-08-09",
          nextServingOn: null,
          typicalGapDays: 30,
        }),
        member("Never", {
          lastServedOn: null,
          nextServingOn: null,
          servedDays180: 0,
          servedDays90: 0,
        }),
      ],
      TODAY
    );

    expect(
      health.dueForSlot.map(({ member: { name }, daysSinceServed }) => [
        name,
        daysSinceServed,
      ])
    ).toStrictEqual([
      ["Weekly", 54],
      ["Monthly", 47],
      ["Never", null],
    ]);
  });

  it("calls a team stretched when a few people carry most of the serving", () => {
    const quiet = { servedDays90: 1, servedDays30: 0 };
    const health = computeTeamHealth(
      [
        member("Ana", { servedDays90: 12, servedDays30: 3 }),
        member("Ben", quiet),
        member("Cam", quiet),
        member("Dee", quiet),
        member("Eve", quiet),
      ],
      TODAY
    );

    expect(health).toMatchObject({
      memberCount: 5,
      activeCount: 5,
      topShare: 0.75,
      teamPace: 1,
      status: "stretched",
    });
    expect(health.checkIns.map(({ member: { name } }) => name)).toStrictEqual([
      "Ana",
    ]);
  });

  it("calls a team thin when fewer than half served in 90 days", () => {
    const idle = { servedDays90: 0, servedDays30: 0 };
    const health = computeTeamHealth(
      [member("Ana"), member("Ben", idle), member("Cam", idle)],
      TODAY
    );

    expect(health.status).toBe("thin");
  });
});

describe(describeCheckInReason, () => {
  it("writes reasons a leader can act on", () => {
    expect(
      describeCheckInReason({
        kind: "drifting",
        lastServedOn: "2026-07-12",
        typicalGapDays: 14,
      })
    ).toStrictEqual({
      label: "Drifting",
      detail: "Last served Jul 12, usually every 2 weeks; nothing scheduled.",
    });
    expect(describeCadence(29)).toBe("about monthly");
  });
});
