import type {
  ChordChartArrangement,
  ChordChartSong,
  LyricsSearchResult,
} from "@pcobooster/contracts/chord-charts";
import {
  importChordChart,
  lyricsToChordChart,
} from "@pcobooster/planning-center-models/chord-chart-import";
import type {
  ChordChartImport,
  ChordChartImportFormat,
} from "@pcobooster/planning-center-models/chord-chart-import";
import { useState } from "react";

import { LyricsSearchPanel } from "@/components/songs/lyrics-search-panel";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { lyricsSearchQueryFor } from "@/lib/lyrics-search";

type ImportTab = "search" | "paste" | "arrangement";

const formatLabels: Record<ChordChartImportFormat, string> = {
  "chordpro-file": "ChordPro file, such as a SongSelect download",
  "chords-over-lyrics": "Chords written above lyrics",
  "inline-chords": "Chart with inline [chords]",
  lyrics: "Lyrics only",
};

/** Another arrangement's chart, or only its lyrics. */
type ArrangementSource = `chart:${string}` | `lyrics:${string}`;

const isArrangementSource = (value: string): value is ArrangementSource =>
  value.startsWith("chart:") || value.startsWith("lyrics:");

const isImportTab = (value: string): value is ImportTab =>
  value === "search" || value === "paste" || value === "arrangement";

interface ArrangementText {
  readonly text: string;
  /** Services' derived lyrics, which carry no section names. */
  readonly lyricsOnly: boolean;
}

const NO_ARRANGEMENT_TEXT: ArrangementText = { text: "", lyricsOnly: false };

const arrangementText = (
  source: ArrangementSource | null,
  arrangements: readonly ChordChartArrangement[]
): ArrangementText => {
  if (source === null) {
    return NO_ARRANGEMENT_TEXT;
  }
  const [kind, id] = source.split(":");
  const arrangement = arrangements.find((candidate) => candidate.id === id);
  if (arrangement === undefined) {
    return NO_ARRANGEMENT_TEXT;
  }
  return kind === "chart"
    ? { text: arrangement.chordChart, lyricsOnly: false }
    : { text: arrangement.lyrics, lyricsOnly: true };
};

const fromLyrics = (lyrics: string): ChordChartImport => ({
  format: "lyrics",
  chart: lyricsToChordChart(lyrics),
  metadata: {},
});

interface ImportState {
  tab: ImportTab;
  pasted: string;
  found: LyricsSearchResult | null;
  arrangementSource: ArrangementSource | null;
}

const importFor = (
  state: ImportState,
  arrangements: readonly ChordChartArrangement[]
): ChordChartImport | null => {
  if (state.tab === "search") {
    return state.found === null ? null : fromLyrics(state.found.lyrics);
  }
  if (state.tab === "paste") {
    return state.pasted.trim() === "" ? null : importChordChart(state.pasted);
  }
  const { text, lyricsOnly } = arrangementText(
    state.arrangementSource,
    arrangements
  );
  if (text.trim() === "") {
    return null;
  }
  return lyricsOnly ? fromLyrics(text) : importChordChart(text);
};

const statusText = (
  state: ImportState,
  result: ChordChartImport | null
): string => {
  if (state.tab === "search") {
    return result === null
      ? "Lyrics come from LRCLIB, a free community database. Check them against the official lyrics and your CCLI license."
      : "Verses are numbered and repeated stanzas become choruses. Rename sections as needed.";
  }
  return result === null
    ? "Nothing to import yet."
    : `Detected: ${formatLabels[result.format]}.`;
};

export interface ChordChartImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  song: ChordChartSong;
  /** This song's arrangements, offered as starting points. */
  arrangements: readonly ChordChartArrangement[];
  onImport: (result: ChordChartImport, mode: "replace" | "append") => void;
}

/**
 * Starts a chart from lyrics found on the web, from text pasted from anywhere (SongSelect
 * ChordPro, a chord sheet, or lyrics), or from another arrangement, converted to Services'
 * format before it lands.
 */
export const ChordChartImportDialog = ({
  open,
  onOpenChange,
  song,
  arrangements,
  onImport,
}: ChordChartImportDialogProps) => {
  const [state, setState] = useState<ImportState>({
    tab: "search",
    pasted: "",
    found: null,
    arrangementSource: null,
  });
  const result = importFor(state, arrangements);
  const update = (change: Partial<ImportState>) => {
    setState((current) => ({ ...current, ...change }));
  };

  const finish = (mode: "replace" | "append") => {
    if (result === null) {
      return;
    }
    onImport(result, mode);
    update({ pasted: "", found: null });
    onOpenChange(false);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl">
        <ResponsiveDialogHeader className="text-left">
          <ResponsiveDialogTitle>Import lyrics or chords</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Start from lyrics found online, paste a SongSelect ChordPro file or
            chord sheet, or copy another arrangement.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex min-h-0 flex-col gap-3 max-md:px-4">
          <Tabs
            value={state.tab}
            onValueChange={(value: string) => {
              if (isImportTab(value)) {
                update({ tab: value });
              }
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="search">Search lyrics</TabsTrigger>
              <TabsTrigger value="paste">Paste</TabsTrigger>
              <TabsTrigger
                value="arrangement"
                disabled={arrangements.length === 0}
              >
                Arrangement
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {state.tab === "search" ? (
            <LyricsSearchPanel
              active={open}
              initialQuery={lyricsSearchQueryFor(song.title, song.author)}
              selectedId={state.found?.id ?? null}
              onSelect={(found) => {
                update({ found });
              }}
            />
          ) : null}
          {state.tab === "paste" ? (
            <Textarea
              aria-label="Text to import"
              autoFocus
              className="h-72"
              placeholder={
                "{title: Song}\n{comment: Verse 1}\n[G]Lyrics with [C]chords"
              }
              value={state.pasted}
              onChange={(event) => {
                update({ pasted: event.target.value });
              }}
            />
          ) : null}
          {state.tab === "arrangement" ? (
            <NativeSelect
              aria-label="Arrangement to copy"
              className="w-full"
              value={state.arrangementSource ?? ""}
              onChange={(event) => {
                const next = event.target.value;
                update({
                  arrangementSource: isArrangementSource(next) ? next : null,
                });
              }}
            >
              <NativeSelectOption value="">
                Choose an arrangement
              </NativeSelectOption>
              {arrangements.map((arrangement) => (
                <NativeSelectOption
                  key={`chart:${arrangement.id}`}
                  value={`chart:${arrangement.id}`}
                  disabled={arrangement.chordChart.trim() === ""}
                >
                  {`Chart from “${arrangement.name}”`}
                </NativeSelectOption>
              ))}
              {arrangements.map((arrangement) => (
                <NativeSelectOption
                  key={`lyrics:${arrangement.id}`}
                  value={`lyrics:${arrangement.id}`}
                  disabled={arrangement.lyrics.trim() === ""}
                >
                  {`Lyrics only from “${arrangement.name}”`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : null}
          {state.tab !== "paste" && result !== null ? (
            <pre className="bg-muted/50 h-48 overflow-auto rounded-2xl p-3 font-mono text-xs whitespace-pre-wrap">
              {result.chart}
            </pre>
          ) : null}
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {statusText(state, result)}
          </p>
        </div>
        <ResponsiveDialogFooter>
          <Button
            variant="outline"
            disabled={result === null}
            onClick={() => {
              finish("append");
            }}
          >
            Add to end
          </Button>
          <Button
            disabled={result === null}
            onClick={() => {
              finish("replace");
            }}
          >
            Replace chart
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
};
