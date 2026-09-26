import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type { TeamPositionGroup } from "@pcobooster/planning-center-models/types";
import { useQuery } from "@tanstack/react-query";
import type { QueryFunctionContext } from "@tanstack/react-query";
import { useCallback } from "react";

import { useHydrateQueryFromCache } from "@/lib/query-cache-hydration";
import { queryKeys } from "@/lib/query-keys";
import { callForQuery } from "@/lib/request-priority";
import {
  readCachedTeamPositions,
  writeCachedTeamPositions,
} from "@/lib/team-positions-cache";
import { orpc } from "@/orpc-client";

const TEAM_POSITIONS_STALE_TIME_MS = 10 * 60 * 1000;

export const createTeamPositionsQueryOptions = (
  serviceTypeId: string | null,
  planId: string | null,
  seriesId: string | null
) => ({
  queryKey: queryKeys.teamPositions(serviceTypeId, planId, seriesId),
  queryFn: async (context: QueryFunctionContext) => {
    if (!isNonEmptyString(serviceTypeId) || !isNonEmptyString(planId)) {
      return [];
    }
    const groups = await callForQuery(
      context,
      async (options) =>
        await orpc.catalog.teamPositions(
          { serviceTypeId, planId, seriesId: seriesId ?? undefined },
          options
        )
    );
    writeCachedTeamPositions(serviceTypeId, planId, seriesId, groups);
    return groups;
  },
  staleTime: TEAM_POSITIONS_STALE_TIME_MS,
});

export const useTeamPositions = (
  serviceTypeId: string | null,
  planId: string | null,
  seriesId: string | null
) => {
  const queryKey = queryKeys.teamPositions(serviceTypeId, planId, seriesId);
  const readCachedGroups = useCallback(
    () => readCachedTeamPositions(serviceTypeId, planId, seriesId),
    [planId, seriesId, serviceTypeId]
  );
  useHydrateQueryFromCache(queryKey, readCachedGroups);

  return useQuery<TeamPositionGroup[]>({
    ...createTeamPositionsQueryOptions(serviceTypeId, planId, seriesId),
    queryKey,
    enabled: isNonEmptyString(serviceTypeId) && isNonEmptyString(planId),
  });
};
