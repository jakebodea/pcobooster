import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type {
  TeamPosition,
  TeamPositionGroup,
} from "@pcobooster/planning-center-models/types";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { SlotRef } from "@/components/schedule/types";
import { useCollapsedTeams } from "@/hooks/use-collapsed-teams";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { createPlanItemsQueryOptions } from "@/hooks/use-plan-items";
import { usePlanTimes } from "@/hooks/use-plan-times";
import { usePlans } from "@/hooks/use-plans";
import {
  createPlanWindowHistoryQueryOptions,
  isPositionCandidatesFresh,
  prefetchPositionCandidates,
  toPlanDateKey,
  usePositionCandidates,
} from "@/hooks/use-position-candidates";
import type { CandidateSlot } from "@/hooks/use-position-candidates";
import { useServiceTypes } from "@/hooks/use-service-types";
import { useTeamPositions } from "@/hooks/use-team-positions";
import { queryKeys } from "@/lib/query-keys";
import { requestScheduler, speculativeQuery } from "@/lib/request-priority";
import type {
  DashboardView,
  PlanSlotSelection,
} from "@/lib/schedule-navigation";
import {
  buildPlanMemberPositionId,
  planSlotLink,
} from "@/lib/schedule-navigation";

interface RouteSelectionIds {
  teamId: string | null;
  positionId: string | null;
  view: DashboardView;
}

const resolveSelectedSlot = (
  teamPositionGroups: TeamPositionGroup[] | undefined,
  routeIds: RouteSelectionIds
) => {
  const selectedTeamGroup =
    teamPositionGroups?.find((group) => group.teamId === routeIds.teamId) ??
    null;
  const selectedPositionObj =
    selectedTeamGroup?.positions.find(
      (position) => position.id === routeIds.positionId
    ) ?? null;

  const selectedTeam = selectedTeamGroup?.teamId ?? null;
  const selectedPosition = selectedPositionObj?.id ?? null;
  const selectedPositionUsesRoster =
    selectedPositionObj?.source === undefined ||
    selectedPositionObj.source === "team_position";
  return { selectedTeam, selectedPosition, selectedPositionUsesRoster };
};

const usePlanWorkspaceData = (
  serviceTypeId: string,
  planId: string,
  routeIds: RouteSelectionIds
) => {
  const { data: serviceTypes, isLoading: serviceTypesLoading } =
    useServiceTypes();
  const routeServiceTypeId = serviceTypeId;
  const routePlanId = planId;
  const selectedServiceType =
    serviceTypes?.find(
      (serviceType) => serviceType.id === routeServiceTypeId
    ) ?? null;

  const { data: plans, isLoading: plansLoading } = usePlans(routeServiceTypeId);
  const selectedPlan = plans?.find((plan) => plan.id === routePlanId) ?? null;

  const { data: teamPositionGroups, isLoading: teamPositionsLoading } =
    useTeamPositions(
      routeServiceTypeId,
      routePlanId,
      selectedPlan?.seriesId ?? null
    );
  const { data: planTimes } = usePlanTimes(routeServiceTypeId, routePlanId);

  const { selectedTeam, selectedPosition, selectedPositionUsesRoster } =
    resolveSelectedSlot(teamPositionGroups, routeIds);
  const planDateKey = toPlanDateKey(selectedPlan?.sortDate ?? null);
  const candidateSlot = useMemo<CandidateSlot | null>(
    () =>
      planDateKey !== null &&
      isNonEmptyString(selectedPosition) &&
      selectedPositionUsesRoster
        ? {
            serviceTypeId: routeServiceTypeId,
            teamId: selectedTeam,
            positionId: selectedPosition,
            planId: routePlanId,
            dateKey: planDateKey,
          }
        : null,
    [
      planDateKey,
      routePlanId,
      routeServiceTypeId,
      selectedPosition,
      selectedPositionUsesRoster,
      selectedTeam,
    ]
  );
  const candidateList = usePositionCandidates(candidateSlot);

  const workspaceUnavailable =
    !serviceTypesLoading &&
    !plansLoading &&
    (!selectedServiceType || !selectedPlan);
  return {
    selectedServiceType,
    selectedPlan,
    teamPositionGroups,
    teamPositionsLoading,
    planTimes,
    selectedTeam,
    selectedPosition,
    selectedPositionUsesRoster,
    candidateList,
    workspaceUnavailable,
  };
};

export const useDashboardController = ({
  serviceTypeId,
  planId,
  view,
}: {
  serviceTypeId: string;
  planId: string;
  view: DashboardView;
}) => {
  const router = useRouter();
  const navigate = useNavigate();
  const search = useSearch({
    from: "/_app/services/$serviceTypeId/plans/$planId/$view",
  });
  const queryClient = useQueryClient();
  /** True once a slot was opened from the phone position list, so Back can pop history. */
  const openedSlotFromListRef = useRef(false);

  const [collapsedTeamsByPlan, setCollapsedTeamsByPlan] = useCollapsedTeams();

  const routeIds = useMemo<RouteSelectionIds>(
    () => ({
      teamId: search.teamId ?? null,
      positionId: search.positionId ?? null,
      view,
    }),
    [search.teamId, search.positionId, view]
  );

  const navigateTo = useCallback(
    (next: PlanSlotSelection, method: "push" | "replace" = "push") => {
      if (
        next.serviceTypeId === serviceTypeId &&
        next.planId === planId &&
        next.view === routeIds.view &&
        (next.teamId ?? "") === (routeIds.teamId ?? "") &&
        (next.positionId ?? "") === (routeIds.positionId ?? "")
      ) {
        return;
      }
      void navigate({ ...planSlotLink(next), replace: method === "replace" });
    },
    [navigate, planId, routeIds, serviceTypeId]
  );

  const {
    selectedServiceType,
    selectedPlan,
    teamPositionGroups,
    teamPositionsLoading,
    planTimes,
    selectedTeam,
    selectedPosition,
    selectedPositionUsesRoster,
    candidateList,
    workspaceUnavailable,
  } = usePlanWorkspaceData(serviceTypeId, planId, routeIds);
  const routeServiceTypeId = serviceTypeId;
  const routePlanId = planId;
  const selectedPlanId = planId;
  const collapsedTeams = collapsedTeamsByPlan[planId] ?? {};
  const hasPlanUrlSelection = true;
  const hasSelectedPlanMetadata = Boolean(selectedServiceType && selectedPlan);
  const activeView = view;

  useEffect(() => {
    if (!teamPositionGroups || teamPositionsLoading) {
      return;
    }
    if (
      routeIds.teamId === selectedTeam &&
      routeIds.positionId === selectedPosition
    ) {
      return;
    }
    // The URL named a slot this plan doesn't have; show the resolved selection instead.
    void navigate({
      ...planSlotLink({
        serviceTypeId,
        planId,
        view,
        teamId: selectedTeam,
        positionId: selectedPosition,
      }),
      replace: true,
    });
  }, [
    navigate,
    planId,
    routeIds,
    selectedPosition,
    selectedTeam,
    serviceTypeId,
    teamPositionGroups,
    teamPositionsLoading,
    view,
  ]);

  // What the other tabs need waits in the speculative lane, behind the view on screen: the
  // Plan tab's items, and on the Assign view the plan-window history every position's
  // candidates are scored with (up to about 40 Planning Center requests cold).
  useEffect(() => {
    const leave = new AbortController();
    if (hasPlanUrlSelection && activeView !== "plan") {
      void requestScheduler.runSpeculative(async () => {
        await queryClient.query(
          speculativeQuery(
            createPlanItemsQueryOptions(routeServiceTypeId, routePlanId)
          )
        );
      }, leave.signal);
    }
    return () => {
      leave.abort();
    };
  }, [
    activeView,
    hasPlanUrlSelection,
    queryClient,
    routePlanId,
    routeServiceTypeId,
  ]);

  const planDateKey = toPlanDateKey(selectedPlan?.sortDate ?? null);
  useEffect(() => {
    const leave = new AbortController();
    if (activeView === "assign" && planDateKey !== null) {
      void requestScheduler.runSpeculative(async () => {
        await queryClient.query(
          speculativeQuery(createPlanWindowHistoryQueryOptions(planDateKey))
        );
      }, leave.signal);
    }
    return () => {
      leave.abort();
    };
  }, [activeView, planDateKey, queryClient]);

  const getCandidateSlot = useCallback(
    (slot: SlotRef): CandidateSlot | null => {
      const dateKey = toPlanDateKey(selectedPlan?.sortDate ?? null);
      if (!routeServiceTypeId || !selectedPlan || dateKey === null) {
        return null;
      }
      const slotPosition = teamPositionGroups
        ?.find((group) => group.teamId === slot.teamId)
        ?.positions.find((position) => position.id === slot.positionId);
      if (slotPosition?.source && slotPosition.source !== "team_position") {
        return null;
      }
      return {
        serviceTypeId: routeServiceTypeId,
        teamId: slot.teamId,
        positionId: slot.positionId,
        planId: selectedPlan.id,
        dateKey,
      };
    },
    [routeServiceTypeId, selectedPlan, teamPositionGroups]
  );

  const prefetchSlotPeople = useCallback(
    async (slot: SlotRef) => {
      const candidateSlot = getCandidateSlot(slot);
      if (candidateSlot === null) {
        return;
      }
      try {
        await prefetchPositionCandidates(queryClient, candidateSlot);
      } catch {
        // The selected-slot queries own any visible loading error.
      }
    },
    [getCandidateSlot, queryClient]
  );

  // Candidates are cheap, but their availability costs a request or more per person, so only
  // a slot the pointer or focus rests on is loaded ahead of the click.
  const { getIntentProps: getSlotIntentProps, cancelIntent: cancelSlotIntent } =
    useIntentPrefetch<SlotRef>({
      keyOf: (slot) => `${slot.teamId}:${slot.positionId}`,
      isFresh: (slot) => {
        const candidateSlot = getCandidateSlot(slot);
        return (
          candidateSlot === null ||
          isPositionCandidatesFresh(queryClient, candidateSlot)
        );
      },
      prefetch: prefetchSlotPeople,
    });

  const handleSlotSelect = (
    slot: SlotRef,
    { replace = false }: { replace?: boolean } = {}
  ) => {
    if (!isNonEmptyString(routeIds.positionId)) {
      openedSlotFromListRef.current = true;
    }
    // The selected slot's queries load its list as interactive work.
    cancelSlotIntent();

    if (selectedPlanId) {
      setCollapsedTeamsByPlan((prev) => {
        const currentForPlan = prev[selectedPlanId] ?? {};
        if (!currentForPlan[slot.teamId]) {
          return prev;
        }

        return {
          ...prev,
          [selectedPlanId]: {
            ...currentForPlan,
            [slot.teamId]: false,
          },
        };
      });
    }

    navigateTo(
      {
        serviceTypeId: routeServiceTypeId,
        planId: routePlanId,
        teamId: slot.teamId,
        positionId: slot.positionId,
        view: "assign",
      },
      replace ? "replace" : "push"
    );
  };

  /** Returns the phone Assign view to its position list. */
  const handleSlotClear = () => {
    if (openedSlotFromListRef.current) {
      openedSlotFromListRef.current = false;
      router.history.back();
      return;
    }
    navigateTo(
      {
        serviceTypeId: routeServiceTypeId,
        planId: routePlanId,
        teamId: null,
        positionId: null,
        view: "assign",
      },
      "replace"
    );
  };

  const handleAddCustomPosition = (
    team: { teamId: string; teamName: string },
    positionName: string
  ): SlotRef | null => {
    if (!routeServiceTypeId || !routePlanId) {
      return null;
    }
    const trimmedName = positionName.trim();
    if (!trimmedName) {
      return null;
    }

    const existingPosition = teamPositionGroups
      ?.find((group) => group.teamId === team.teamId)
      ?.positions.find(
        (position) =>
          position.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
    if (existingPosition) {
      return {
        teamId: team.teamId,
        teamName: team.teamName,
        positionId: existingPosition.id,
        positionName: existingPosition.name,
        source: existingPosition.source,
      };
    }

    const positionId = buildPlanMemberPositionId(team.teamId, trimmedName);
    const slot: SlotRef = {
      teamId: team.teamId,
      teamName: team.teamName,
      positionId,
      positionName: trimmedName,
      source: "custom",
    };

    queryClient.setQueryData<TeamPositionGroup[]>(
      queryKeys.teamPositions(routeServiceTypeId, routePlanId, null),
      (groups) => {
        if (!groups) {
          return groups;
        }
        return groups.map((group) => {
          if (group.teamId !== team.teamId) {
            return group;
          }
          const duplicate = group.positions.some(
            (position) =>
              position.name.trim().toLowerCase() === trimmedName.toLowerCase()
          );
          if (duplicate) {
            return group;
          }

          const position: TeamPosition = {
            id: positionId,
            name: trimmedName,
            teamId: team.teamId,
            teamName: team.teamName,
            source: "custom",
            neededCount: 0,
          };

          return {
            ...group,
            positions: [...group.positions, position].toSorted((a, b) =>
              a.name.localeCompare(b.name)
            ),
          };
        });
      }
    );

    return slot;
  };

  const toggleTeamCollapsed = (teamId: string) => {
    if (!selectedPlanId) {
      return;
    }
    setCollapsedTeamsByPlan((prev) => {
      const currentForPlan = prev[selectedPlanId] ?? {};
      return {
        ...prev,
        [selectedPlanId]: {
          ...currentForPlan,
          [teamId]: !currentForPlan[teamId],
        },
      };
    });
  };

  return {
    workspaceUnavailable,
    hasPlanUrlSelection,
    hasSelectedPlanMetadata,
    selectedServiceType,
    selectedPlan,
    activeView,
    teamPositionsLoading,
    teamPositionGroups,
    collapsedTeams,
    selectedTeam,
    selectedPosition,
    selectedPositionUsesRoster,
    candidateList,
    routeServiceTypeId,
    routePlanId,
    toggleTeamCollapsed,
    handleSlotSelect,
    handleSlotClear,
    getSlotIntentProps,
    handleAddCustomPosition,
    planTimes,
  };
};
