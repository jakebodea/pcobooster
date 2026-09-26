import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { QueryFunctionContext } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useBrowserStorage } from "@/hooks/use-browser-storage";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { useMyScheduledPlans } from "@/hooks/use-my-scheduled-plans";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import { createPlanItemsQueryOptions } from "@/hooks/use-plan-items";
import { useServiceTypes } from "@/hooks/use-service-types";
import { createTeamPositionsQueryOptions } from "@/hooks/use-team-positions";
import { isQueryFresh } from "@/lib/intent-prefetch";
import { hydrateQueryFromCache } from "@/lib/query-cache-hydration";
import { queryKeys } from "@/lib/query-keys";
import { speculativeQuery } from "@/lib/request-priority";
import {
  readCachedPlansEntry,
  writeCachedPlans,
} from "@/lib/schedule-catalog-cache";
import { planWorkspaceLink } from "@/lib/schedule-navigation";
import type {
  DateRangeFilter,
  ServicePlanRow,
  ServicePlanTableSelectorProps,
} from "@/lib/service-plan-selection";
import {
  formatPlanDate,
  isInDateWindow,
  parsePlanDate,
  readStoredServiceTypeIds,
  SERVICE_TYPE_FILTER_STORAGE_KEY,
} from "@/lib/service-plan-selection";
import { orpc } from "@/orpc-client";

export const useServicePlanSelection = ({
  selectedServiceTypeId,
  onSelect,
}: ServicePlanTableSelectorProps) => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const cachedPlanWritesRef = useRef(new Map<string, number>());
  const orgTimeZone = useOrganizationTimeZone();
  const { data: serviceTypes, isLoading: serviceTypesLoading } =
    useServiceTypes();
  const [searchValue, setSearchValue] = useState("");
  const deferredSearchValue = useDeferredValue(searchValue);
  const [storedIds, setStoredIds] = useBrowserStorage(
    SERVICE_TYPE_FILTER_STORAGE_KEY
  );
  const selectedServiceTypeIds = useMemo(
    () => readStoredServiceTypeIds(storedIds),
    [storedIds]
  );
  const setSelectedServiceTypeIds = useCallback(
    (ids: string[]) => {
      setStoredIds(JSON.stringify(ids));
    },
    [setStoredIds]
  );
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>("60");

  const allServiceTypeIds = useMemo(
    () => (serviceTypes ?? []).map((serviceType) => serviceType.id),
    [serviceTypes]
  );
  const validServiceTypeIdSet = useMemo(
    () => new Set(allServiceTypeIds),
    [allServiceTypeIds]
  );
  const effectiveSelectedServiceTypeIds = useMemo(() => {
    if (isNonEmptyString(selectedServiceTypeId)) {
      return validServiceTypeIdSet.has(selectedServiceTypeId)
        ? [selectedServiceTypeId]
        : [];
    }

    if (selectedServiceTypeIds === null) {
      return allServiceTypeIds;
    }

    return selectedServiceTypeIds.filter((id) => validServiceTypeIdSet.has(id));
  }, [
    allServiceTypeIds,
    selectedServiceTypeId,
    selectedServiceTypeIds,
    validServiceTypeIdSet,
  ]);

  const selectedServiceTypeIdSet = useMemo(
    () => new Set(effectiveSelectedServiceTypeIds),
    [effectiveSelectedServiceTypeIds]
  );

  const planQueryOptions = useMemo(
    () =>
      (serviceTypes ?? []).map((serviceType) => ({
        queryKey: queryKeys.plans(serviceType.id),
        queryFn: async ({ signal }: QueryFunctionContext) =>
          await orpc.catalog.plans(
            { serviceTypeId: serviceType.id },
            { signal }
          ),
        staleTime: 5 * 60 * 1000,
        enabled: !!serviceTypes && selectedServiceTypeIdSet.has(serviceType.id),
      })),
    [selectedServiceTypeIdSet, serviceTypes]
  );

  const planQueries = useQueries({
    queries: planQueryOptions,
  });

  useEffect(() => {
    if (!serviceTypes) {
      return;
    }

    for (const serviceType of serviceTypes) {
      if (!selectedServiceTypeIdSet.has(serviceType.id)) {
        continue;
      }

      hydrateQueryFromCache(queryClient, queryKeys.plans(serviceType.id), () =>
        readCachedPlansEntry(serviceType.id)
      );
    }
  }, [queryClient, selectedServiceTypeIdSet, serviceTypes]);

  const rows = useMemo(() => {
    if (!serviceTypes) {
      return [];
    }

    const flattened: ServicePlanRow[] = [];

    for (const [index, serviceType] of serviceTypes.entries()) {
      if (!selectedServiceTypeIdSet.has(serviceType.id)) {
        continue;
      }

      const plans = planQueries[index]?.data ?? [];
      for (const plan of plans) {
        const sortDate = parsePlanDate(plan.sortDate);
        if (!sortDate) {
          continue;
        }

        flattened.push({
          serviceTypeId: serviceType.id,
          serviceTypeName: serviceType.name,
          serviceTypeSequence: serviceType.sequence,
          planId: plan.id,
          planTitle: plan.title,
          seriesTitle: plan.seriesTitle ?? null,
          seriesId: plan.seriesId ?? null,
          sortDate,
        });
      }
    }

    return flattened.toSorted((a, b) => {
      const byDate = a.sortDate.getTime() - b.sortDate.getTime();
      if (byDate !== 0) {
        return byDate;
      }

      const byServiceOrder = a.serviceTypeSequence - b.serviceTypeSequence;
      if (byServiceOrder !== 0) {
        return byServiceOrder;
      }

      const byServiceName = a.serviceTypeName.localeCompare(b.serviceTypeName);
      if (byServiceName !== 0) {
        return byServiceName;
      }

      return a.planTitle.localeCompare(b.planTitle);
    });
  }, [planQueries, selectedServiceTypeIdSet, serviceTypes]);

  const planIdsForLookup = useMemo(
    () => [...new Set(rows.map((row) => row.planId))],
    [rows]
  );
  const { data: myScheduledPlans, isLoading: myScheduledPlansLoading } =
    useMyScheduledPlans(planIdsForLookup);
  const myScheduledPlanIdSet = useMemo(
    () => new Set(myScheduledPlans?.planIds),
    [myScheduledPlans?.planIds]
  );

  const plansLoading = planQueries.some((query) => query.isLoading);
  const errorMessage = planQueries.find((query) => query.isError)?.error;
  const isInitialLoading =
    serviceTypesLoading || (plansLoading && rows.length === 0);

  const myScheduledRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          myScheduledPlanIdSet.has(row.planId) &&
          isInDateWindow(row.sortDate, dateRangeFilter, orgTimeZone)
      ),
    [dateRangeFilter, myScheduledPlanIdSet, orgTimeZone, rows]
  );

  const visibleRows = useMemo(() => {
    const normalizedSearch = deferredSearchValue.trim().toLowerCase();

    return rows.filter((row) => {
      if (selectedServiceTypeIdSet.size === 0) {
        return false;
      }
      if (!selectedServiceTypeIdSet.has(row.serviceTypeId)) {
        return false;
      }

      if (!isInDateWindow(row.sortDate, dateRangeFilter, orgTimeZone)) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        row.serviceTypeName,
        row.planTitle,
        row.seriesTitle ?? "",
        formatPlanDate(row.sortDate, orgTimeZone),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [
    dateRangeFilter,
    deferredSearchValue,
    orgTimeZone,
    rows,
    selectedServiceTypeIdSet,
  ]);

  useEffect(() => {
    if (!serviceTypes) {
      return;
    }
    for (const [index, serviceType] of serviceTypes.entries()) {
      const query = planQueries[index];
      const plans = query?.data;
      if (!plans) {
        continue;
      }
      const { dataUpdatedAt } = query;
      if (cachedPlanWritesRef.current.get(serviceType.id) === dataUpdatedAt) {
        continue;
      }
      writeCachedPlans(serviceType.id, plans);
      cachedPlanWritesRef.current.set(serviceType.id, dataUpdatedAt);
    }
  }, [planQueries, serviceTypes]);

  /** On hover: the positions list the plan opens on, and the Plan tab's items. */
  const prefetchPlanData = useCallback(
    async (row: ServicePlanRow) => {
      // Warm the route too, so its code is ready before the click.
      void router.preloadRoute(
        planWorkspaceLink(row.serviceTypeId, row.planId)
      );
      await Promise.allSettled([
        queryClient.query(
          speculativeQuery(
            createTeamPositionsQueryOptions(
              row.serviceTypeId,
              row.planId,
              row.seriesId
            )
          )
        ),
        queryClient.query(
          speculativeQuery(
            createPlanItemsQueryOptions(row.serviceTypeId, row.planId)
          )
        ),
      ]);
    },
    [queryClient, router]
  );
  const isPlanDataFresh = useCallback(
    (row: ServicePlanRow) => {
      const teamPositions = createTeamPositionsQueryOptions(
        row.serviceTypeId,
        row.planId,
        row.seriesId
      );
      const planItems = createPlanItemsQueryOptions(
        row.serviceTypeId,
        row.planId
      );
      return (
        isQueryFresh(
          queryClient,
          teamPositions.queryKey,
          teamPositions.staleTime
        ) && isQueryFresh(queryClient, planItems.queryKey, planItems.staleTime)
      );
    },
    [queryClient]
  );
  const { getIntentProps: getPlanIntentProps, cancelIntent } =
    useIntentPrefetch<ServicePlanRow>({
      keyOf: (row) => `${row.serviceTypeId}:${row.planId}`,
      isFresh: isPlanDataFresh,
      prefetch: prefetchPlanData,
    });
  /**
   * Opening a plan lands on its positions list, so that starts loading at the click, ahead of
   * the route's code. The workspace warms the rest in the speculative lane once it has loaded.
   */
  const loadOpenedPlan = useCallback(
    async (row: ServicePlanRow) => {
      try {
        await queryClient.query(
          createTeamPositionsQueryOptions(
            row.serviceTypeId,
            row.planId,
            row.seriesId
          )
        );
      } catch {
        // The workspace's own query owns any visible loading error.
      }
    },
    [queryClient]
  );

  const handleSelectRow = useCallback(
    (row: ServicePlanRow) => {
      cancelIntent();
      void loadOpenedPlan(row);
      onSelect({
        serviceTypeId: row.serviceTypeId,
        planId: row.planId,
      });
    },
    [cancelIntent, loadOpenedPlan, onSelect]
  );

  return {
    searchValue,
    setSearchValue,
    serviceTypes,
    effectiveSelectedServiceTypeIds,
    setSelectedServiceTypeIds,
    dateRangeFilter,
    setDateRangeFilter,
    isInitialLoading,
    myScheduledPlansLoading,
    errorMessage,
    visibleRows,
    myScheduledRows,
    myScheduledPlanIdSet,
    handleSelectRow,
    getPlanIntentProps,
    orgTimeZone,
  };
};
