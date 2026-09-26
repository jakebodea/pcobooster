import type {
  PeopleDashboardPerson,
  PeopleDashboardTeam,
} from "@pcobooster/contracts/people-schemas";
import { formatCalendarDayInTimeZone } from "@pcobooster/planning-center-models/calendar";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useCallback, useDeferredValue, useMemo, useState } from "react";

import { PeopleDashboardProgress } from "@/components/people/dashboard-progress";
import { PeopleHealthView } from "@/components/people/health-view";
import { MonthView } from "@/components/people/month-view";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { LoadingBar } from "@/components/ui/loading-bar";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import type { GetIntentPrefetchProps } from "@/hooks/use-intent-prefetch";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import { usePeopleDashboard } from "@/hooks/use-people-dashboard";
import { createPeopleDashboardPersonQueryOptions } from "@/hooks/use-people-dashboard-person";
import { isQueryFresh } from "@/lib/intent-prefetch";
import {
  parsePeopleDashboardScope,
  scopeTeamIds,
  teamScope,
} from "@/lib/people-dashboard";
import type {
  PeopleDashboardData,
  PeopleDashboardScope,
} from "@/lib/people-dashboard";
import { speculativeQuery } from "@/lib/request-priority";
import { computeTeamHealth } from "@/lib/team-health";
import type { TeamMember } from "@/lib/team-health";

const EMPTY_MEMBERS: TeamMember[] = [];
const EMPTY_TEAMS: PeopleDashboardTeam[] = [];
const EMPTY_TEAM_IDS: string[] = [];
const OTHER_SERVICE_TYPE = "Other teams";

const MonthViewSkeleton = () => (
  <div
    className="grid shrink-0 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]"
    aria-busy
    aria-label="Loading month view"
  >
    <div className="border-border/40 flex flex-col gap-2 rounded-xl border p-4">
      <Skeleton variant="text" className="h-4 w-36" />
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 py-1">
          <Skeleton variant="round" className="size-7 shrink-0" />
          <Skeleton variant="text" className="h-3 w-28" />
          <Skeleton variant="text" className="ml-auto h-5 w-2/3" />
        </div>
      ))}
    </div>
    <Skeleton variant="control" className="h-72" />
  </div>
);

const teamLabel = (team: PeopleDashboardTeam) =>
  team.serviceTypeName === null
    ? team.name
    : `${team.name} · ${team.serviceTypeName}`;

const describeScope = (
  scope: PeopleDashboardScope,
  teams: readonly PeopleDashboardTeam[],
  ledTeamIds: readonly string[]
) => {
  const teamIds = scopeTeamIds(scope, ledTeamIds);
  if (teamIds === null) {
    return "All teams";
  }
  const [onlyTeamId] = teamIds;
  const onlyTeam =
    teamIds.length === 1
      ? teams.find((team) => team.id === onlyTeamId)
      : undefined;
  if (onlyTeam !== undefined) {
    return teamLabel(onlyTeam);
  }
  return "Teams you lead";
};

/** Teams grouped by service type, in roster order within each group. */
const groupTeams = (teams: readonly PeopleDashboardTeam[]) => {
  const groups = new Map<string, PeopleDashboardTeam[]>();
  for (const team of teams) {
    const key = team.serviceTypeName ?? OTHER_SERVICE_TYPE;
    const group = groups.get(key) ?? [];
    group.push(team);
    groups.set(key, group);
  }
  return [...groups.entries()].toSorted(([a], [b]) => {
    if (a === OTHER_SERVICE_TYPE || b === OTHER_SERVICE_TYPE) {
      return a === OTHER_SERVICE_TYPE ? 1 : -1;
    }
    return a.localeCompare(b);
  });
};

const ScopeSelect = ({
  scope,
  teams,
  ledTeamIds,
  onChange,
}: {
  scope: PeopleDashboardScope;
  teams: readonly PeopleDashboardTeam[];
  ledTeamIds: readonly string[];
  onChange: (scope: PeopleDashboardScope) => void;
}) => {
  const groups = useMemo(() => groupTeams(teams), [teams]);
  return (
    <NativeSelect
      className="w-full"
      aria-label="Choose teams"
      value={scope}
      onChange={(event) => {
        const next = parsePeopleDashboardScope(event.target.value);
        if (next !== null) {
          onChange(next);
        }
      }}
    >
      {ledTeamIds.length > 0 ? (
        <NativeSelectOption value="mine">Teams I lead</NativeSelectOption>
      ) : null}
      <NativeSelectOption value="all">All teams</NativeSelectOption>
      {groups.map(([serviceType, groupTeamsList]) => (
        <NativeSelectOptGroup key={serviceType} label={serviceType}>
          {groupTeamsList.map((team) => (
            <NativeSelectOption key={team.id} value={teamScope(team.id)}>
              {team.name}
            </NativeSelectOption>
          ))}
        </NativeSelectOptGroup>
      ))}
    </NativeSelect>
  );
};

interface PeoplePageContentProps {
  activeView: "health" | "month";
  dashboard: PeopleDashboardData | undefined;
  scopeLabel: string;
  todayKey: string;
  isError: boolean;
  isLoading: boolean;
  visibleMembers: TeamMember[];
  getPersonIntentProps: GetIntentPrefetchProps<PeopleDashboardPerson>;
  onOpenPerson: (person: PeopleDashboardPerson) => void;
}

const PeoplePageContent = ({
  activeView,
  dashboard,
  scopeLabel,
  todayKey,
  isError,
  isLoading,
  visibleMembers,
  getPersonIntentProps,
  onOpenPerson,
}: PeoplePageContentProps) => {
  const members = dashboard?.people ?? EMPTY_MEMBERS;
  const health = useMemo(
    () => computeTeamHealth(members, todayKey),
    [members, todayKey]
  );
  if (isError) {
    return (
      <div className="border-border/40 text-muted-foreground rounded-lg border px-4 py-8 text-sm">
        People dashboard failed to load. Refresh and try again.
      </div>
    );
  }
  if (activeView === "health") {
    return (
      <PeopleHealthView
        health={health}
        scopeLabel={scopeLabel}
        progress={dashboard?.progress}
        visibleMembers={visibleMembers}
        isLoading={isLoading}
        getPersonIntentProps={getPersonIntentProps}
        onOpenPerson={onOpenPerson}
      />
    );
  }
  if (dashboard) {
    return (
      <MonthView
        people={visibleMembers}
        month={dashboard.month}
        monthDays={dashboard.monthDays}
        matrixDays={dashboard.matrixDays}
        onSelectPerson={onOpenPerson}
        getPersonIntentProps={getPersonIntentProps}
      />
    );
  }
  return <MonthViewSkeleton />;
};

export const PeoplePage = () => {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const orgTimeZone = useOrganizationTimeZone();
  const todayKey = formatCalendarDayInTimeZone(new Date(), orgTimeZone);
  const [activeView, setActiveView] = useState<"health" | "month">("health");
  const [scopeChoice, setScopeChoice] = useState<PeopleDashboardScope | null>(
    null
  );
  const {
    scope,
    dashboard,
    isLoading,
    isError,
    isFetching,
    isLoadingActivity,
    failedBatchCount,
    retryFailed,
    canLoadMore,
    loadMore,
  } = usePeopleDashboard(scopeChoice);
  const members = dashboard?.people ?? EMPTY_MEMBERS;
  const teams = dashboard?.teams ?? EMPTY_TEAMS;
  const ledTeamIds = dashboard?.ledTeamIds ?? EMPTY_TEAM_IDS;
  const scopeLabel = describeScope(scope, teams, ledTeamIds);

  const visibleMembers = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    if (!normalized) {
      return members;
    }
    return members.filter((member) =>
      [member.name, member.roles, ...member.teams]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [deferredQuery, members]);

  const prefetchPersonDetail = useCallback(
    async (person: PeopleDashboardPerson) => {
      void router.preloadRoute({
        to: "/people/$personId",
        params: { personId: person.id },
      });
      await queryClient.query(
        speculativeQuery(
          createPeopleDashboardPersonQueryOptions(person.id, null)
        )
      );
    },
    [queryClient, router]
  );
  // A cold person detail costs about 50 to 70 Planning Center requests, so hovering
  // or tabbing past a row must not load it.
  const { getIntentProps: getPersonIntentProps, cancelIntent } =
    useIntentPrefetch<PeopleDashboardPerson>({
      keyOf: (person) => person.id,
      isFresh: (person) => {
        const options = createPeopleDashboardPersonQueryOptions(
          person.id,
          null
        );
        return isQueryFresh(queryClient, options.queryKey, options.staleTime);
      },
      prefetch: prefetchPersonDetail,
    });
  const openPerson = useCallback(
    (person: PeopleDashboardPerson) => {
      cancelIntent();
      void navigate({
        to: "/people/$personId",
        params: { personId: person.id },
      });
    },
    [cancelIntent, navigate]
  );

  return (
    <main className="bg-background flex flex-1 flex-col md:h-full md:min-h-0 md:overflow-hidden">
      <div className="pb-safe-4 mx-auto flex w-full max-w-7xl flex-1 flex-col gap-3 px-4 pt-1 md:min-h-0 md:overflow-y-auto md:overscroll-contain md:py-4">
        <header className="flex shrink-0 flex-col gap-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 max-md:contents">
            <div className="min-w-0 max-md:hidden">
              <h1 className="truncate text-xl font-semibold tracking-tight max-md:sr-only md:text-2xl">
                People
              </h1>
              <p className="text-muted-foreground text-sm max-md:hidden">
                Team health, who to check in with, and who is due to serve.
              </p>
            </div>
            <Tabs
              value={activeView}
              onValueChange={(value) => {
                setActiveView(value === "month" ? "month" : "health");
              }}
            >
              <TabsList className="h-8 max-md:h-10 max-md:w-full">
                <TabsTrigger value="health">Health</TabsTrigger>
                <TabsTrigger value="month">Month</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="grid shrink-0 items-center gap-2 md:grid-cols-[minmax(0,1fr)_16rem]">
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Search people, teams, or roles"
                aria-label="Search people"
              />
            </InputGroup>
            <ScopeSelect
              scope={scope}
              teams={teams}
              ledTeamIds={ledTeamIds}
              onChange={setScopeChoice}
            />
          </div>
        </header>

        <LoadingBar
          active={isFetching && !isError}
          className="-my-1.5 shrink-0"
        />

        <PeopleDashboardProgress
          progress={dashboard?.progress}
          isLoadingActivity={isLoadingActivity}
          failedBatchCount={failedBatchCount}
          canLoadMore={canLoadMore}
          onRetry={retryFailed}
          onLoadMore={loadMore}
        />

        <div className="shrink-0" aria-busy={isLoading}>
          <PeoplePageContent
            activeView={activeView}
            dashboard={dashboard}
            scopeLabel={scopeLabel}
            todayKey={todayKey}
            isError={isError}
            isLoading={isLoading}
            visibleMembers={visibleMembers}
            getPersonIntentProps={getPersonIntentProps}
            onOpenPerson={openPerson}
          />
        </div>
      </div>
    </main>
  );
};
