import type {
  PeopleDashboardDayKind,
  PeopleDashboardPerson,
} from "@pcobooster/contracts/people-schemas";

import type { MonthGridDayTone } from "@/components/ui/month-grid-day";

export type CalendarCell =
  | { day: number; key: string }
  | { day: null; key: string };

export const monthDays = Array.from({ length: 31 }, (_, index) => index + 1);

const isConfirmedStatus = (status: string | undefined): boolean => {
  const raw = (status ?? "").trim();
  const normalized = raw.toLowerCase();
  return raw === "C" || normalized === "confirmed";
};

export const commitmentMarkerClass = (
  kind: PeopleDashboardDayKind,
  status?: string
): string => {
  if (kind === "service") {
    return isConfirmedStatus(status)
      ? "bg-status-confirmed-bright"
      : "bg-status-scheduled-bright";
  }
  if (kind === "rehearsal") {
    return "bg-muted-foreground/70";
  }
  if (kind === "blockout") {
    return "bg-destructive";
  }
  return "bg-border";
};

export const commitmentCellTone = (
  kind: PeopleDashboardPerson["monthDays"][number]["kind"],
  status?: string
): MonthGridDayTone => {
  if (kind === "service") {
    return isConfirmedStatus(status) ? "confirmed" : "scheduled";
  }
  if (kind === "rehearsal") {
    return "rehearsal";
  }
  return "light";
};

export const engagementLabel = (
  kind: PeopleDashboardDayKind,
  status?: string
): string => {
  if (kind === "service") {
    return isConfirmedStatus(status)
      ? "Confirmed service"
      : "Potential service";
  }
  if (kind === "rehearsal") {
    return "Rehearsal";
  }
  if (kind === "blockout") {
    return "Blockout";
  }
  return "Open";
};

export const pickCalendarMarker = (
  entries: PeopleDashboardPerson["monthDays"]
) =>
  entries.find(
    (entry) => entry.kind === "service" && isConfirmedStatus(entry.status)
  ) ??
  entries.find((entry) => entry.kind === "service") ??
  entries.at(0) ??
  null;

export const buildCalendarCells = (
  startsOnWeekday: number,
  daysInMonth: number
): CalendarCell[] => {
  const blanks: CalendarCell[] = Array.from(
    { length: startsOnWeekday },
    (_, index) => ({
      day: null,
      key: `blank-start-${index}`,
    })
  );
  const days: CalendarCell[] = Array.from(
    { length: daysInMonth },
    (_, index) => ({
      day: index + 1,
      key: `day-${index + 1}`,
    })
  );
  return [...blanks, ...days];
};

/** Heatmap tone for a day; rehearsal-only days read as lightly busy. */
export const heatLevelTone = (
  serviceCount: number,
  rehearsalCount = 0
): MonthGridDayTone => {
  if (serviceCount >= 8) {
    return "peak";
  }
  if (serviceCount >= 3) {
    return "busy";
  }
  if (serviceCount > 0 || rehearsalCount > 0) {
    return "light";
  }
  return "empty";
};
