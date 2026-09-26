import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type { SongOptionSet } from "@pcobooster/planning-center-models/types";
import { useQuery } from "@tanstack/react-query";
import type { QueryFunctionContext } from "@tanstack/react-query";
import { useCallback } from "react";

import { useHydrateQueryFromCache } from "@/lib/query-cache-hydration";
import { queryKeys } from "@/lib/query-keys";
import { callForQuery } from "@/lib/request-priority";
import {
  readCachedSongOptions,
  writeCachedSongOptions,
} from "@/lib/song-options-cache";
import { orpc } from "@/orpc-client";

export const createSongOptionsQueryOptions = (
  songId: string | null,
  serviceTypeId: string | null
) => ({
  queryKey: queryKeys.songOptions(songId, serviceTypeId),
  queryFn: async (context: QueryFunctionContext) => {
    if (!isNonEmptyString(songId) || !isNonEmptyString(serviceTypeId)) {
      return null;
    }

    const optionSet = await callForQuery(
      context,
      async (options) =>
        await orpc.songs.options({ songId, serviceTypeId }, options)
    );
    writeCachedSongOptions(songId, serviceTypeId, optionSet);
    return optionSet;
  },
  placeholderData: (previousOptions: SongOptionSet | null | undefined) =>
    previousOptions,
  staleTime: 5 * 60 * 1000,
});

export const useSongOptions = (
  songId: string | null,
  serviceTypeId: string | null
) => {
  const queryKey = queryKeys.songOptions(songId, serviceTypeId);
  const readCachedOptions = useCallback(
    () => readCachedSongOptions(songId, serviceTypeId),
    [serviceTypeId, songId]
  );
  useHydrateQueryFromCache(queryKey, readCachedOptions);

  return useQuery<SongOptionSet | null>({
    ...createSongOptionsQueryOptions(songId, serviceTypeId),
    queryKey,
    enabled: isNonEmptyString(songId) && isNonEmptyString(serviceTypeId),
  });
};
