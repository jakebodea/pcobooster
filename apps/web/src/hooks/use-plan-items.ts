import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type { PlanItem } from "@pcobooster/planning-center-models/types";
import { useQuery } from "@tanstack/react-query";
import type { QueryFunctionContext } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  readCachedPlanItems,
  writeCachedPlanItems,
} from "@/lib/plan-items-cache";
import { useHydrateQueryFromCache } from "@/lib/query-cache-hydration";
import { queryKeys } from "@/lib/query-keys";
import { callForQuery } from "@/lib/request-priority";
import { orpc } from "@/orpc-client";

const PLAN_ITEMS_STALE_TIME_MS = 60 * 1000;

export const createPlanItemsQueryOptions = (
  serviceTypeId: string | null,
  planId: string | null
) => ({
  queryKey: queryKeys.planItems(serviceTypeId, planId),
  queryFn: async (context: QueryFunctionContext) => {
    if (!isNonEmptyString(serviceTypeId) || !isNonEmptyString(planId)) {
      return [];
    }

    const items = await callForQuery(
      context,
      async (options) =>
        await orpc.planItems.list({ serviceTypeId, planId }, options)
    );
    writeCachedPlanItems(serviceTypeId, planId, items);
    return items;
  },
  staleTime: PLAN_ITEMS_STALE_TIME_MS,
});

export const usePlanItems = (
  serviceTypeId: string | null,
  planId: string | null
) => {
  const queryKey = queryKeys.planItems(serviceTypeId, planId);
  const readCachedItems = useCallback(
    () => readCachedPlanItems(serviceTypeId, planId),
    [planId, serviceTypeId]
  );
  useHydrateQueryFromCache(queryKey, readCachedItems);

  return useQuery<PlanItem[]>({
    ...createPlanItemsQueryOptions(serviceTypeId, planId),
    queryKey,
    enabled: isNonEmptyString(serviceTypeId) && isNonEmptyString(planId),
  });
};
