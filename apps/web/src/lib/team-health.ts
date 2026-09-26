import type {
  PeopleDashboardPerson,
  ServingRhythm,
} from "@pcobooster/contracts/people-schemas";
import {
  formatCalendarDateLabel,
  orgCalendarDaysRefMinusItem,
} from "@pcobooster/planning-center-models/calendar";

/** A roster person with their loaded serving rhythm. */
export type TeamMember = PeopleDashboardPerson & { rhythm: ServingRhythm };

/** Nobody is "due" sooner than this, however often they usually serve. */
export const DUE_FLOOR_DAYS = 42;
/** A regular server counts as drifting only after this long, and twice their usual gap. */
const DRIFT_FLOOR_DAYS = 56;
const DUE_GAP_MULTIPLIER = 1.5;
const DRIFT_GAP_MULTIPLIER = 2;
/** Served days in the last 180 that make someone a regular. */
const REGULAR_SERVED_DAYS = 3;
const DECLINE_MIN_COUNT = 2;
const DECLINE_MIN_RATE = 0.4;
/** An unanswered request this close needs a nudge now. */
const PENDING_SOON_DAYS = 7;
const PENDING_BACKLOG = 3;
/**
 * Serving days in 30 that count as heavy: twice the team's own 30-day pace,
 * but never below weekly (4) and always past weekly with extras (6), so a
 * team that serves every week is not flagged for serving every week.
 */
const HEAVY_30_MIN_DAYS = 4;
const HEAVY_30_MAX_DAYS = 6;
const DAYS_90_PER_30 = 3;
const OVERLOAD_MIN_DAYS_90 = 6;
const OVERLOAD_TEAM_MULTIPLIER = 2;
/** Team comparisons need a few active people to mean anything. */
const MIN_ACTIVE_FOR_TEAM_PACE = 3;
const TOP_SHARE_FRACTION = 0.2;
const MIN_MEMBERS_FOR_HEALTH = 3;
const STRETCHED_TOP_SHARE = 0.6;
const STRETCHED_MIN_SERVED_DAYS = 10;
const THIN_ACTIVE_RATE = 0.5;

export type CheckInReason =
  | { kind: "unanswered"; pending: number; nextPendingOn: string | null }
  | { kind: "declining"; declined: number; requests: number }
  | {
      kind: "drifting";
      lastServedOn: string;
      typicalGapDays: number | null;
    }
  | {
      kind: "overloaded";
      basis: "recent" | "upcoming" | "team-pace";
      days: number;
      teamPace: number | null;
    }
  | { kind: "not-serving" };

export interface CheckIn {
  member: TeamMember;
  reasons: CheckInReason[];
}

export interface DueForSlot {
  member: TeamMember;
  /** Days since they last served; null when they have not served in 180 days. */
  daysSinceServed: number | null;
  typicalGapDays: number | null;
}

export type TeamHealthStatus = "steady" | "stretched" | "thin";

export interface TeamHealth {
  memberCount: number;
  /** Served at least once in the last 90 days. */
  activeCount: number;
  /** Serving at least once in the next 30 days. */
  scheduledAheadCount: number;
  declined: number;
  requests: number;
  pendingCount: number;
  /** The busiest fifth of the team, at least one person. */
  topCount: number;
  /** Share of 90-day serving days the busiest `topCount` covered; null without serving. */
  topShare: number | null;
  /** Median 90-day serving days among active people; null with too few. */
  teamPace: number | null;
  /** Null for teams too small to judge. */
  status: TeamHealthStatus | null;
  checkIns: CheckIn[];
  dueForSlot: DueForSlot[];
}

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const daysSince = (dayKey: string | null, todayKey: string) =>
  dayKey === null ? null : orgCalendarDaysRefMinusItem(dayKey, todayKey);

/** Days without serving after which someone is due for a slot. */
export const dueThresholdDays = (typicalGapDays: number | null) =>
  typicalGapDays === null
    ? DUE_FLOOR_DAYS
    : Math.max(DUE_FLOOR_DAYS, Math.round(typicalGapDays * DUE_GAP_MULTIPLIER));

const driftThresholdDays = (typicalGapDays: number | null) =>
  typicalGapDays === null
    ? DRIFT_FLOOR_DAYS
    : Math.max(
        DRIFT_FLOOR_DAYS,
        Math.round(typicalGapDays * DRIFT_GAP_MULTIPLIER)
      );

/** The team's usual pace: the median of active people's 90-day serving days. */
export const computeTeamPace = (members: readonly TeamMember[]) => {
  const active = members.flatMap(({ rhythm: { servedDays90 } }) =>
    servedDays90 > 0 ? [servedDays90] : []
  );
  return active.length >= MIN_ACTIVE_FOR_TEAM_PACE ? median(active) : null;
};

/** Serving days in 30 that count as a heavy load for this team. */
export const heavyThirtyDayLoad = (teamPace: number | null) =>
  teamPace === null
    ? HEAVY_30_MIN_DAYS
    : Math.min(
        HEAVY_30_MAX_DAYS,
        Math.max(
          HEAVY_30_MIN_DAYS,
          Math.ceil((teamPace / DAYS_90_PER_30) * OVERLOAD_TEAM_MULTIPLIER)
        )
      );

const overloadReason = (
  rhythm: ServingRhythm,
  teamPace: number | null
): CheckInReason | null => {
  const heavy = heavyThirtyDayLoad(teamPace);
  if (rhythm.servedDays30 >= heavy) {
    return {
      kind: "overloaded",
      basis: "recent",
      days: rhythm.servedDays30,
      teamPace,
    };
  }
  if (rhythm.upcomingDays30 >= heavy) {
    return {
      kind: "overloaded",
      basis: "upcoming",
      days: rhythm.upcomingDays30,
      teamPace,
    };
  }
  if (
    teamPace !== null &&
    rhythm.servedDays90 >= OVERLOAD_MIN_DAYS_90 &&
    rhythm.servedDays90 >= teamPace * OVERLOAD_TEAM_MULTIPLIER
  ) {
    return {
      kind: "overloaded",
      basis: "team-pace",
      days: rhythm.servedDays90,
      teamPace,
    };
  }
  return null;
};

/** Why a leader might reach out to this person, most pressing first. */
export const checkInReasons = (
  rhythm: ServingRhythm,
  todayKey: string,
  teamPace: number | null
): CheckInReason[] => {
  const reasons: CheckInReason[] = [];
  const daysToPending = daysSince(rhythm.nextPendingOn, todayKey);
  const pendingSoon =
    daysToPending !== null && -daysToPending <= PENDING_SOON_DAYS;
  if (
    rhythm.pendingUpcoming > 0 &&
    (pendingSoon || rhythm.pendingUpcoming >= PENDING_BACKLOG)
  ) {
    reasons.push({
      kind: "unanswered",
      pending: rhythm.pendingUpcoming,
      nextPendingOn: rhythm.nextPendingOn,
    });
  }
  if (
    rhythm.declined180 >= DECLINE_MIN_COUNT &&
    rhythm.declined180 / Math.max(rhythm.requests180, 1) >= DECLINE_MIN_RATE
  ) {
    reasons.push({
      kind: "declining",
      declined: rhythm.declined180,
      requests: rhythm.requests180,
    });
  }
  const sinceServed = daysSince(rhythm.lastServedOn, todayKey);
  if (
    rhythm.lastServedOn !== null &&
    sinceServed !== null &&
    rhythm.nextServingOn === null &&
    rhythm.servedDays180 >= REGULAR_SERVED_DAYS &&
    sinceServed >= driftThresholdDays(rhythm.typicalGapDays)
  ) {
    reasons.push({
      kind: "drifting",
      lastServedOn: rhythm.lastServedOn,
      typicalGapDays: rhythm.typicalGapDays,
    });
  }
  const overloaded = overloadReason(rhythm, teamPace);
  if (overloaded) {
    reasons.push(overloaded);
  }
  if (
    rhythm.servedDays180 === 0 &&
    rhythm.nextServingOn === null &&
    rhythm.declined180 === 0
  ) {
    reasons.push({ kind: "not-serving" });
  }
  return reasons;
};

const reasonWeight = (reason: CheckInReason) => {
  if (reason.kind === "unanswered") {
    return 4;
  }
  if (reason.kind === "not-serving") {
    return 1;
  }
  return 3;
};

const checkInWeight = (checkIn: CheckIn) =>
  checkIn.reasons.reduce((total, reason) => total + reasonWeight(reason), 0);

const isDue = (rhythm: ServingRhythm, todayKey: string) => {
  if (rhythm.nextServingOn !== null) {
    return false;
  }
  const sinceServed = daysSince(rhythm.lastServedOn, todayKey);
  return (
    sinceServed === null ||
    sinceServed >= dueThresholdDays(rhythm.typicalGapDays)
  );
};

/** Longest overdue relative to their own rhythm first; people with no recent serving last. */
const compareDue = (a: DueForSlot, b: DueForSlot) => {
  if (a.daysSinceServed === null || b.daysSinceServed === null) {
    if (a.daysSinceServed !== b.daysSinceServed) {
      return a.daysSinceServed === null ? 1 : -1;
    }
    return a.member.name.localeCompare(b.member.name);
  }
  return (
    b.daysSinceServed / dueThresholdDays(b.typicalGapDays) -
    a.daysSinceServed / dueThresholdDays(a.typicalGapDays)
  );
};

const topServingShare = (members: readonly TeamMember[], topCount: number) => {
  const days = members
    .map((member) => member.rhythm.servedDays90)
    .toSorted((a, b) => b - a);
  const total = days.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return null;
  }
  const top = days.slice(0, topCount).reduce((sum, value) => sum + value, 0);
  return top / total;
};

const healthStatus = ({
  memberCount,
  activeCount,
  topShare,
  servedDays,
}: {
  memberCount: number;
  activeCount: number;
  topShare: number | null;
  servedDays: number;
}): TeamHealthStatus | null => {
  if (memberCount < MIN_MEMBERS_FOR_HEALTH) {
    return null;
  }
  if (activeCount / memberCount < THIN_ACTIVE_RATE) {
    return "thin";
  }
  if (
    topShare !== null &&
    topShare >= STRETCHED_TOP_SHARE &&
    servedDays >= STRETCHED_MIN_SERVED_DAYS
  ) {
    return "stretched";
  }
  return "steady";
};

/** Team health for the loaded members, on the org calendar day `todayKey`. */
export const computeTeamHealth = (
  members: readonly TeamMember[],
  todayKey: string
): TeamHealth => {
  const teamPace = computeTeamPace(members);
  const checkIns = members
    .flatMap((member): CheckIn[] => {
      const reasons = checkInReasons(member.rhythm, todayKey, teamPace);
      return reasons.length > 0 ? [{ member, reasons }] : [];
    })
    .toSorted(
      (a, b) =>
        checkInWeight(b) - checkInWeight(a) ||
        a.member.name.localeCompare(b.member.name)
    );
  const dueForSlot = members
    .flatMap((member): DueForSlot[] =>
      isDue(member.rhythm, todayKey)
        ? [
            {
              member,
              daysSinceServed: daysSince(member.rhythm.lastServedOn, todayKey),
              typicalGapDays: member.rhythm.typicalGapDays,
            },
          ]
        : []
    )
    .toSorted(compareDue);
  const activeCount = members.filter(
    (member) => member.rhythm.servedDays90 > 0
  ).length;
  const topCount = Math.max(1, Math.ceil(members.length * TOP_SHARE_FRACTION));
  const topShare = topServingShare(members, topCount);
  const sum = (pick: (rhythm: ServingRhythm) => number) =>
    members.reduce((total, member) => total + pick(member.rhythm), 0);

  return {
    memberCount: members.length,
    activeCount,
    scheduledAheadCount: members.filter(
      (member) => member.rhythm.upcomingDays30 > 0
    ).length,
    declined: sum((rhythm) => rhythm.declined180),
    requests: sum((rhythm) => rhythm.requests180),
    pendingCount: sum((rhythm) => rhythm.pendingUpcoming),
    topCount,
    topShare,
    teamPace,
    status: healthStatus({
      memberCount: members.length,
      activeCount,
      topShare,
      servedDays: sum((rhythm) => rhythm.servedDays90),
    }),
    checkIns,
    dueForSlot,
  };
};

/** "Jul 12" for an org `YYYY-MM-DD` day. */
export const formatDayKey = (dayKey: string) =>
  // UTC noon on the org day: a civil-date carrier, so read it in UTC.
  formatCalendarDateLabel(new Date(`${dayKey}T12:00:00Z`), "UTC", "monthDay");

/** "every week", "every 3 weeks", "about monthly" for a typical gap in days. */
export const describeCadence = (typicalGapDays: number) => {
  const weeks = Math.max(1, Math.round(typicalGapDays / 7));
  if (weeks === 1) {
    return "every week";
  }
  if (weeks === 4) {
    return "about monthly";
  }
  return `every ${weeks} weeks`;
};

/** "3 weeks ago", "yesterday" for a count of days. */
export const describeDaysAgo = (days: number) => {
  if (days <= 0) {
    return "today";
  }
  if (days === 1) {
    return "yesterday";
  }
  if (days < 14) {
    return `${days} days ago`;
  }
  if (days < 60) {
    return `${Math.round(days / 7)} weeks ago`;
  }
  return `${Math.round(days / 30)} months ago`;
};

export interface CheckInReasonText {
  /** A badge-length name, such as "Drifting". */
  label: string;
  /** One sentence with the numbers behind it. */
  detail: string;
}

/** A short label and a sentence for a check-in reason. */
export const describeCheckInReason = (
  reason: CheckInReason
): CheckInReasonText => {
  switch (reason.kind) {
    case "unanswered": {
      const when =
        reason.nextPendingOn === null
          ? ""
          : ` for ${formatDayKey(reason.nextPendingOn)}`;
      return {
        label: "No response",
        detail:
          reason.pending === 1
            ? `Hasn't answered the request${when}.`
            : `${reason.pending} requests unanswered, next${when}.`,
      };
    }
    case "declining": {
      return {
        label: "Declining",
        detail: `Declined ${reason.declined} of ${reason.requests} requests in 6 months.`,
      };
    }
    case "drifting": {
      const cadence =
        reason.typicalGapDays === null
          ? ""
          : `, usually ${describeCadence(reason.typicalGapDays)}`;
      return {
        label: "Drifting",
        detail: `Last served ${formatDayKey(reason.lastServedOn)}${cadence}; nothing scheduled.`,
      };
    }
    case "overloaded": {
      if (reason.basis === "recent") {
        return {
          label: "Heavy load",
          detail: `Served ${reason.days} days in the last 30.`,
        };
      }
      if (reason.basis === "upcoming") {
        return {
          label: "Heavy load",
          detail: `Scheduled ${reason.days} days in the next 30.`,
        };
      }
      const pace =
        reason.teamPace === null
          ? ""
          : ` (team median ${Math.round(reason.teamPace)})`;
      return {
        label: "Heavy load",
        detail: `Served ${reason.days} days in 90${pace}.`,
      };
    }
    case "not-serving": {
      return {
        label: "Not serving",
        detail: "On the team, but no serving in the last 6 months.",
      };
    }
    default: {
      return reason satisfies never;
    }
  }
};
