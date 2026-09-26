import type {
  ChordChartArrangement,
  ChordChartLayout,
} from "@pcobooster/contracts/chord-charts";
import { transposeChordChartText } from "@pcobooster/planning-center-models/chord-chart";
import { parseKey } from "@pcobooster/planning-center-models/chord-chart-chords";
import type { ChordChartImport } from "@pcobooster/planning-center-models/chord-chart-import";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { toast } from "sonner";

import { useBrowserStorage } from "@/hooks/use-browser-storage";
import {
  chordChartErrorMessage,
  isChordChartConflict,
  useSaveChordChart,
} from "@/hooks/use-chord-chart-song";
import {
  isSameDraft,
  readChordChartDraft,
  writeChordChartDraft,
} from "@/lib/chord-chart-draft";
import type { ChordChartDraft } from "@/lib/chord-chart-draft";

const DRAFT_WRITE_DELAY_MS = 400;
/** Typing pauses this long before a save, as Services' own editor saves while you type. */
const AUTO_REFRESH_DELAY_MS = 1200;
const AUTO_REFRESH_STORAGE_KEY = "pcobooster:chord-chart-auto-refresh";
const AUTO_REFRESH_OFF = "off";

const LAYOUT_FIELDS = [
  "font",
  "fontSize",
  "columns",
  "chordColor",
  "pageSize",
  "orientation",
  "margin",
] as const satisfies readonly (keyof ChordChartLayout)[];

/** Print settings the draft changed; the rest keep inheriting Services' defaults. */
export const changedLayout = (
  draft: ChordChartLayout,
  saved: ChordChartLayout
): Partial<ChordChartLayout> => {
  const changed: Partial<ChordChartLayout> = {};
  for (const field of LAYOUT_FIELDS) {
    if (draft[field] !== saved[field]) {
      Object.assign(changed, { [field]: draft[field] });
    }
  }
  return changed;
};

export const toServerDraft = (
  arrangement: ChordChartArrangement
): ChordChartDraft => ({
  chart: arrangement.chordChart,
  key: arrangement.chordChartKey,
  layout: arrangement.layout,
});

interface WorkspaceSession {
  readonly draft: ChordChartDraft;
  /** Planning Center's chart when editing began, for Revert all changes. */
  readonly opening: ChordChartDraft;
  /** Auto-refresh stopped after a failed save until the next manual one. */
  readonly paused: boolean;
  /** The draft came from this browser rather than Planning Center. */
  readonly restored: boolean;
  /** The arrangement version the draft started from. */
  readonly baseUpdatedAt: string | null;
}

/** An unsaved draft from this browser wins over the saved chart it started from. */
const startSession = (arrangement: ChordChartArrangement): WorkspaceSession => {
  const stored = readChordChartDraft(arrangement.id);
  const server = toServerDraft(arrangement);
  if (stored === null || isSameDraft(stored, server)) {
    return {
      draft: server,
      opening: server,
      paused: false,
      restored: false,
      baseUpdatedAt: arrangement.updatedAt,
    };
  }
  return {
    draft: { chart: stored.chart, key: stored.key, layout: stored.layout },
    opening: server,
    // A restored draft waits for the person to save or discard it.
    paused: true,
    restored: true,
    baseUpdatedAt: stored.baseUpdatedAt,
  };
};

const scheduleSave = (save: () => void): (() => void) => {
  const timeout = window.setTimeout(save, AUTO_REFRESH_DELAY_MS);
  return () => {
    window.clearTimeout(timeout);
  };
};

const scheduleDraftWrite = (
  arrangementId: string,
  draft: ChordChartDraft,
  dirty: boolean,
  baseUpdatedAt: string | null
): (() => void) => {
  const timeout = window.setTimeout(() => {
    writeChordChartDraft(
      arrangementId,
      dirty ? { ...draft, baseUpdatedAt } : null
    );
  }, DRAFT_WRITE_DELAY_MS);
  return () => {
    window.clearTimeout(timeout);
  };
};

/**
 * One arrangement's editing session: the draft, whether it differs from Planning Center,
 * and saving it back. Services renders only saved charts, so with Auto-refresh on (as in
 * Services' own editor) each pause in typing saves, and the preview renders the result.
 * Unsaved drafts persist in this browser until saved or discarded.
 */
export const useChordChartWorkspace = (
  songId: string,
  arrangement: ChordChartArrangement
) => {
  const [session, setSession] = useState(() => startSession(arrangement));
  const { draft, opening, paused, restored, baseUpdatedAt } = session;
  const [storedAutoRefresh, setStoredAutoRefresh] = useBrowserStorage(
    AUTO_REFRESH_STORAGE_KEY
  );
  const autoRefresh = storedAutoRefresh !== AUTO_REFRESH_OFF;
  const setDraft = (update: (current: ChordChartDraft) => ChordChartDraft) => {
    setSession((current) => ({ ...current, draft: update(current.draft) }));
  };
  const serverDraft = useMemo(() => toServerDraft(arrangement), [arrangement]);
  const dirty = !isSameDraft(draft, serverDraft);
  const saveChart = useSaveChordChart(songId);

  useEffect(
    () => scheduleDraftWrite(arrangement.id, draft, dirty, baseUpdatedAt),
    [arrangement.id, baseUpdatedAt, dirty, draft]
  );

  const saveFrom = (base: string | null, target: ChordChartDraft = draft) => {
    if (isSameDraft(target, serverDraft) || saveChart.isPending) {
      return;
    }
    const pause = () => {
      setSession((current) => ({ ...current, paused: true }));
    };
    saveChart.mutate(
      {
        songId,
        arrangementId: arrangement.id,
        chordChart: target.chart,
        chordChartKey: target.key,
        layout: changedLayout(target.layout, serverDraft.layout),
        baseUpdatedAt: base,
      },
      {
        onSuccess: (saved) => {
          setSession((current) => ({
            ...current,
            paused: false,
            restored: false,
            baseUpdatedAt: saved.updatedAt,
          }));
        },
        onError: (error) => {
          pause();
          if (!isChordChartConflict(error)) {
            toast.error(chordChartErrorMessage(error));
            return;
          }
          toast.error(chordChartErrorMessage(error), {
            action: {
              label: "Save mine anyway",
              onClick: () => {
                saveFrom(null);
              },
            },
          });
        },
      }
    );
  };

  const autoSave = useEffectEvent((target: ChordChartDraft) => {
    saveFrom(baseUpdatedAt, target);
  });
  const waitingToSave = autoRefresh && !paused && dirty && !saveChart.isPending;
  // Each edit restarts the wait, so the save goes out once typing pauses.
  useEffect(
    () =>
      waitingToSave
        ? scheduleSave(() => {
            autoSave(draft);
          })
        : undefined,
    [waitingToSave, draft]
  );

  return {
    draft,
    dirty,
    restored: restored && dirty,
    saving: saveChart.isPending,
    autoRefresh,
    /** Auto-refresh is on but stopped after a failed save. */
    paused: autoRefresh && paused && dirty,
    /** Something changed in Planning Center since editing began. */
    revertable:
      !isSameDraft(opening, draft) || !isSameDraft(opening, serverDraft),
    handleAutoRefreshChange: (enabled: boolean) => {
      setStoredAutoRefresh(enabled ? null : AUTO_REFRESH_OFF);
    },
    /** Puts back the chart as it was when editing began; Auto-refresh saves it. */
    handleRevert: () => {
      setSession((current) => ({
        ...current,
        draft: current.opening,
        paused: false,
      }));
    },
    handleSave: () => {
      saveFrom(baseUpdatedAt);
    },
    handleChartChange: (chart: string) => {
      setDraft((current) => ({ ...current, chart }));
    },
    handleKeyChange: (key: string | null) => {
      setDraft((current) => ({ ...current, key }));
    },
    handleLayoutChange: (layout: ChordChartDraft["layout"]) => {
      setDraft((current) => ({ ...current, layout }));
    },
    /** Rewrites the chords into another key and marks the chart as written there. */
    handleTranspose: (keyName: string) => {
      setDraft((current) => {
        const from = parseKey(current.key);
        const to = parseKey(keyName);
        if (from === null || to === null) {
          return current;
        }
        return {
          ...current,
          chart: transposeChordChartText(current.chart, from, to),
          key: to.name,
        };
      });
    },
    handleImport: (result: ChordChartImport, mode: "replace" | "append") => {
      setDraft((current) => {
        if (mode === "append") {
          return {
            ...current,
            chart: `${current.chart.trimEnd()}\n\n${result.chart}`,
          };
        }
        return {
          ...current,
          chart: result.chart,
          key: parseKey(result.metadata.key)?.name ?? current.key,
        };
      });
    },
    handleDiscard: () => {
      setSession((current) => ({
        ...current,
        draft: serverDraft,
        paused: false,
        restored: false,
        baseUpdatedAt: arrangement.updatedAt,
      }));
    },
  };
};

export type ChordChartWorkspace = ReturnType<typeof useChordChartWorkspace>;
