import { z } from "zod";

export const blockoutSchema = z.object({
  id: z.string(),
  reason: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  description: z.string(),
  share: z.boolean(),
  timeZone: z.string().nullable().optional(),
});

export const scheduleFrequencySchema = z.object({
  recentServedDays: z.number(),
  last60Days: z.number(),
  last90Days: z.number(),
  lastServedDate: z.date().optional(),
  totalServed: z.number(),
  recentRehearsalOnlyDays: z.number(),
  rehearsalLast60Days: z.number(),
  rehearsalLast90Days: z.number(),
  lastRehearsalDate: z.date().optional(),
  totalRehearsals: z.number(),
  upcomingServices: z.number(),
  nextUpcomingDate: z.date().optional(),
  upcomingRehearsals: z.number(),
  nextRehearsalDate: z.date().optional(),
});

export const serviceHistoryItemSchema = z.object({
  id: z.string(),
  sourceScheduleId: z.string(),
  date: z.date(),
  teamPositionName: z.string(),
  teamName: z.string().optional(),
  serviceTypeName: z.string().optional(),
  planTitle: z.string().optional(),
  status: z.string(),
  timeType: z.enum(["service", "rehearsal", "other"]).optional(),
});

/** The selected plan and slot candidates are matched against. */
export const selectedPlanMatchSchema = z.object({
  planId: z.string().optional(),
  teamId: z.string().optional(),
  selectedPositionName: z.string().optional(),
  selectedTeamName: z.string().optional(),
});

export const selectedPlanSlotSchema = z.object({
  planPersonId: z.string(),
  status: z.enum(["confirmed", "pending", "declined"]),
  declineReason: z.string().nullable(),
});

/** A candidate with the selected plan's fresh roster applied; no history or availability. */
export const positionCandidateSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  photoUrl: z.string().nullable(),
  photoThumbnailUrl: z.string().nullable(),
  archived: z.boolean(),
  selectedPlanRosterLabels: z.array(z.string()),
  selectedPlanSlot: selectedPlanSlotSchema.nullable(),
});

export const positionCandidatesSchema = z.object({
  generatedAt: z.string(),
  timeZone: z.string(),
  match: selectedPlanMatchSchema,
  candidates: z.array(positionCandidateSchema),
});

/** One of a person's selected-plan assignments as history saw it. */
export const selectedPlanAssignmentSchema = z.object({
  source: z.enum(["planPerson", "schedule"]),
  id: z.string(),
  planId: z.string().nullable(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  teamPositionName: z.string(),
  status: z.string(),
  planPersonId: z.string().nullable(),
  declineReason: z.string().nullable(),
});

export const candidateHistorySchema = z.object({
  /** Unsorted; the browser sorts, summarizes, and trims them. */
  serviceHistory: z.array(serviceHistoryItemSchema),
  selectedPlanAssignments: z.array(selectedPlanAssignmentSchema),
});

export const windowPlanRefSchema = z.object({
  serviceTypeId: z.string().trim().min(1),
  planId: z.string().trim().min(1),
  /** Roster pages the plan needs; a follow-up call reserves them before locating plans. */
  rosterRequests: z.number().int().min(0).max(100),
});

export const windowPlanSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  sortDate: z.string().nullable(),
  serviceTypeName: z.string().nullable(),
});

export const windowPlanTimeSchema = z.object({
  id: z.string(),
  startsAt: z.string().nullable(),
  timeType: z.string().nullable(),
});

export const windowRosterRowSchema = z.object({
  id: z.string(),
  planId: z.string().nullable(),
  teamId: z.string().nullable(),
  teamPositionName: z.string(),
  status: z.string(),
  createdAt: z.string(),
  timeIds: z.array(z.string()),
  serviceTimeIds: z.array(z.string()),
  declineReason: z.string().nullable(),
});

export const planWindowHistoryBatchSchema = z.object({
  generatedAt: z.string(),
  /** Rosters read by this call, including plans with no one scheduled. */
  loadedPlanCount: z.number(),
  /** Plans and times the rows point at; the browser expands rows into history items. */
  plans: z.array(windowPlanSummarySchema),
  planTimes: z.array(windowPlanTimeSchema),
  people: z.array(
    z.object({ personId: z.string(), rows: z.array(windowRosterRowSchema) })
  ),
  /** Listed plans left for a follow-up call, in window order. */
  deferredPlans: z.array(windowPlanRefSchema),
  /** Service types not listed yet; their plans follow `deferredPlans`. */
  deferredServiceTypeIds: z.array(z.string()),
  requestBudget: z.object({
    limit: z.number(),
    /** Planning Center requests the call sent; cached reads cost none. */
    planningCenterRequests: z.number(),
    planRangeRequests: z.number(),
    rosterRequests: z.number(),
  }),
});

export const candidateDetailSchema = z.object({
  personId: z.string(),
  isBlockedForDate: z.boolean(),
  /** The person's own schedule history, only when it was asked for. */
  history: candidateHistorySchema.optional(),
});

/** Blockout checks a previous call already did for a person it left unfinished. */
export const blockoutProgressSchema = z.object({
  personId: z.string().trim().min(1),
  /** Repeating blockouts read and found not to cover the plan day. */
  checkedBlockoutIds: z.array(z.string().trim().min(1)).max(1000),
  /** A blockout was found to cover the plan day. */
  blocked: z.boolean(),
});

export const candidateDetailsBatchSchema = z.object({
  generatedAt: z.string(),
  people: z.array(candidateDetailSchema),
  /** Requested people left for a follow-up call to stay within the budget. */
  deferredPersonIds: z.array(z.string()),
  /** Pass back with `deferredPersonIds`; the next call skips checks already done. */
  blockoutProgress: z.array(blockoutProgressSchema),
  requestBudget: z.object({
    limit: z.number(),
    /** Planning Center requests the call sent; cached reads cost none. */
    planningCenterRequests: z.number(),
    /** Blockout lists and schedule pages. */
    firstReadRequests: z.number(),
    blockoutDateRequests: z.number(),
    planTimeRequests: z.number(),
  }),
});

export const peopleDashboardLoadSchema = z.enum([
  "low",
  "high",
  "normal",
  "rest",
]);

export const peopleDashboardDayKindSchema = z.enum([
  "service",
  "rehearsal",
  "rest",
  "blockout",
]);

export const peopleDashboardMonthSchema = z.object({
  year: z.number(),
  monthIndex: z.number(),
  label: z.string(),
  daysInMonth: z.number(),
  startsOnWeekday: z.number(),
});

/** Who is on the roster: identity and teams, with no schedule reads behind it. */
export const peopleDashboardRosterPersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  photoThumbnailUrl: z.string().nullable(),
  teams: z.array(z.string()),
});

const calendarDayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

/** How a person has been serving and responding; days are org `YYYY-MM-DD`. */
export const servingRhythmSchema = z.object({
  lastServedOn: calendarDayKeySchema.nullable(),
  nextServingOn: calendarDayKeySchema.nullable(),
  servedDays30: z.number(),
  servedDays90: z.number(),
  servedDays180: z.number(),
  upcomingDays30: z.number(),
  /** Median days between served days in the last 180; null with too few. */
  typicalGapDays: z.number().nullable(),
  /** Schedules dated in the last 180 days or later, declined included. */
  requests180: z.number(),
  declined180: z.number(),
  /** Upcoming schedules still unconfirmed. */
  pendingUpcoming: z.number(),
  nextPendingOn: calendarDayKeySchema.nullable(),
});

/** How one roster person is serving, derived from their own schedules. */
export const peopleDashboardActivitySchema = z.object({
  id: z.string(),
  rhythm: servingRhythmSchema,
  roles: z.string(),
  status: z.string(),
  load: peopleDashboardLoadSchema,
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
  monthDays: z.array(
    z.object({
      day: z.number(),
      kind: peopleDashboardDayKindSchema,
      positionName: z.string().optional(),
      serviceTypeName: z.string().optional(),
      status: z.string().optional(),
      planUrl: z.string().optional(),
    })
  ),
});

export const peopleDashboardPersonSchema =
  peopleDashboardRosterPersonSchema.extend(
    peopleDashboardActivitySchema.omit({ id: true, rhythm: true }).shape
  );

export const peopleDashboardTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The team's service type, to tell same-named teams apart. */
  serviceTypeName: z.string().nullable(),
  personIds: z.array(z.string()),
});

export const peopleDashboardRosterSchema = z.object({
  generatedAt: z.string(),
  month: peopleDashboardMonthSchema,
  /** Sorted by last name, then first name. */
  people: z.array(peopleDashboardRosterPersonSchema),
  teams: z.array(peopleDashboardTeamSchema),
  /** Teams the signed-in person leads; empty when they lead none or are unknown. */
  ledTeamIds: z.array(z.string()),
});

export const peopleDashboardActivityBatchSchema = z.object({
  generatedAt: z.string(),
  people: z.array(peopleDashboardActivitySchema),
  /**
   * Requested people this call left for a follow-up call to stay within its
   * Planning Center request budget. Empty when the batch is complete.
   */
  deferredPersonIds: z.array(z.string()),
  requestBudget: z.object({
    limit: z.number(),
    /** Planning Center requests the call sent; cached reads cost none. */
    planningCenterRequests: z.number(),
    scheduleRequests: z.number(),
    planTimeRequests: z.number(),
  }),
});

export const peopleDashboardPersonDetailSchema = z.object({
  generatedAt: z.string(),
  month: peopleDashboardMonthSchema,
  previousMonth: z.string(),
  nextMonth: z.string(),
  person: peopleDashboardPersonSchema,
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
    /** Planning Center requests the call sent; cached reads cost none. */
    planningCenterRequests: z.number(),
    /**
     * Rehearsal (and other) times the budget left unread; their assignments show on their
     * plan's date. Zero when the detail is complete.
     */
    unresolvedRehearsalTimes: z.number(),
  }),
});

export const peopleSearchResultSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  photoThumbnailUrl: z.string().nullable(),
});

export const myScheduledPlansDataSchema = z.object({
  planIds: z.array(z.string()),
});

export type Blockout = z.output<typeof blockoutSchema>;
export type ScheduleFrequency = z.output<typeof scheduleFrequencySchema>;
export type ServiceHistoryItem = z.output<typeof serviceHistoryItemSchema>;
export type PositionCandidates = z.output<typeof positionCandidatesSchema>;
export type PlanWindowHistoryBatch = z.output<
  typeof planWindowHistoryBatchSchema
>;
export type CandidateDetailsBatch = z.output<
  typeof candidateDetailsBatchSchema
>;
export type PeopleDashboardLoad = z.output<typeof peopleDashboardLoadSchema>;
export type PeopleDashboardDayKind = z.output<
  typeof peopleDashboardDayKindSchema
>;
export type PeopleDashboardMonth = z.output<typeof peopleDashboardMonthSchema>;
export type PeopleDashboardRosterPerson = z.output<
  typeof peopleDashboardRosterPersonSchema
>;
export type ServingRhythm = z.output<typeof servingRhythmSchema>;
export type PeopleDashboardTeam = z.output<typeof peopleDashboardTeamSchema>;
export type PeopleDashboardActivity = z.output<
  typeof peopleDashboardActivitySchema
>;
export type PeopleDashboardPerson = z.output<
  typeof peopleDashboardPersonSchema
>;
export type PeopleDashboardRoster = z.output<
  typeof peopleDashboardRosterSchema
>;
export type PeopleDashboardActivityBatch = z.output<
  typeof peopleDashboardActivityBatchSchema
>;
export type PeopleDashboardPersonDetail = z.output<
  typeof peopleDashboardPersonDetailSchema
>;
export type PeopleSearchResult = z.output<typeof peopleSearchResultSchema>;
export type MyScheduledPlansData = z.output<typeof myScheduledPlansDataSchema>;
