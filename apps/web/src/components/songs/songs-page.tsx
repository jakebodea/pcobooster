import type { SongCatalogEntry } from "@pcobooster/planning-center-models/types";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Plus, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { AddSongDialog } from "@/components/songs/add-song-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { LoadingBar } from "@/components/ui/loading-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrowserStorage } from "@/hooks/use-browser-storage";
import { createChordChartSongQueryOptions } from "@/hooks/use-chord-chart-song";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import type { GetIntentPrefetchProps } from "@/hooks/use-intent-prefetch";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import { useSongSearch } from "@/hooks/use-song-search";
import { isQueryFresh } from "@/lib/intent-prefetch";
import {
  RECENT_SONGS_STORAGE_KEY,
  matchRecentSongs,
  parseRecentSongs,
} from "@/lib/recent-songs";
import type { RecentSong } from "@/lib/recent-songs";
import { speculativeQuery } from "@/lib/request-priority";
import { formatSongLastScheduled } from "@/lib/song-catalog-client";

export const SongsPageSkeleton = () => (
  <main className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4" aria-busy>
    <Skeleton variant="control" className="h-10 w-full" />
    {Array.from({ length: 6 }, (_, row) => `row-${row}`).map((row) => (
      <Skeleton key={row} variant="control" className="h-14 w-full" />
    ))}
  </main>
);

interface SongRow {
  id: string;
  title: string;
  detail: string;
}

const SongList = ({
  label,
  rows,
  getIntentProps,
}: {
  label?: string;
  rows: readonly SongRow[];
  getIntentProps: GetIntentPrefetchProps<string>;
}) => (
  <section className="flex flex-col gap-1" aria-label={label ?? "Songs"}>
    {label === undefined ? null : (
      <h2 className="text-muted-foreground text-xs font-medium">{label}</h2>
    )}
    <ul className="divide-border/60 flex flex-col divide-y">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            to="/songs/$songId"
            params={{ songId: row.id }}
            className="hover:bg-muted/60 focus-visible:bg-muted/60 -mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 outline-none"
            {...getIntentProps(row.id)}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.title}</p>
              {row.detail === "" ? null : (
                <p className="text-muted-foreground truncate text-xs">
                  {row.detail}
                </p>
              )}
            </div>
            <ChevronRight
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden
            />
          </Link>
        </li>
      ))}
    </ul>
  </section>
);

const SearchMessages = ({
  query,
  failed,
  nothingFound,
  onAdd,
}: {
  query: string;
  failed: boolean;
  nothingFound: boolean;
  onAdd: () => void;
}) => {
  if (failed) {
    return (
      <p className="text-muted-foreground text-sm">
        Song search failed. Try again.
      </p>
    );
  }
  if (!nothingFound) {
    return null;
  }
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No songs matched</EmptyTitle>
        <EmptyDescription>
          {`Add “${query}” to Planning Center to start its chart.`}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onAdd}>
          <Plus aria-hidden />
          Add song
        </Button>
      </EmptyContent>
    </Empty>
  );
};

const useSongIntentPrefetch = () => {
  const queryClient = useQueryClient();
  return useIntentPrefetch<string>({
    keyOf: (songId) => songId,
    isFresh: (songId) => {
      const options = createChordChartSongQueryOptions(songId);
      return isQueryFresh(queryClient, options.queryKey, options.staleTime);
    },
    prefetch: async (songId) => {
      await queryClient.query(
        speculativeQuery(createChordChartSongQueryOptions(songId))
      );
    },
  });
};

interface SongRows {
  /** What a search lists: matching recent songs, then catalog results. */
  readonly rows: SongRow[];
  readonly recentMatches: SongRow[];
}

/**
 * Search results after the recent songs that match. Songs added in the last hour are not
 * in the cached catalog yet, so recent ones fill in; with no query, only recent ones show.
 */
const buildSongRows = (
  songs: readonly SongCatalogEntry[],
  recentSongs: readonly RecentSong[],
  query: string,
  orgTimeZone: string
): SongRows => {
  const found: SongRow[] = songs.map((song) => ({
    id: song.id,
    title: song.title,
    detail: [
      song.author,
      formatSongLastScheduled(song.lastScheduledAt, orgTimeZone),
    ]
      .filter((part) => part !== null && part !== "")
      .join(" · "),
  }));
  const foundIds = new Set(found.map((row) => row.id));
  const recentMatches: SongRow[] = [];
  for (const song of query === ""
    ? recentSongs
    : matchRecentSongs(recentSongs, query)) {
    if (!foundIds.has(song.id)) {
      recentMatches.push({
        id: song.id,
        title: song.title,
        detail: song.author,
      });
    }
  }
  return {
    rows: query === "" ? [] : [...recentMatches, ...found],
    recentMatches,
  };
};

/** Finds a song in the Planning Center library, or adds one, to write its chord chart. */
export const SongsPage = () => {
  const orgTimeZone = useOrganizationTimeZone();
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const trimmedQuery = deferredQuery.trim();
  const {
    data: songs = [],
    isLoading,
    isFetching,
    isError,
  } = useSongSearch(deferredQuery);
  const { getIntentProps } = useSongIntentPrefetch();
  const [storedRecentSongs] = useBrowserStorage(RECENT_SONGS_STORAGE_KEY);
  const recentSongs = useMemo(
    () => parseRecentSongs(storedRecentSongs),
    [storedRecentSongs]
  );
  const searching = trimmedQuery.length > 0;

  const { rows, recentMatches } = buildSongRows(
    songs,
    recentSongs,
    trimmedQuery,
    orgTimeZone
  );
  const nothingFound = searching && !isLoading && !isError && rows.length === 0;

  const openAdd = () => {
    setAddOpen(true);
  };

  return (
    <main className="bg-background flex flex-1 flex-col md:min-h-0 md:overflow-y-auto">
      <div className="pb-safe-4 mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pt-1 md:py-4">
        <header className="flex items-center justify-between gap-3">
          <div className="max-md:sr-only">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
              Songs
            </h1>
            <p className="text-muted-foreground text-sm">
              Write and preview chord charts, then save them to Planning Center.
            </p>
          </div>
          <Button size="sm" className="max-md:ml-auto" onClick={openAdd}>
            <Plus aria-hidden />
            Add song
          </Button>
        </header>
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search songs, writers, or themes"
            aria-label="Search songs"
          />
        </InputGroup>
        <LoadingBar active={searching && isFetching && songs.length > 0} />
        {!searching && recentMatches.length > 0 ? (
          <SongList
            label="Recent"
            rows={recentMatches}
            getIntentProps={getIntentProps}
          />
        ) : null}
        {!searching && recentMatches.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Find a song</EmptyTitle>
              <EmptyDescription>
                Search your Planning Center library to open its chord chart, or
                add a new song.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {searching && isLoading && rows.length === 0 ? (
          <SongsPageSkeleton />
        ) : null}
        <SearchMessages
          query={trimmedQuery}
          failed={searching && isError}
          nothingFound={nothingFound}
          onAdd={openAdd}
        />
        {rows.length > 0 ? (
          <SongList rows={rows} getIntentProps={getIntentProps} />
        ) : null}
      </div>
      <AddSongDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        initialTitle={trimmedQuery}
      />
    </main>
  );
};
