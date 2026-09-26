import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import {
  assertPlanView,
  getAppSection,
  parseDetailRoute,
  parsePlanRoute,
} from "@/lib/app-routes";

describe(parsePlanRoute, () => {
  it("reads the plan workspace path", () => {
    expect(parsePlanRoute("/services/12/plans/34/lineup")).toStrictEqual({
      serviceTypeId: "12",
      planId: "34",
      view: "lineup",
    });
  });

  it("decodes path segments into route params", () => {
    expect(parsePlanRoute("/services/a%2Fb/plans/34/assign")).toStrictEqual({
      serviceTypeId: "a/b",
      planId: "34",
      view: "assign",
    });
    expect(parsePlanRoute("/services/%E0%A4%A/plans/34/assign")).toBeNull();
  });

  it("rejects unknown views and other routes", () => {
    expect(parsePlanRoute("/services/12/plans/34/unknown")).toBeNull();
    expect(parsePlanRoute("/services")).toBeNull();
    expect(parsePlanRoute("/services/12/plans/34")).toBeNull();
  });
});

describe(assertPlanView, () => {
  it("accepts every plan view", () => {
    for (const view of ["assign", "lineup", "plan", "times"]) {
      expect(() => {
        assertPlanView(view);
      }).not.toThrow();
    }
  });

  it("renders not-found for unknown views", () => {
    expect(() => {
      assertPlanView("unknown");
    }).toThrow(expect.toSatisfy(isNotFound));
  });
});

describe("app sections", () => {
  it("maps paths to their top-level section", () => {
    expect(getAppSection("/people")).toBe("people");
    expect(getAppSection("/songs/12")).toBe("songs");
    expect(getAppSection("/services/1/plans/2/assign")).toBe("services");
  });

  it("describes detail routes with their parent", () => {
    expect(parseDetailRoute("/people/99")).toStrictEqual({
      parentHref: "/people",
      parentLabel: "People",
      label: "Person",
    });
    expect(parseDetailRoute("/people")).toBeNull();
    expect(parseDetailRoute("/songs/12")).toStrictEqual({
      parentHref: "/songs",
      parentLabel: "Songs",
      label: "Chord chart",
    });
    expect(parseDetailRoute("/songs")).toBeNull();
  });
});
