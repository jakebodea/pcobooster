export type PeopleDashboardLoad = "low" | "normal" | "high" | "rest";

export type PeopleDashboardDayKind =
  | "service"
  | "rehearsal"
  | "blockout"
  | "rest";

export interface PeopleDashboardMonth {
  year: number;
  monthIndex: number;
  label: string;
  daysInMonth: number;
  startsOnWeekday: number;
}

export interface PeopleDashboardRosterPerson {
  id: string;
  name: string;
  initials: string;
  photoThumbnailUrl: string | null;
  teams: string[];
}

/** How a person has been serving and responding; days are org `YYYY-MM-DD`. */
export interface ServingRhythm {
  lastServedOn: string | null;
  nextServingOn: string | null;
  servedDays30: number;
  servedDays90: number;
  servedDays180: number;
  upcomingDays30: number;
  /** Median days between served days in the last 180; null with too few. */
  typicalGapDays: number | null;
  /** Schedules dated in the last 180 days or later, declined included. */
  requests180: number;
  declined180: number;
  /** Upcoming schedules still unconfirmed. */
  pendingUpcoming: number;
  nextPendingOn: string | null;
}

export interface PeopleDashboardActivity {
  id: string;
  rhythm: ServingRhythm;
  roles: string;
  status: string;
  load: PeopleDashboardLoad;
  lastServed: string;
  lastRehearsal?: string;
  nextScheduled: string;
  nextRehearsal?: string;
  monthCount: number;
  thirtyDayCount: number;
  ninetyDayCount: number;
  upcomingCount: number;
  streak: string;
  highlight: string;
  monthDays: {
    day: number;
    kind: PeopleDashboardDayKind;
    positionName?: string;
    serviceTypeName?: string;
    status?: string;
    planUrl?: string;
  }[];
}

export type PeopleDashboardPerson = PeopleDashboardRosterPerson &
  Omit<PeopleDashboardActivity, "id" | "rhythm">;

export interface PeopleDashboardTeam {
  id: string;
  name: string;
  serviceTypeName: string | null;
  personIds: string[];
}

export interface PeopleDashboardRoster {
  generatedAt: string;
  month: PeopleDashboardMonth;
  people: PeopleDashboardRosterPerson[];
  teams: PeopleDashboardTeam[];
  /** Teams the signed-in person leads; empty when they lead none or are unknown. */
  ledTeamIds: string[];
}

export interface PeopleDashboardActivityBatch {
  generatedAt: string;
  people: PeopleDashboardActivity[];
  deferredPersonIds: string[];
  requestBudget: {
    limit: number;
    planningCenterRequests: number;
    scheduleRequests: number;
    planTimeRequests: number;
  };
}

export interface PeopleDashboardPersonDetail {
  generatedAt: string;
  month: PeopleDashboardMonth;
  previousMonth: string;
  nextMonth: string;
  person: PeopleDashboardPerson;
  trend: {
    month: string;
    label: string;
    services: number;
    rehearsals: number;
  }[];
  requestBudget: {
    limit: number;
    /** Planning Center requests the procedure sent; cached reads cost none. */
    planningCenterRequests: number;
    /**
     * Rehearsal (and other) times the budget left unread; their assignments show on their
     * plan's date. Zero when the detail is complete.
     */
    unresolvedRehearsalTimes: number;
  };
}
