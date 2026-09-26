import type { PeopleDashboardPersonDetail } from "@pcobooster/contracts/people-schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryFunctionContext } from "@tanstack/react-query";
import { useCallback } from "react";

import { readPeopleDashboardFromQueryCache } from "@/hooks/use-people-dashboard";
import {
  readCachedPeopleDashboardPerson,
  writeCachedPeopleDashboardPerson,
} from "@/lib/people-dashboard-cache";
import { getCachedPeopleDashboardPersonDetail } from "@/lib/people-dashboard-person-placeholder";
import { useHydrateQueryFromCache } from "@/lib/query-cache-hydration";
import { queryKeys } from "@/lib/query-keys";
import { callForQuery } from "@/lib/request-priority";
import { orpc } from "@/orpc-client";

export const createPeopleDashboardPersonQueryOptions = (
  personId: string,
  month: string | null
) => ({
  queryKey: queryKeys.peopleDashboardPerson(personId, month),
  queryFn: async (context: QueryFunctionContext) => {
    const detail = await callForQuery(
      context,
      async (options) =>
        await orpc.people.dashboardPerson(
          {
            personId,
            month: month !== null && month !== "" ? month : undefined,
          },
          options
        )
    );
    writeCachedPeopleDashboardPerson(personId, month, detail);
    return detail;
  },
  staleTime: 2 * 60 * 1000,
});

export const usePeopleDashboardPerson = (
  personId: string,
  month: string | null
) => {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.peopleDashboardPerson(personId, month);
  const readCachedPerson = useCallback(
    () => readCachedPeopleDashboardPerson(personId, month),
    [month, personId]
  );
  useHydrateQueryFromCache(queryKey, readCachedPerson);

  return useQuery<PeopleDashboardPersonDetail>({
    ...createPeopleDashboardPersonQueryOptions(personId, month),
    queryKey,
    // Seed from the roster when it covers this month. Otherwise keep this
    // person on screen (dimmed) so paging months never blanks the page.
    placeholderData: (previousDetail) => {
      const dashboards = [readPeopleDashboardFromQueryCache(queryClient)];
      return (
        getCachedPeopleDashboardPersonDetail(dashboards, personId, month) ??
        (previousDetail?.person.id === personId ? previousDetail : undefined) ??
        getCachedPeopleDashboardPersonDetail(dashboards, personId, null)
      );
    },
  });
};
