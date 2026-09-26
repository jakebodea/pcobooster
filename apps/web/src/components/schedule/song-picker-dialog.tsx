import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type { SongCatalogEntry } from "@pcobooster/planning-center-models/types";
import { useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { startTransition, useDeferredValue, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { LoadingBar } from "@/components/ui/loading-bar";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import { createSongOptionsQueryOptions } from "@/hooks/use-song-options";
import { useSongSearch } from "@/hooks/use-song-search";
import { isQueryFresh } from "@/lib/intent-prefetch";
import { speculativeQuery } from "@/lib/request-priority";
import { formatSongLastScheduled } from "@/lib/song-catalog-client";

interface SongPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceTypeId: string | null;
  onSelectSong: (song: SongCatalogEntry) => Promise<void> | void;
  pendingSongId?: string | null;
}

export const SongPickerDialog = ({
  open,
  onOpenChange,
  serviceTypeId,
  onSelectSong,
  pendingSongId = null,
}: SongPickerDialogProps) => {
  const queryClient = useQueryClient();
  const orgTimeZone = useOrganizationTimeZone();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const {
    data: songs = [],
    isLoading,
    isFetching,
  } = useSongSearch(deferredQuery);
  const showResults = deferredQuery.trim().length > 0;
  const showInitialLoading = showResults && isLoading && songs.length === 0;
  const showRefreshing = showResults && isFetching && songs.length > 0;
  const { getIntentProps: getSongIntentProps } = useIntentPrefetch<string>({
    keyOf: (songId) => songId,
    isFresh: (songId) => {
      if (!isNonEmptyString(serviceTypeId)) {
        return true;
      }
      const options = createSongOptionsQueryOptions(songId, serviceTypeId);
      return isQueryFresh(queryClient, options.queryKey, options.staleTime);
    },
    prefetch: async (songId) => {
      if (!isNonEmptyString(serviceTypeId)) {
        return;
      }
      await queryClient.query(
        speculativeQuery(createSongOptionsQueryOptions(songId, serviceTypeId))
      );
    },
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        desktopClassName="max-w-2xl"
        mobileClassName="max-h-[90svh]"
      >
        <ResponsiveDialogHeader className="text-left">
          <ResponsiveDialogTitle>Add Song</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="flex min-h-0 flex-1 flex-col max-md:px-3 max-md:pt-3">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search songs, writers, or themes..."
              value={query}
              onValueChange={setQuery}
            />
            <LoadingBar active={showRefreshing} className="-mt-0.5" />
            <CommandList className="max-h-[420px]">
              {showInitialLoading ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton
                      key={index}
                      variant="control"
                      className="h-20 w-full"
                    />
                  ))}
                </div>
              ) : null}
              {showResults && !showInitialLoading ? (
                <>
                  <CommandEmpty>No songs matched that search.</CommandEmpty>
                  <div
                    className="stale-while-busy space-y-2 p-3"
                    aria-busy={showRefreshing}
                  >
                    {songs.map((song) => {
                      const lastScheduledLabel = formatSongLastScheduled(
                        song.lastScheduledAt,
                        orgTimeZone
                      );

                      return (
                        <CommandItem
                          key={song.id}
                          value={[song.title, song.author, song.themes]
                            .filter(Boolean)
                            .join(" ")}
                          disabled={pendingSongId === song.id}
                          className="items-start"
                          {...getSongIntentProps(song.id)}
                          onSelect={() => {
                            startTransition(async () => {
                              await onSelectSong(song);
                            });
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">
                              {song.title}
                            </p>
                            {song.author ? (
                              <p className="text-muted-foreground truncate text-xs">
                                {song.author}
                              </p>
                            ) : null}
                            {lastScheduledLabel !== null &&
                            lastScheduledLabel !== "" ? (
                              <p className="text-muted-foreground mt-2 text-xs">
                                Last scheduled {lastScheduledLabel}
                              </p>
                            ) : null}
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              {song.themes
                                .split(",")
                                .map((theme) => theme.trim())
                                .filter(Boolean)
                                .slice(0, 3)
                                .map((theme) => (
                                  <Badge key={theme} variant="outline">
                                    {theme}
                                  </Badge>
                                ))}
                            </div>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </div>
                </>
              ) : null}
              {showResults ? null : (
                <div className="text-muted-foreground flex min-h-[240px] flex-col items-center justify-center gap-2 px-6 py-10 text-center text-sm">
                  <Search className="size-8 opacity-50" />
                  <p>Start typing to search the song catalog.</p>
                </div>
              )}
            </CommandList>
          </Command>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
};
