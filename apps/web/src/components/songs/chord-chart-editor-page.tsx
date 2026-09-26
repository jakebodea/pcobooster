import type {
  ChordChartArrangement,
  ChordChartSong,
} from "@pcobooster/contracts/chord-charts";
import {
  CHORD_CHART_KEYS,
  parseKey,
  transposeKey,
} from "@pcobooster/planning-center-models/chord-chart-chords";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  FileInput,
  Plus,
  Search,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { toast } from "sonner";

import { ChordChartCreateDialog } from "@/components/songs/chord-chart-create-dialog";
import { highlightChordChart } from "@/components/songs/chord-chart-highlight";
import { ChordChartImportDialog } from "@/components/songs/chord-chart-import-dialog";
import { ChordChartLayoutPopover } from "@/components/songs/chord-chart-layout-popover";
import { PlanningCenterPdfPreview } from "@/components/songs/planning-center-pdf-preview";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { HighlightedTextarea } from "@/components/ui/highlighted-textarea";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useChordChartSong } from "@/hooks/use-chord-chart-song";
import { useChordChartWorkspace } from "@/hooks/use-chord-chart-workspace";
import type { ChordChartWorkspace } from "@/hooks/use-chord-chart-workspace";
import { useIsMobile } from "@/hooks/use-mobile";
import { writeChordChartDraft } from "@/lib/chord-chart-draft";
import type { ChordChartDraft } from "@/lib/chord-chart-draft";
import { rememberRecentSong } from "@/lib/recent-songs";

const SAVE_HOTKEY = "Mod+S";
const COPIED_LABEL_MS = 2000;
const KEYS_PER_MODE = 12;

const PLANNING_CENTER_SONGS_URL =
  "https://services.planningcenteronline.com/songs";

const SECTION_SNIPPETS = [
  "VERSE 1",
  "PRE-CHORUS",
  "CHORUS",
  "BRIDGE",
  "TAG",
  "INSTRUMENTAL",
] as const;

const CODE_SNIPPETS = [
  { label: "Column break", text: "COLUMN_BREAK" },
  { label: "Page break", text: "PAGE_BREAK" },
  { label: "Page break (charts only)", text: "{{ PAGE_BREAK }}" },
  { label: "Note", text: "{ Note }" },
  { label: "Note (charts only)", text: "{{ Note }}" },
  { label: "Key change up a step", text: "TRANSPOSE KEY +2" },
] as const;

/** A new arrangement inherits every print setting from the organization's defaults. */
const EMPTY_DRAFT: ChordChartDraft = {
  chart: "",
  key: null,
  layout: {
    font: null,
    fontSize: null,
    columns: null,
    chordColor: null,
    pageSize: null,
    orientation: null,
    margin: null,
  },
};

/** The chart's twelve keys in its own mode, for previewing and transposing. */
const keysInMode = (writtenKey: string | null): string[] => {
  const key = parseKey(writtenKey);
  if (key === null) {
    return CHORD_CHART_KEYS.slice(0, KEYS_PER_MODE);
  }
  return Array.from(
    { length: KEYS_PER_MODE },
    (_, step) => transposeKey(key, step).name
  );
};

/** Replaces the textarea's selection and tells React, leaving the caret after the text. */
const insertAtCaret = (
  textarea: HTMLTextAreaElement | null,
  snippet: string
) => {
  if (textarea === null) {
    return;
  }
  const { selectionStart, selectionEnd, value } = textarea;
  const atLineStart =
    selectionStart === 0 || value[selectionStart - 1] === "\n";
  textarea.focus();
  textarea.setRangeText(
    `${atLineStart ? "" : "\n"}${snippet}\n`,
    selectionStart,
    selectionEnd,
    "end"
  );
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
};

const planningCenterArrangementUrl = (songId: string, arrangementId: string) =>
  `${PLANNING_CENTER_SONGS_URL}/${songId}/arrangements/${arrangementId}`;

const scheduleReset = (reset: () => void): (() => void) => {
  const timeout = window.setTimeout(reset, COPIED_LABEL_MS);
  return () => {
    window.clearTimeout(timeout);
  };
};

const useCopyChart = (chart: string) => {
  const [copied, setCopied] = useState(false);
  useEffect(
    () =>
      copied
        ? scheduleReset(() => {
            setCopied(false);
          })
        : undefined,
    [copied]
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(chart);
      setCopied(true);
    } catch {
      toast.error("Your browser blocked copying. Select the text and copy it.");
    }
  };
  return { copied, copy };
};

const InsertMenu = ({
  textareaRef,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={<Button variant="ghost" size="sm" aria-label="Insert" />}
    >
      <Plus aria-hidden />
      <span className="max-sm:hidden">Insert</span>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-56">
      <DropdownMenuLabel>Section</DropdownMenuLabel>
      {SECTION_SNIPPETS.map((section) => (
        <DropdownMenuItem
          key={section}
          onClick={() => {
            insertAtCaret(textareaRef.current, section);
          }}
        >
          {section}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Planning Center codes</DropdownMenuLabel>
      {CODE_SNIPPETS.map((code) => (
        <DropdownMenuItem
          key={code.label}
          onClick={() => {
            insertAtCaret(textareaRef.current, code.text);
          }}
        >
          {code.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

const TransposeMenu = ({
  writtenKey,
  onTranspose,
}: {
  writtenKey: string | null;
  onTranspose: (key: string) => void;
}) => {
  const current = parseKey(writtenKey);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            disabled={current === null}
            aria-label="Transpose chords"
          />
        }
      >
        <span>Transpose</span>
        <ChevronDown className="text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel>Rewrite chords in</DropdownMenuLabel>
        {keysInMode(writtenKey).map((key) => (
          <DropdownMenuItem
            key={key}
            onClick={() => {
              onTranspose(key);
            }}
          >
            <span>{key}</span>
            {key === current?.name ? (
              <Check className="ml-auto" aria-hidden />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const WrittenKeySelect = ({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (key: string | null) => void;
}) => (
  <NativeSelect
    aria-label="Key the chords are written in"
    size="sm"
    value={value ?? ""}
    onChange={(event) => {
      const next = event.target.value;
      onChange(next === "" ? null : next);
    }}
  >
    <NativeSelectOption value="">No key</NativeSelectOption>
    <NativeSelectOptGroup label="Major">
      {CHORD_CHART_KEYS.slice(0, KEYS_PER_MODE).map((key) => (
        <NativeSelectOption key={key} value={key}>
          {`Written in ${key}`}
        </NativeSelectOption>
      ))}
    </NativeSelectOptGroup>
    <NativeSelectOptGroup label="Minor">
      {CHORD_CHART_KEYS.slice(KEYS_PER_MODE).map((key) => (
        <NativeSelectOption key={key} value={key}>
          {`Written in ${key}`}
        </NativeSelectOption>
      ))}
    </NativeSelectOptGroup>
  </NativeSelect>
);

/**
 * With Auto-refresh on, edits save as typing pauses and this only reports progress;
 * otherwise, or after a failed save, saving is a button.
 */
const SaveControl = ({ workspace }: { workspace: ChordChartWorkspace }) => {
  if (workspace.autoRefresh && !workspace.paused) {
    return (
      <p
        className="text-muted-foreground flex min-w-24 items-center justify-end gap-1.5 text-xs"
        aria-live="polite"
      >
        {workspace.saving ? <Spinner aria-hidden /> : null}
        {workspace.saving || workspace.dirty ? "Saving…" : "Saved"}
      </p>
    );
  }
  return (
    <Button
      size="sm"
      disabled={!workspace.dirty || workspace.saving}
      onClick={workspace.handleSave}
    >
      {workspace.saving ? <Spinner aria-hidden /> : null}
      {workspace.dirty ? "Save to Planning Center" : "Saved"}
    </Button>
  );
};

interface WorkspaceHeaderProps {
  song: ChordChartSong;
  arrangement: ChordChartArrangement;
  arrangements: readonly ChordChartArrangement[];
  workspace: ChordChartWorkspace;
  onImport: () => void;
  onCreate: () => void;
}

const WorkspaceHeader = ({
  song,
  arrangement,
  arrangements,
  workspace,
  onImport,
  onCreate,
}: WorkspaceHeaderProps) => {
  const navigate = useNavigate();
  const { copied, copy } = useCopyChart(workspace.draft.chart);
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-1 pb-3 md:py-3">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold tracking-tight md:text-xl">
          {song.title}
        </h1>
        {song.author === "" ? null : (
          <p className="text-muted-foreground truncate text-xs">
            {song.author}
          </p>
        )}
      </div>
      <NativeSelect
        aria-label="Arrangement"
        size="sm"
        value={arrangement.id}
        onChange={(event) => {
          void navigate({
            to: "/songs/$songId",
            params: { songId: song.id },
            search: { arrangement: event.target.value },
            replace: true,
          });
        }}
      >
        {arrangements.map((candidate) => (
          <NativeSelectOption key={candidate.id} value={candidate.id}>
            {candidate.archived
              ? `${candidate.name} (archived)`
              : candidate.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          aria-label="Import lyrics or chords"
          onClick={onImport}
        >
          <FileInput aria-hidden />
          <span className="max-sm:hidden">Import</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="More actions"
              />
            }
          >
            <ChevronDown aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem
              onClick={() => {
                void copy();
              }}
            >
              <Copy aria-hidden />
              Copy chart text
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreate}>
              <Plus aria-hidden />
              Save as new arrangement…
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!workspace.revertable}
              onClick={workspace.handleRevert}
            >
              <Undo2 aria-hidden />
              Revert all changes
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                window.open(
                  planningCenterArrangementUrl(song.id, arrangement.id),
                  "_blank",
                  "noopener,noreferrer"
                );
              }}
            >
              <ExternalLink aria-hidden />
              Open in Planning Center
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <SaveControl workspace={workspace} />
      </div>
      {copied ? (
        <p className="text-muted-foreground w-full text-xs" aria-live="polite">
          Copied. Paste it into Lyrics &amp; Chords in Planning Center.
        </p>
      ) : null}
    </header>
  );
};

const EditorPane = ({
  workspace,
  onFindLyrics,
  onPreview,
}: {
  workspace: ChordChartWorkspace;
  onFindLyrics: () => void;
  /** On phones the preview opens from here instead of sitting beside the editor. */
  onPreview: (() => void) | null;
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { draft } = workspace;
  const highlighted = useMemo(
    () => highlightChordChart(draft.chart),
    [draft.chart]
  );
  return (
    <section
      aria-label="Chart text"
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <WrittenKeySelect
          value={draft.key}
          onChange={workspace.handleKeyChange}
        />
        <TransposeMenu
          writtenKey={draft.key}
          onTranspose={workspace.handleTranspose}
        />
        <InsertMenu textareaRef={textareaRef} />
        {draft.chart.trim() === "" ? (
          <Button variant="secondary" size="sm" onClick={onFindLyrics}>
            <Search aria-hidden />
            Find lyrics
          </Button>
        ) : null}
        {onPreview === null ? null : (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={onPreview}
          >
            <Eye aria-hidden />
            Preview
          </Button>
        )}
        {workspace.restored ? (
          <p className="text-muted-foreground ml-auto flex items-center gap-1 text-xs">
            Unsaved draft restored.
            <Button variant="link" size="xs" onClick={workspace.handleDiscard}>
              Discard
            </Button>
          </p>
        ) : null}
      </div>
      <HighlightedTextarea
        ref={textareaRef}
        aria-label="Lyrics and chords"
        className="min-h-80 flex-1"
        placeholder={
          "VERSE 1\n[G]Type lyrics with [C]chords in brackets\n\nCHORUS\n..."
        }
        value={draft.chart}
        highlight={highlighted}
        onChange={(event) => {
          workspace.handleChartChange(event.target.value);
        }}
      />
    </section>
  );
};

/** Why the preview may trail the editor, with a way to catch it up. */
const PreviewStatus = ({ workspace }: { workspace: ChordChartWorkspace }) => {
  if (!workspace.dirty || (workspace.autoRefresh && !workspace.paused)) {
    return null;
  }
  return (
    <p className="text-muted-foreground flex items-center gap-2 px-3 pb-2 text-xs">
      {workspace.paused
        ? "Auto-refresh paused. Planning Center shows the last saved chart."
        : "Planning Center shows the last saved chart."}
      <Button
        size="xs"
        disabled={workspace.saving}
        onClick={workspace.handleSave}
      >
        {workspace.saving ? <Spinner aria-hidden /> : null}
        Save to update
      </Button>
    </p>
  );
};

const PreviewPane = ({
  songId,
  arrangement,
  workspace,
}: {
  songId: string;
  arrangement: ChordChartArrangement;
  workspace: ChordChartWorkspace;
}) => (
  <section
    aria-label="Preview"
    className="bg-muted/40 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl"
  >
    <PlanningCenterPdfPreview
      songId={songId}
      arrangement={arrangement}
      status={<PreviewStatus workspace={workspace} />}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={workspace.autoRefresh}
            onClick={() => {
              workspace.handleAutoRefreshChange(!workspace.autoRefresh);
            }}
          >
            {workspace.autoRefresh ? <Check aria-hidden /> : null}
            Auto-refresh
          </Button>
          <ChordChartLayoutPopover
            layout={workspace.draft.layout}
            onChange={workspace.handleLayoutChange}
          />
        </>
      }
    />
  </section>
);

interface WorkspaceProps {
  song: ChordChartSong;
  arrangement: ChordChartArrangement;
  arrangements: readonly ChordChartArrangement[];
}

const ChordChartWorkspaceView = ({
  song,
  arrangement,
  arrangements,
}: WorkspaceProps) => {
  const navigate = useNavigate();
  const workspace = useChordChartWorkspace(song.id, arrangement);
  const isMobile = useIsMobile();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useHotkey(SAVE_HOTKEY, workspace.handleSave, {
    ignoreInputs: false,
    preventDefault: true,
  });

  return (
    <main className="bg-background flex min-h-0 flex-1 flex-col">
      <WorkspaceHeader
        song={song}
        arrangement={arrangement}
        arrangements={arrangements}
        workspace={workspace}
        onImport={() => {
          setImportOpen(true);
        }}
        onCreate={() => {
          setCreateOpen(true);
        }}
      />
      <div className="flex min-h-0 flex-1 gap-3 px-4 pb-4 max-md:min-h-[70svh] md:grid md:grid-cols-2">
        <EditorPane
          workspace={workspace}
          onFindLyrics={() => {
            setImportOpen(true);
          }}
          onPreview={
            isMobile
              ? () => {
                  setPreviewOpen(true);
                }
              : null
          }
        />
        {isMobile ? null : (
          <PreviewPane
            songId={song.id}
            arrangement={arrangement}
            workspace={workspace}
          />
        )}
      </div>
      {/* The PDF loads only while the sheet is open, so typing on a phone costs no renders. */}
      <Drawer
        open={isMobile && previewOpen}
        onOpenChange={setPreviewOpen}
        showSwipeHandle
      >
        <DrawerContent className="h-[calc(100dvh-3rem)]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-left">
              Planning Center preview
            </DrawerTitle>
            <DrawerDescription className="sr-only">
              The chord chart as Planning Center renders it.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col px-2">
            <PreviewPane
              songId={song.id}
              arrangement={arrangement}
              workspace={workspace}
            />
          </div>
        </DrawerContent>
      </Drawer>
      <ChordChartImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        song={song}
        arrangements={arrangements}
        onImport={workspace.handleImport}
      />
      <ChordChartCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        songId={song.id}
        draft={workspace.draft}
        onCreated={(created) => {
          // The chart now lives in the new arrangement; this one keeps its saved version.
          writeChordChartDraft(arrangement.id, null);
          void navigate({
            to: "/songs/$songId",
            params: { songId: song.id },
            search: { arrangement: created.id },
          });
        }}
      />
    </main>
  );
};

export const ChordChartEditorPageSkeleton = () => (
  <main
    className="flex min-h-0 flex-1 flex-col gap-3 p-4"
    aria-busy
    aria-label="Loading chord chart"
  >
    <Skeleton variant="text" className="h-6 w-56" />
    <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-2">
      <Skeleton variant="control" className="h-96" />
      <Skeleton variant="control" className="h-96 max-md:hidden" />
    </div>
  </main>
);

const NoArrangements = ({ song }: { song: ChordChartSong }) => {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <main className="flex flex-1 flex-col items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{song.title} has no arrangements</EmptyTitle>
          <EmptyDescription>
            Chord charts belong to an arrangement. Create one to start writing.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            Create arrangement
          </Button>
        </EmptyContent>
      </Empty>
      <ChordChartCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        songId={song.id}
        draft={EMPTY_DRAFT}
        onCreated={(created) => {
          void navigate({
            to: "/songs/$songId",
            params: { songId: song.id },
            search: { arrangement: created.id },
          });
        }}
      />
    </main>
  );
};

export const ChordChartEditorPage = ({
  songId,
  arrangementId,
}: {
  songId: string;
  arrangementId: string | null;
}) => {
  const { data, isError, refetch } = useChordChartSong(songId);
  const openedSong = data?.song;
  useEffect(() => {
    if (openedSong !== undefined) {
      rememberRecentSong(openedSong);
    }
  }, [openedSong]);
  if (isError && data === undefined) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground text-sm">
          This song did not load from Planning Center.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void refetch();
          }}
        >
          Try again
        </Button>
      </main>
    );
  }
  if (data === undefined) {
    return <ChordChartEditorPageSkeleton />;
  }
  const arrangement =
    data.arrangements.find((candidate) => candidate.id === arrangementId) ??
    data.arrangements.find((candidate) => !candidate.archived) ??
    data.arrangements[0];
  if (arrangement === undefined) {
    return <NoArrangements song={data.song} />;
  }
  return (
    <ChordChartWorkspaceView
      key={arrangement.id}
      song={data.song}
      arrangement={arrangement}
      arrangements={data.arrangements}
    />
  );
};
