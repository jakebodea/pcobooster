import { useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  chordChartErrorMessage,
  useCreateSong,
} from "@/hooks/use-chord-chart-song";
import { useSongSearch } from "@/hooks/use-song-search";
import { rememberRecentSong } from "@/lib/recent-songs";

const CCLI_NUMBER_PATTERN = /^\d{1,9}$/u;
const MAX_SIMILAR_SONGS = 3;

const parseCcliNumber = (value: string): number | undefined =>
  CCLI_NUMBER_PATTERN.test(value.trim()) ? Number(value.trim()) : undefined;

interface SongFields {
  title: string;
  author: string;
  copyright: string;
  ccliNumber: string;
}

const TextField = ({
  label,
  value,
  onChange,
  placeholder,
  autoFocus = false,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  inputMode?: "numeric";
}) => {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        autoFocus={autoFocus}
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
};

/** Songs already in Planning Center with a similar title, so nobody adds a duplicate. */
const SimilarSongs = ({ title }: { title: string }) => {
  const navigate = useNavigate();
  const query = useDeferredValue(title.trim());
  // A CCLI number is looked up by Services, not matched against titles.
  const searchable = query !== "" && parseCcliNumber(query) === undefined;
  const { data: songs = [] } = useSongSearch(searchable ? query : "");
  const similar = songs.slice(0, MAX_SIMILAR_SONGS);
  if (!searchable || similar.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-xs">
        Already in Planning Center:
      </p>
      {similar.map((song) => (
        <Item
          key={song.id}
          size="xs"
          variant="outline"
          render={
            <button type="button" aria-label={`Open ${song.title} instead`} />
          }
          onClick={() => {
            void navigate({
              to: "/songs/$songId",
              params: { songId: song.id },
            });
          }}
        >
          <ItemContent>
            <ItemTitle>{song.title}</ItemTitle>
            {song.author === "" ? null : (
              <ItemDescription>{song.author}</ItemDescription>
            )}
          </ItemContent>
        </Item>
      ))}
    </div>
  );
};

export interface AddSongDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Usually the search that found nothing. */
  initialTitle: string;
}

/** Adds a song to Planning Center with a Default arrangement, then opens its chart. */
export const AddSongDialog = ({
  open,
  onOpenChange,
  initialTitle,
}: AddSongDialogProps) => {
  const navigate = useNavigate();
  const createSong = useCreateSong();
  const [fields, setFields] = useState<SongFields>({
    title: initialTitle,
    author: "",
    copyright: "",
    ccliNumber: "",
  });
  const [prefilledFrom, setPrefilledFrom] = useState(initialTitle);
  if (prefilledFrom !== initialTitle) {
    setPrefilledFrom(initialTitle);
    setFields((current) => ({ ...current, title: initialTitle }));
  }
  const update = (change: Partial<SongFields>) => {
    setFields((current) => ({ ...current, ...change }));
  };
  const title = fields.title.trim();
  const lookupNumber = parseCcliNumber(title);
  const ccliNumber = parseCcliNumber(fields.ccliNumber);
  const ccliInvalid =
    fields.ccliNumber.trim() !== "" && ccliNumber === undefined;

  const submit = () => {
    if (title === "" || ccliInvalid || createSong.isPending) {
      return;
    }
    createSong.mutate(
      {
        title,
        author: fields.author.trim(),
        copyright: fields.copyright.trim(),
        ccliNumber: ccliNumber ?? lookupNumber,
      },
      {
        onSuccess: ({ song, arrangements }) => {
          rememberRecentSong(song);
          onOpenChange(false);
          void navigate({
            to: "/songs/$songId",
            params: { songId: song.id },
            search: { arrangement: arrangements[0]?.id },
          });
        },
        onError: (error) => {
          toast.error(chordChartErrorMessage(error));
        },
      }
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <ResponsiveDialogHeader className="text-left">
            <ResponsiveDialogTitle>Add song</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Adds the song to your Planning Center library with a Default
              arrangement, then opens its chord chart.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="flex flex-col gap-3 max-md:px-4">
            <TextField
              label="Title or CCLI number"
              autoFocus
              value={fields.title}
              placeholder="Build My Life"
              onChange={(value) => {
                update({ title: value });
              }}
            />
            {lookupNumber === undefined ? null : (
              <p className="text-muted-foreground text-xs">
                {`Planning Center looks up CCLI song ${String(lookupNumber)} and fills in its title, writers, and copyright.`}
              </p>
            )}
            <SimilarSongs title={fields.title} />
            {lookupNumber === undefined ? (
              <>
                <TextField
                  label="Writers"
                  value={fields.author}
                  placeholder="Optional"
                  onChange={(value) => {
                    update({ author: value });
                  }}
                />
                <TextField
                  label="Copyright"
                  value={fields.copyright}
                  placeholder="Optional"
                  onChange={(value) => {
                    update({ copyright: value });
                  }}
                />
                <TextField
                  label="CCLI number"
                  inputMode="numeric"
                  value={fields.ccliNumber}
                  placeholder="Optional"
                  onChange={(value) => {
                    update({ ccliNumber: value });
                  }}
                />
                {ccliInvalid ? (
                  <p className="text-destructive text-xs">
                    A CCLI number is digits only.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
          <ResponsiveDialogFooter>
            <Button
              type="submit"
              disabled={title === "" || ccliInvalid || createSong.isPending}
            >
              {createSong.isPending ? <Spinner aria-hidden /> : null}
              Add to Planning Center
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
};
