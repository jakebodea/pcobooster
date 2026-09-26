import type { PeopleDashboardPerson } from "@pcobooster/contracts/people-schemas";
import { Link } from "@tanstack/react-router";
import { ArrowDown } from "lucide-react";
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";

import {
  PersonIdentitySkeleton,
  PersonLineSkeleton,
} from "@/components/people/people-skeletons";
import {
  PersonAvatar,
  PersonRowButton,
} from "@/components/people/shared-components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverLabel } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GetIntentPrefetchProps } from "@/hooks/use-intent-prefetch";
import { describeCheckInReason, formatDayKey } from "@/lib/team-health";
import type { CheckInReason, TeamMember } from "@/lib/team-health";

type RosterSort = "name" | "lastServed" | "served90";

const sortLabels: Record<RosterSort, string> = {
  name: "Person",
  lastServed: "Last served",
  served90: "90 days",
};

const compareMembers = (sort: RosterSort) => (a: TeamMember, b: TeamMember) => {
  if (sort === "served90") {
    return (
      b.rhythm.servedDays90 - a.rhythm.servedDays90 ||
      a.name.localeCompare(b.name)
    );
  }
  if (sort === "lastServed") {
    // Longest since serving first; people who have not served lead.
    const aDay = a.rhythm.lastServedOn ?? "";
    const bDay = b.rhythm.lastServedOn ?? "";
    return aDay.localeCompare(bDay) || a.name.localeCompare(b.name);
  }
  return a.name.localeCompare(b.name);
};

const SortHeader = ({
  sort,
  current,
  onSort,
  className,
}: {
  sort: RosterSort;
  current: RosterSort;
  onSort: (sort: RosterSort) => void;
  className?: string;
}) => (
  <TableHead
    className={className}
    aria-sort={sort === current ? "descending" : undefined}
  >
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3"
      aria-pressed={sort === current}
      onClick={() => {
        onSort(sort);
      }}
    >
      {sortLabels[sort]}
      {sort === current ? <ArrowDown /> : null}
    </Button>
  </TableHead>
);

type ServingBarStyle = CSSProperties & {
  "--serving-share": string;
  "--team-pace": string;
};

const percentOf = (value: number, max: number) =>
  `${max === 0 ? 0 : (value / max) * 100}%`;

const ServingBar = ({
  days,
  maxDays,
  teamPace,
}: {
  days: number;
  maxDays: number;
  teamPace: number | null;
}) => {
  const style: ServingBarStyle = {
    "--serving-share": percentOf(days, maxDays),
    "--team-pace": percentOf(teamPace ?? 0, maxDays),
  };
  return (
    <div className="flex items-center gap-2" style={style}>
      <span className="w-5 shrink-0 text-right tabular-nums">{days}</span>
      <div className="bg-muted relative h-1.5 flex-1 rounded-full">
        <div className="bg-primary/70 h-full w-(--serving-share) rounded-full" />
        {teamPace !== null && maxDays > 0 ? (
          <div
            aria-hidden
            className="bg-foreground/50 absolute -top-0.5 left-(--team-pace) h-2.5 w-px"
          />
        ) : null}
      </div>
    </div>
  );
};

const ReasonBadges = ({ reasons }: { reasons: readonly CheckInReason[] }) => {
  if (reasons.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {reasons.map((reason) => {
        const { label, detail } = describeCheckInReason(reason);
        return (
          <HoverLabel
            key={reason.kind}
            label={detail}
            render={<Badge variant="outline" />}
          >
            {label}
          </HoverLabel>
        );
      })}
    </span>
  );
};

const responsesLabel = ({ rhythm }: TeamMember) => {
  const parts: string[] = [];
  if (rhythm.declined180 > 0) {
    parts.push(`${rhythm.declined180} declined`);
  }
  if (rhythm.pendingUpcoming > 0) {
    parts.push(`${rhythm.pendingUpcoming} pending`);
  }
  return parts.length > 0 ? parts.join(" · ") : "-";
};

const COLUMN_COUNT = 6;
const NO_REASONS: readonly CheckInReason[] = [];

interface TeamRosterProps {
  members: readonly TeamMember[];
  reasonsById: ReadonlyMap<string, readonly CheckInReason[]>;
  teamPace: number | null;
  isLoading: boolean;
  getPersonIntentProps: GetIntentPrefetchProps<PeopleDashboardPerson>;
  onOpenPerson: (person: PeopleDashboardPerson) => void;
}

/** Everyone in scope with how they have been serving and responding. */
export const TeamRoster = ({
  members,
  reasonsById,
  teamPace,
  isLoading,
  getPersonIntentProps,
  onOpenPerson,
}: TeamRosterProps) => {
  const [sort, setSort] = useState<RosterSort>("name");
  const sorted = useMemo(
    () => members.toSorted(compareMembers(sort)),
    [members, sort]
  );
  const maxDays = Math.max(
    0,
    ...members.map((member) => member.rhythm.servedDays90)
  );

  return (
    <div className="border-border/40 shrink-0 overflow-hidden rounded-2xl border md:rounded-lg">
      <div className="hidden md:block">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="[&>th]:h-9">
              <SortHeader
                sort="name"
                current={sort}
                onSort={setSort}
                className="w-[28%]"
              />
              <SortHeader
                sort="lastServed"
                current={sort}
                onSort={setSort}
                className="w-[13%]"
              />
              <TableHead className="w-[13%]">Next</TableHead>
              <SortHeader
                sort="served90"
                current={sort}
                onSort={setSort}
                className="w-[15%]"
              />
              <TableHead className="w-[14%]">Responses</TableHead>
              <TableHead>Signals</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 6 }, (_, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <PersonIdentitySkeleton index={index} />
                    </TableCell>
                    {Array.from({ length: COLUMN_COUNT - 1 }, (_cell, cell) => (
                      <TableCell key={cell}>
                        <Skeleton
                          variant="text"
                          className="h-3 w-full max-w-16"
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : null}
            {!isLoading && sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="text-center">
                  No people matched the current filters.
                </TableCell>
              </TableRow>
            ) : null}
            {isLoading
              ? null
              : sorted.map((member) => (
                  <TableRow
                    key={member.id}
                    className="cursor-pointer"
                    {...getPersonIntentProps(member)}
                    onClick={() => {
                      onOpenPerson(member);
                    }}
                  >
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-3">
                        <PersonAvatar person={member} />
                        <div className="min-w-0">
                          <Link
                            to="/people/$personId"
                            params={{ personId: member.id }}
                            className="focus-visible:outline-ring block w-full truncate text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            {member.name}
                          </Link>
                          <p className="text-muted-foreground truncate text-xs">
                            {member.teams.join(", ")} · {member.roles}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {member.rhythm.lastServedOn === null
                        ? "6+ months"
                        : formatDayKey(member.rhythm.lastServedOn)}
                    </TableCell>
                    <TableCell>
                      {member.rhythm.nextServingOn === null ? (
                        <span className="text-muted-foreground">
                          Not scheduled
                        </span>
                      ) : (
                        formatDayKey(member.rhythm.nextServingOn)
                      )}
                    </TableCell>
                    <TableCell>
                      <ServingBar
                        days={member.rhythm.servedDays90}
                        maxDays={maxDays}
                        teamPace={teamPace}
                      />
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground block truncate">
                        {responsesLabel(member)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ReasonBadges
                        reasons={reasonsById.get(member.id) ?? NO_REASONS}
                      />
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
      <div className="divide-border/35 flex flex-col divide-y p-1 md:hidden">
        {isLoading
          ? Array.from({ length: 4 }, (_, index) => (
              <PersonLineSkeleton key={index} index={index} />
            ))
          : sorted.map((member) => {
              const [firstReason] = reasonsById.get(member.id) ?? NO_REASONS;
              return (
                <PersonRowButton
                  key={member.id}
                  person={member}
                  getPersonIntentProps={getPersonIntentProps}
                  onOpenPerson={onOpenPerson}
                >
                  <PersonAvatar person={member} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {member.name}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {member.rhythm.lastServedOn === null
                        ? "No serving in 6 months"
                        : `Last ${formatDayKey(member.rhythm.lastServedOn)}`}
                      {" · "}
                      {member.rhythm.nextServingOn === null
                        ? "Not scheduled"
                        : `Next ${formatDayKey(member.rhythm.nextServingOn)}`}
                    </span>
                  </span>
                  {firstReason === undefined ? null : (
                    <Badge variant="outline" className="shrink-0">
                      {describeCheckInReason(firstReason).label}
                    </Badge>
                  )}
                </PersonRowButton>
              );
            })}
      </div>
    </div>
  );
};
