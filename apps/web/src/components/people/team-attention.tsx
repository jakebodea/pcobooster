import type { PeopleDashboardPerson } from "@pcobooster/contracts/people-schemas";
import { CalendarClock, HeartHandshake } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { PersonLineSkeletonList } from "@/components/people/people-skeletons";
import {
  PersonAvatar,
  PersonRowButton,
} from "@/components/people/shared-components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { GetIntentPrefetchProps } from "@/hooks/use-intent-prefetch";
import {
  describeCadence,
  describeCheckInReason,
  describeDaysAgo,
} from "@/lib/team-health";
import type { CheckIn, DueForSlot, TeamMember } from "@/lib/team-health";

/** The API's role label for someone with no schedules in the window. */
const NO_RECENT_ROLE = "No recent role";

/** Rows each list shows before "Show all". */
const COLLAPSED_ROWS = 6;

interface PersonListProps<Entry> {
  entries: readonly Entry[];
  isLoading: boolean;
  empty: string;
  memberOf: (entry: Entry) => TeamMember;
  renderDetail: (entry: Entry) => ReactNode;
  renderAside?: (entry: Entry) => ReactNode;
  getPersonIntentProps: GetIntentPrefetchProps<PeopleDashboardPerson>;
  onOpenPerson: (person: PeopleDashboardPerson) => void;
}

const PersonList = <Entry,>({
  entries,
  isLoading,
  empty,
  memberOf,
  renderDetail,
  renderAside,
  getPersonIntentProps,
  onOpenPerson,
}: PersonListProps<Entry>) => {
  const [expanded, setExpanded] = useState(false);
  if (isLoading) {
    return <PersonLineSkeletonList rows={4} />;
  }
  if (entries.length === 0) {
    return <p className="text-muted-foreground px-2 py-1.5 text-sm">{empty}</p>;
  }
  const shown = expanded ? entries : entries.slice(0, COLLAPSED_ROWS);
  return (
    <div className="flex flex-col">
      {shown.map((entry) => {
        const member = memberOf(entry);
        return (
          <PersonRowButton
            key={member.id}
            person={member}
            getPersonIntentProps={getPersonIntentProps}
            onOpenPerson={onOpenPerson}
            size="row"
          >
            <PersonAvatar person={member} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {member.name}
              </span>
              <span className="text-muted-foreground block truncate text-xs">
                {renderDetail(entry)}
              </span>
            </span>
            {renderAside ? (
              <span className="flex shrink-0 items-center gap-1">
                {renderAside(entry)}
              </span>
            ) : null}
          </PersonRowButton>
        );
      })}
      {entries.length > COLLAPSED_ROWS ? (
        <Button
          variant="ghost"
          size="xs"
          className="mt-1 self-start"
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          {expanded ? "Show fewer" : `Show all ${entries.length}`}
        </Button>
      ) : null}
    </div>
  );
};

interface TeamCheckInsProps {
  checkIns: readonly CheckIn[];
  isLoading: boolean;
  getPersonIntentProps: GetIntentPrefetchProps<PeopleDashboardPerson>;
  onOpenPerson: (person: PeopleDashboardPerson) => void;
}

/** People a leader may want to reach out to, with the reasons why. */
export const TeamCheckIns = ({
  checkIns,
  isLoading,
  getPersonIntentProps,
  onOpenPerson,
}: TeamCheckInsProps) => (
  <Card size="sm">
    <CardHeader>
      <CardTitle>
        <span className="flex items-center gap-2">
          <HeartHandshake className="text-muted-foreground size-4" />
          Check in
        </span>
      </CardTitle>
      <CardDescription>
        Drifting, declining, not responding, or carrying a heavy load.
      </CardDescription>
      {checkIns.length > 0 && !isLoading ? (
        <CardAction>
          <Badge variant="secondary">{checkIns.length}</Badge>
        </CardAction>
      ) : null}
    </CardHeader>
    <CardContent>
      <PersonList
        entries={checkIns}
        isLoading={isLoading}
        empty="Nobody needs a check-in right now."
        memberOf={(checkIn) => checkIn.member}
        renderDetail={(checkIn) =>
          checkIn.reasons
            .map((reason) => describeCheckInReason(reason).detail)
            .join(" ")
        }
        renderAside={({ reasons: [primary, ...others] }) =>
          primary === undefined ? null : (
            <>
              <Badge variant="outline">
                {describeCheckInReason(primary).label}
              </Badge>
              {others.length > 0 ? (
                <span className="text-muted-foreground text-xs tabular-nums">
                  +{others.length}
                </span>
              ) : null}
            </>
          )
        }
        getPersonIntentProps={getPersonIntentProps}
        onOpenPerson={onOpenPerson}
      />
    </CardContent>
  </Card>
);

const describeDue = ({ daysSinceServed, typicalGapDays }: DueForSlot) => {
  if (daysSinceServed === null) {
    return "No serving in the last 6 months";
  }
  const cadence =
    typicalGapDays === null
      ? ""
      : ` · usually ${describeCadence(typicalGapDays)}`;
  return `Last served ${describeDaysAgo(daysSinceServed)}${cadence}`;
};

interface TeamDueListProps {
  dueForSlot: readonly DueForSlot[];
  isLoading: boolean;
  getPersonIntentProps: GetIntentPrefetchProps<PeopleDashboardPerson>;
  onOpenPerson: (person: PeopleDashboardPerson) => void;
}

/** People with nothing scheduled who are past their usual gap between serves. */
export const TeamDueList = ({
  dueForSlot,
  isLoading,
  getPersonIntentProps,
  onOpenPerson,
}: TeamDueListProps) => (
  <Card size="sm">
    <CardHeader>
      <CardTitle>
        <span className="flex items-center gap-2">
          <CalendarClock className="text-muted-foreground size-4" />
          Due for a slot
        </span>
      </CardTitle>
      <CardDescription>
        Nothing scheduled and past their usual gap, at least six weeks.
      </CardDescription>
      {dueForSlot.length > 0 && !isLoading ? (
        <CardAction>
          <Badge variant="secondary">{dueForSlot.length}</Badge>
        </CardAction>
      ) : null}
    </CardHeader>
    <CardContent>
      <PersonList
        entries={dueForSlot}
        isLoading={isLoading}
        empty="Everyone has served recently or has something scheduled."
        memberOf={(due) => due.member}
        renderDetail={describeDue}
        renderAside={({ member }) => (
          <span className="text-muted-foreground max-w-32 truncate text-xs">
            {member.roles === NO_RECENT_ROLE
              ? member.teams.join(", ")
              : member.roles}
          </span>
        )}
        getPersonIntentProps={getPersonIntentProps}
        onOpenPerson={onOpenPerson}
      />
    </CardContent>
  </Card>
);
