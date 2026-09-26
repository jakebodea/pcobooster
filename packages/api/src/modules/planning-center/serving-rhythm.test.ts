import { buildServingRhythm } from "@pcobooster/api/modules/planning-center/serving-rhythm";
import type { RhythmSchedule } from "@pcobooster/api/modules/planning-center/serving-rhythm";
import { describe, expect, it } from "vitest";

const served = (
  sortDate: string,
  status = "C",
  serviceDates: string[] = [sortDate]
): RhythmSchedule => ({
  status,
  sortDate: new Date(sortDate),
  serviceDates: serviceDates.map((date) => new Date(date)),
});

describe(buildServingRhythm, () => {
  it("has no rhythm and no dates for someone who has not served", () => {
    expect(
      buildServingRhythm([], new Date("2026-09-25T18:00:00.000Z"), "UTC")
    ).toStrictEqual({
      lastServedOn: null,
      nextServingOn: null,
      servedDays30: 0,
      servedDays90: 0,
      servedDays180: 0,
      upcomingDays30: 0,
      typicalGapDays: null,
      requests180: 0,
      declined180: 0,
      pendingUpcoming: 0,
      nextPendingOn: null,
    });
  });

  it("counts distinct org days, so two services on one Sunday are one served day", () => {
    const rhythm = buildServingRhythm(
      [
        served("2026-09-06T16:00:00.000Z", "C", [
          "2026-09-06T16:00:00.000Z",
          "2026-09-06T18:00:00.000Z",
        ]),
        served("2026-09-13T16:00:00.000Z"),
        served("2026-09-20T16:00:00.000Z"),
      ],
      new Date("2026-09-25T18:00:00.000Z"),
      "UTC"
    );

    expect(rhythm).toMatchObject({
      lastServedOn: "2026-09-20",
      servedDays30: 3,
      typicalGapDays: 7,
    });
  });

  it("counts today's unanswered request as pending", () => {
    const rhythm = buildServingRhythm(
      [served("2026-09-25T23:00:00.000Z", "U")],
      new Date("2026-09-25T18:00:00.000Z"),
      "UTC"
    );

    expect(rhythm).toMatchObject({
      pendingUpcoming: 1,
      nextPendingOn: "2026-09-25",
    });
  });

  it("puts a late-evening service on the org day, not the UTC day", () => {
    // Sunday September 20, 7:00 PM Pacific; September 21 in UTC.
    const rhythm = buildServingRhythm(
      [served("2026-09-21T02:00:00.000Z")],
      new Date("2026-09-25T18:00:00.000Z"),
      "America/Los_Angeles"
    );

    expect(rhythm.lastServedOn).toBe("2026-09-20");
  });

  it("counts declines and upcoming unanswered requests without counting them as serving", () => {
    const rhythm = buildServingRhythm(
      [
        served("2026-08-02T16:00:00.000Z", "D"),
        served("2026-08-16T16:00:00.000Z", "Declined"),
        served("2026-09-13T16:00:00.000Z"),
        served("2026-10-11T16:00:00.000Z", "U"),
        served("2026-10-04T16:00:00.000Z", "U"),
        served("2026-11-29T16:00:00.000Z"),
        // Outside the 180-day window: neither a request nor a served day.
        served("2026-01-04T16:00:00.000Z", "D"),
      ],
      new Date("2026-09-25T18:00:00.000Z"),
      "UTC"
    );

    expect(rhythm).toMatchObject({
      lastServedOn: "2026-09-13",
      nextServingOn: "2026-10-04",
      servedDays180: 1,
      upcomingDays30: 2,
      typicalGapDays: null,
      requests180: 6,
      declined180: 2,
      pendingUpcoming: 2,
      nextPendingOn: "2026-10-04",
    });
  });
});
