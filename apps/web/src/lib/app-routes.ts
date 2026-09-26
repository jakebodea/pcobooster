import { notFound } from "@tanstack/react-router";

export type PlanView = "assign" | "lineup" | "plan" | "times";

export const planViews: readonly PlanView[] = [
  "assign",
  "lineup",
  "plan",
  "times",
];

const planViewLabels: Record<PlanView, string> = {
  assign: "Assign",
  lineup: "Lineup",
  plan: "Plan",
  times: "Times",
};

export const getPlanViewLabel = (view: PlanView): string =>
  planViewLabels[view];

export const isPlanView = (value: string): value is PlanView =>
  planViews.some((view) => view === value);

type AssertPlanView = (value: string) => asserts value is PlanView;

/** Unknown views render the not-found page, as the route never existed. */
export const assertPlanView: AssertPlanView = (value) => {
  if (!isPlanView(value)) {
    notFound({ throw: true });
  }
};

export interface PlanRoute {
  serviceTypeId: string;
  planId: string;
  view: PlanView;
}

const planRoutePattern =
  /^\/services\/(?<serviceTypeId>[^/]+)\/plans\/(?<planId>[^/]+)\/(?<view>[^/]+)$/u;

const decodeSegment = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

/** Reads a plan workspace path, such as a `planUrl` from the API, into route params. */
export const parsePlanRoute = (pathname: string): PlanRoute | null => {
  const match = planRoutePattern.exec(pathname);
  if (!match) {
    return null;
  }
  const [, encodedServiceTypeId, encodedPlanId, view] = match;
  const serviceTypeId = decodeSegment(encodedServiceTypeId);
  const planId = decodeSegment(encodedPlanId);
  if (serviceTypeId === null || planId === null || !isPlanView(view)) {
    return null;
  }
  return { serviceTypeId, planId, view };
};

export type AppSection = "services" | "people" | "songs";

export const getAppSection = (pathname: string): AppSection => {
  if (pathname.startsWith("/people")) {
    return "people";
  }
  if (pathname.startsWith("/songs")) {
    return "songs";
  }
  return "services";
};

const appSectionLabels: Record<AppSection, string> = {
  services: "Services",
  people: "People",
  songs: "Songs",
};

export const getAppSectionLabel = (section: AppSection): string =>
  appSectionLabels[section];

export interface DetailRoute {
  parentHref: "/people" | "/songs";
  parentLabel: string;
  label: string;
}

/** Detail pages that sit one level under a top-level section. */
export const parseDetailRoute = (pathname: string): DetailRoute | null => {
  if (/^\/people\/[^/]+/u.test(pathname)) {
    return { parentHref: "/people", parentLabel: "People", label: "Person" };
  }
  if (/^\/songs\/[^/]+/u.test(pathname)) {
    return { parentHref: "/songs", parentLabel: "Songs", label: "Chord chart" };
  }
  return null;
};
