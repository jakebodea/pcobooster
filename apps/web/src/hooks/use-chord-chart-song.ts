import { ORPCError } from "@orpc/client";
import type {
  ChordChartArrangement,
  ChordChartCreateInput,
  ChordChartPdf,
  ChordChartSongCreateInput,
  ChordChartSongOutput,
  ChordChartUpdateInput,
  LyricsSearchResult,
} from "@pcobooster/contracts/chord-charts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryFunctionContext } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import { callForQuery } from "@/lib/request-priority";
import { orpc } from "@/orpc-client";

/** Editing starts from what Services holds, so the chart is never read from a stale copy. */
export const createChordChartSongQueryOptions = (songId: string) => ({
  queryKey: queryKeys.chordChartSong(songId),
  queryFn: async (context: QueryFunctionContext) =>
    await callForQuery(
      context,
      async (options) => await orpc.chordCharts.song({ songId }, options)
    ),
  staleTime: 30 * 1000,
});

export const useChordChartSong = (songId: string) =>
  useQuery<ChordChartSongOutput>(createChordChartSongQueryOptions(songId));

const replaceArrangement = (
  current: ChordChartSongOutput | undefined,
  arrangement: ChordChartArrangement
): ChordChartSongOutput | undefined => {
  if (current === undefined) {
    return current;
  }
  const exists = current.arrangements.some(
    (candidate) => candidate.id === arrangement.id
  );
  return {
    ...current,
    arrangements: exists
      ? current.arrangements.map((candidate) =>
          candidate.id === arrangement.id ? arrangement : candidate
        )
      : [...current.arrangements, arrangement],
  };
};

export const isChordChartConflict = (error: Error): boolean =>
  error instanceof ORPCError && error.code === "CONFLICT";

/** The API's safe message, or a generic one for network and unexpected failures. */
export const chordChartErrorMessage = (error: Error): string =>
  error instanceof ORPCError && error.message !== ""
    ? error.message
    : "Planning Center did not save the chart. Try again.";

export const useSaveChordChart = (songId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChordChartUpdateInput) =>
      await orpc.chordCharts.update(input),
    onSuccess: (arrangement) => {
      queryClient.setQueryData<ChordChartSongOutput>(
        queryKeys.chordChartSong(songId),
        (current) => replaceArrangement(current, arrangement)
      );
    },
  });
};

export const useCreateChordChart = (songId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChordChartCreateInput) =>
      await orpc.chordCharts.create(input),
    onSuccess: (arrangement) => {
      queryClient.setQueryData<ChordChartSongOutput>(
        queryKeys.chordChartSong(songId),
        (current) => replaceArrangement(current, arrangement)
      );
    },
  });
};

/** Lyrics searches reach an outside service, so they run only on submit and stay cached. */
export const useLyricsSearch = (query: string, enabled: boolean) =>
  useQuery<LyricsSearchResult[]>({
    queryKey: queryKeys.lyricsSearch(query),
    queryFn: async ({ signal }: QueryFunctionContext) =>
      await orpc.chordCharts.lyricsSearch({ query }, { signal }),
    enabled: enabled && query.length >= 2,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

/** Adds a song to Planning Center and primes the editor with it. */
export const useCreateSong = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChordChartSongCreateInput) =>
      await orpc.chordCharts.createSong(input),
    onSuccess: (created) => {
      queryClient.setQueryData(
        queryKeys.chordChartSong(created.song.id),
        created
      );
    },
  });
};

export interface ChordChartPdfTarget {
  readonly songId: string;
  readonly arrangementId: string;
  /** An arrangement key's chord chart, or null for the lyrics sheet. */
  readonly keyId: string | null;
  /** The saved version to render; Services renders only what is saved. */
  readonly updatedAt: string | null;
}

/** Planning Center's own PDF of the saved chart; a save changes the key and renders again. */
export const useChordChartPdf = (target: ChordChartPdfTarget) =>
  useQuery<ChordChartPdf>({
    queryKey: queryKeys.chordChartPdf(
      target.arrangementId,
      target.keyId,
      target.updatedAt
    ),
    queryFn: async ({ signal }: QueryFunctionContext) =>
      await orpc.chordCharts.pdf(
        {
          songId: target.songId,
          arrangementId: target.arrangementId,
          keyId: target.keyId ?? undefined,
        },
        { signal }
      ),
    staleTime: Number.POSITIVE_INFINITY,
    // The last render stays up while the next save renders.
    placeholderData: (previous) => previous,
    retry: false,
  });
