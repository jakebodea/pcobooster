import type {
  CleanupSong,
  CleanupStaleMonths,
} from "@pcobooster/contracts/cleanup";
import { DEFAULT_CLEANUP_STALE_MONTHS } from "@pcobooster/contracts/cleanup";
import { formatCalendarDateLabel } from "@pcobooster/planning-center-models/calendar";
import { ExternalLink, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Empty,
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCleanupPeople, useCleanupSongs } from "@/hooks/use-cleanup";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import type { CleanupRosterPerson } from "@/lib/cleanup";
import {
  cleanupStaleMonthOptions,
  parseCleanupStaleMonths,
  planningCenterPersonUrl,
  planningCenterSongUrl,
} from "@/lib/cleanup";

type CleanupView = "songs" | "people";

const countFormat = new Intl.NumberFormat("en-US");

const matchesQuery = (fields: readonly string[], query: string) =>
  !query || fields.join(" ").toLowerCase().includes(query);

const formatCount = (count: number, singular: string, plural: string) =>
  `${countFormat.format(count)} ${count === 1 ? singular : plural}`;

const OpenInPlanningCenter = ({
  href,
  label,
}: {
  href: string;
  label: string;
}) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={label}
    className={buttonVariants({
      variant: "ghost",
      size: "xs",
      className: "text-muted-foreground shrink-0",
    })}
  >
    <span className="max-sm:sr-only">Open in Planning Center</span>
    <ExternalLink aria-hidden />
  </a>
);

const ListSkeleton = () => (
  <div
    className="border-border/40 flex flex-col gap-3 rounded-xl border p-4"
    aria-busy
    aria-label="Loading suggestions"
  >
    {Array.from({ length: 8 }, (_, index) => (
      <div key={index} className="flex items-center gap-3">
        <Skeleton variant="text" className="h-4 w-48" />
        <Skeleton variant="text" className="ml-auto h-3 w-28" />
      </div>
    ))}
  </div>
);

const NothingToClean = ({ description }: { description: string }) => (
  <Empty>
    <EmptyHeader>
      <EmptyTitle>Nothing to clean up</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const LoadFailed = ({ what }: { what: string }) => (
  <div className="border-border/40 text-muted-foreground rounded-lg border px-4 py-8 text-sm">
    {what} failed to load. Refresh and try again.
  </div>
);

const SongRow = ({
  song,
  orgTimeZone,
}: {
  song: CleanupSong;
  orgTimeZone: string;
}) => {
  const lastUsed = song.lastScheduledAt
    ? `Last scheduled ${formatCalendarDateLabel(song.lastScheduledAt, orgTimeZone, "monthDayYear")}`
    : "Never scheduled";
  const added = song.createdAt
    ? `Added ${formatCalendarDateLabel(song.createdAt, orgTimeZone, "monthYear")}`
    : null;
  return (
    <li className="flex min-h-12 items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {song.title || "Untitled song"}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {[song.author, added].filter(Boolean).join(" · ")}
        </p>
      </div>
      {song.lastScheduledAt ? (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums max-sm:hidden">
          {lastUsed}
        </span>
      ) : (
        <Badge variant="secondary">{lastUsed}</Badge>
      )}
      <OpenInPlanningCenter
        href={planningCenterSongUrl(song.id)}
        label={`Open ${song.title} in Planning Center`}
      />
    </li>
  );
};

const SongsSection = ({
  staleMonths,
  query,
}: {
  staleMonths: CleanupStaleMonths;
  query: string;
}) => {
  const orgTimeZone = useOrganizationTimeZone();
  const { data, isPending, isError, isFetching } = useCleanupSongs(
    staleMonths,
    true
  );
  const songs = useMemo(
    () =>
      (data?.songs ?? []).filter((song) =>
        matchesQuery([song.title, song.author], query)
      ),
    [data, query]
  );
  if (isError && !data) {
    return <LoadFailed what="Song suggestions" />;
  }
  if (isPending) {
    return <ListSkeleton />;
  }
  const cutoffLabel = formatCalendarDateLabel(
    new Date(data.cutoff),
    orgTimeZone,
    "monthDayYear"
  );
  const neverCount = data.songs.filter(
    (song) => song.lastScheduledAt === null
  ).length;
  return (
    <section className="flex flex-col gap-3" aria-label="Song suggestions">
      <LoadingBar active={isFetching} className="-my-1.5 shrink-0" />
      <p className="text-muted-foreground text-sm">
        {formatCount(data.songs.length, "song", "songs")} of{" "}
        {countFormat.format(data.scannedCount)} haven&apos;t been scheduled
        since {cutoffLabel}
        {neverCount > 0 ? `, including ${neverCount} never scheduled` : ""}.
        Hiding a song in Planning Center keeps its history but removes it from
        search.
      </p>
      {data.truncated ? (
        <p className="text-muted-foreground text-xs">
          Your library is large, so only the first{" "}
          {countFormat.format(data.scannedCount)} songs were checked.
        </p>
      ) : null}
      {songs.length === 0 ? (
        <NothingToClean
          description={
            query
              ? "No suggested songs match your search."
              : "Every song has been scheduled recently."
          }
        />
      ) : (
        <ul className="border-border/60 divide-border/60 divide-y rounded-xl border">
          {songs.map((song) => (
            <SongRow key={song.id} song={song} orgTimeZone={orgTimeZone} />
          ))}
        </ul>
      )}
    </section>
  );
};

const PersonRow = ({ person }: { person: CleanupRosterPerson }) => (
  <li className="flex min-h-12 items-center gap-3 px-3 py-2">
    <Avatar size="sm">
      {person.photoThumbnailUrl !== null && person.photoThumbnailUrl !== "" ? (
        <AvatarImage
          src={person.photoThumbnailUrl}
          alt={person.name}
          className="object-cover"
        />
      ) : null}
      <AvatarFallback>{person.initials}</AvatarFallback>
    </Avatar>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{person.name}</p>
      <p className="text-muted-foreground truncate text-xs">
        {person.teams.join(", ")}
      </p>
    </div>
    <OpenInPlanningCenter
      href={planningCenterPersonUrl(person.id)}
      label={`Open ${person.name} in Planning Center`}
    />
  </li>
);

const PeopleSection = ({
  staleMonths,
  query,
}: {
  staleMonths: CleanupStaleMonths;
  query: string;
}) => {
  const staleLabel =
    cleanupStaleMonthOptions.find((option) => option.value === staleMonths)
      ?.label ?? `${staleMonths} months`;
  const {
    result,
    isRosterLoading,
    isRosterError,
    isChecking,
    isFetching,
    failedBatchCount,
    retryFailed,
  } = useCleanupPeople(staleMonths, true);
  const people = useMemo(
    () =>
      (result?.stale ?? []).filter((person) =>
        matchesQuery([person.name, ...person.teams], query)
      ),
    [query, result]
  );
  if (isRosterError) {
    return <LoadFailed what="Team members" />;
  }
  if (isRosterLoading || !result) {
    return <ListSkeleton />;
  }
  const complete = result.checkedCount >= result.rosterCount;
  return (
    <section className="flex flex-col gap-3" aria-label="People suggestions">
      <LoadingBar active={isFetching} className="-my-1.5 shrink-0" />
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {complete
          ? `${formatCount(result.stale.length, "team member has", "team members have")} no schedules in the last ${staleLabel}, past or upcoming.`
          : `Checking schedules: ${result.checkedCount} of ${result.rosterCount} team members…`}{" "}
        Removing someone from a team, or archiving them, keeps their history.
      </p>
      {failedBatchCount > 0 ? (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-destructive">
            Some schedules failed to load.
          </span>
          <Button variant="outline" size="xs" onClick={retryFailed}>
            Retry
          </Button>
        </div>
      ) : null}
      {people.length === 0 && !isChecking ? (
        <NothingToClean
          description={
            query
              ? "No suggested people match your search."
              : "Everyone on a team has been scheduled recently."
          }
        />
      ) : null}
      {people.length > 0 ? (
        <ul className="border-border/60 divide-border/60 divide-y rounded-xl border">
          {people.map((person) => (
            <PersonRow key={person.id} person={person} />
          ))}
        </ul>
      ) : null}
      {people.length === 0 && isChecking ? <ListSkeleton /> : null}
    </section>
  );
};

export const CleanupPage = () => {
  const [view, setView] = useState<CleanupView>("songs");
  const [staleMonths, setStaleMonths] = useState<CleanupStaleMonths>(
    DEFAULT_CLEANUP_STALE_MONTHS
  );
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query).trim().toLowerCase();

  return (
    <main className="bg-background flex flex-1 flex-col md:h-full md:min-h-0 md:overflow-hidden">
      <div className="pb-safe-4 mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3 px-4 pt-1 md:min-h-0 md:overflow-y-auto md:overscroll-contain md:py-4">
        <header className="flex shrink-0 flex-col gap-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 max-md:hidden">
              <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">
                Data cleanup
              </h1>
              <p className="text-muted-foreground text-sm">
                Suggestions only: nothing changes until you act in Planning
                Center.
              </p>
            </div>
            <Tabs
              value={view}
              onValueChange={(value) => {
                setView(value === "people" ? "people" : "songs");
              }}
            >
              <TabsList className="h-8 max-md:h-10 max-md:w-full">
                <TabsTrigger value="songs">Songs</TabsTrigger>
                <TabsTrigger value="people">People</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="grid shrink-0 grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder={
                  view === "songs"
                    ? "Search songs or authors"
                    : "Search people or teams"
                }
                aria-label="Search suggestions"
              />
            </InputGroup>
            <NativeSelect
              className="w-full"
              aria-label="Unused for at least"
              value={String(staleMonths)}
              onChange={(event) => {
                const next = parseCleanupStaleMonths(event.target.value);
                if (next !== null) {
                  setStaleMonths(next);
                }
              }}
            >
              {cleanupStaleMonthOptions.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  Unused for {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </header>
        {view === "songs" ? (
          <SongsSection staleMonths={staleMonths} query={deferredQuery} />
        ) : (
          <PeopleSection staleMonths={staleMonths} query={deferredQuery} />
        )}
      </div>
    </main>
  );
};
