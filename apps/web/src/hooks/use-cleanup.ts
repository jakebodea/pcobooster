import { CLEANUP_PEOPLE_BATCH_SIZE } from "@pcobooster/contracts/cleanup";
import type {
  CleanupPersonActivity,
  CleanupStaleMonths,
} from "@pcobooster/contracts/cleanup";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { assembleCleanupPeople, planCleanupPeopleBatches } from "@/lib/cleanup";
import { queryKeys } from "@/lib/query-keys";
import { orpc } from "@/orpc-client";

const CLEANUP_STALE_TIME_MS = 10 * 60 * 1000;
/** Batches in flight at once; each is its own Worker invocation and budget. */
const PEOPLE_BATCH_CONCURRENCY = 2;

export const useCleanupSongs = (
  staleMonths: CleanupStaleMonths,
  enabled: boolean
) =>
  useQuery({
    queryKey: queryKeys.cleanupSongs(staleMonths),
    queryFn: async ({ signal }) =>
      await orpc.cleanup.songs({ staleMonths }, { signal }),
    staleTime: CLEANUP_STALE_TIME_MS,
    enabled,
  });

/** Follows `deferredPersonIds` until every person in the batch is checked. */
const fetchPeopleActivity = async (
  staleMonths: CleanupStaleMonths,
  personIds: readonly string[],
  signal: AbortSignal
): Promise<CleanupPersonActivity[]> => {
  const batch = await orpc.cleanup.peopleActivity(
    { staleMonths, personIds: [...personIds] },
    { signal }
  );
  const deferred = batch.deferredPersonIds;
  if (deferred.length === 0) {
    return batch.people;
  }
  if (deferred.length >= personIds.length) {
    throw new Error("Cleanup people check made no progress.");
  }
  return [
    ...batch.people,
    ...(await fetchPeopleActivity(staleMonths, deferred, signal)),
  ];
};

const isSettled = (
  queryClient: QueryClient,
  staleMonths: CleanupStaleMonths,
  personIds: readonly string[]
) => {
  const state = queryClient.getQueryState(
    queryKeys.cleanupPeopleActivity(staleMonths, personIds)
  );
  return (
    state !== undefined &&
    state.status !== "pending" &&
    state.fetchStatus !== "fetching"
  );
};

/**
 * Reads the team roster, then checks everyone's schedules in small batches,
 * a few at a time, so the list fills in as each batch returns.
 */
export const useCleanupPeople = (
  staleMonths: CleanupStaleMonths,
  enabled: boolean
) => {
  const queryClient = useQueryClient();
  const rosterQuery = useQuery({
    queryKey: queryKeys.cleanupPeopleRoster(),
    queryFn: async ({ signal }) =>
      await orpc.cleanup.peopleRoster(undefined, { signal }),
    staleTime: CLEANUP_STALE_TIME_MS,
    enabled,
  });
  const roster = rosterQuery.data;
  const batches = useMemo(
    () => planCleanupPeopleBatches(roster, CLEANUP_PEOPLE_BATCH_SIZE),
    [roster]
  );
  const batchQueries = useQueries({
    queries: batches.map((personIds, index) => {
      const gate = batches[index - PEOPLE_BATCH_CONCURRENCY];
      return {
        queryKey: queryKeys.cleanupPeopleActivity(staleMonths, personIds),
        queryFn: async ({ signal }: { signal: AbortSignal }) =>
          await fetchPeopleActivity(staleMonths, personIds, signal),
        staleTime: CLEANUP_STALE_TIME_MS,
        // Start a batch once the one `concurrency` places ahead has settled.
        enabled:
          enabled &&
          (gate === undefined || isSettled(queryClient, staleMonths, gate)),
      };
    }),
  });
  const activities = useMemo(
    () => batchQueries.flatMap((query) => query.data ?? []),
    [batchQueries]
  );
  const result = useMemo(
    () => (roster ? assembleCleanupPeople(roster, activities) : undefined),
    [activities, roster]
  );
  const failedBatches = batchQueries.filter((query) => query.isError);
  const retryFailed = useCallback(() => {
    for (const query of failedBatches) {
      void query.refetch();
    }
  }, [failedBatches]);

  return {
    result,
    isRosterLoading: rosterQuery.isPending,
    isRosterError: rosterQuery.isError && !roster,
    isChecking: batchQueries.some((query) => query.isPending),
    isFetching:
      rosterQuery.isFetching || batchQueries.some((query) => query.isFetching),
    failedBatchCount: failedBatches.length,
    retryFailed,
  };
};
