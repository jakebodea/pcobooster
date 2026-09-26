import type { PeopleDashboardPerson } from "@pcobooster/contracts/people-schemas";
import { useMemo } from "react";

import { TeamCheckIns, TeamDueList } from "@/components/people/team-attention";
import { TeamHealthSummary } from "@/components/people/team-health-summary";
import { TeamRoster } from "@/components/people/team-roster";
import type { GetIntentPrefetchProps } from "@/hooks/use-intent-prefetch";
import type { PeopleDashboardProgress } from "@/lib/people-dashboard";
import type { TeamHealth, TeamMember } from "@/lib/team-health";

interface PeopleHealthViewProps {
  health: TeamHealth;
  scopeLabel: string;
  progress: PeopleDashboardProgress | undefined;
  /** Scope members after search. */
  visibleMembers: readonly TeamMember[];
  isLoading: boolean;
  getPersonIntentProps: GetIntentPrefetchProps<PeopleDashboardPerson>;
  onOpenPerson: (person: PeopleDashboardPerson) => void;
}

/** A leader's view of their team: overall health, who to reach out to, who to schedule. */
export const PeopleHealthView = ({
  health,
  scopeLabel,
  progress,
  visibleMembers,
  isLoading,
  getPersonIntentProps,
  onOpenPerson,
}: PeopleHealthViewProps) => {
  const reasonsById = useMemo(
    () =>
      new Map(
        health.checkIns.map((checkIn) => [checkIn.member.id, checkIn.reasons])
      ),
    [health.checkIns]
  );

  return (
    <div className="flex shrink-0 flex-col gap-3">
      <TeamHealthSummary
        health={health}
        scopeLabel={scopeLabel}
        progress={progress}
        isLoading={isLoading}
      />
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <TeamCheckIns
          checkIns={health.checkIns}
          isLoading={isLoading}
          getPersonIntentProps={getPersonIntentProps}
          onOpenPerson={onOpenPerson}
        />
        <TeamDueList
          dueForSlot={health.dueForSlot}
          isLoading={isLoading}
          getPersonIntentProps={getPersonIntentProps}
          onOpenPerson={onOpenPerson}
        />
      </div>
      <TeamRoster
        members={visibleMembers}
        reasonsById={reasonsById}
        teamPace={health.teamPace}
        isLoading={isLoading}
        getPersonIntentProps={getPersonIntentProps}
        onOpenPerson={onOpenPerson}
      />
    </div>
  );
};
