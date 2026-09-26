import { chordChartLayoutSchema } from "@pcobooster/contracts/chord-charts";
import type { ChordChartLayout } from "@pcobooster/contracts/chord-charts";
import { z } from "zod";

import { readBrowserStorage, writeBrowserStorage } from "@/lib/browser-storage";

/** What the editor changes; saving writes all of it to the arrangement. */
export interface ChordChartDraft {
  readonly chart: string;
  readonly key: string | null;
  readonly layout: ChordChartLayout;
}

const storedDraftSchema = z.object({
  chart: z.string(),
  key: z.string().nullable(),
  layout: chordChartLayoutSchema,
  /** The arrangement version the draft started from. */
  baseUpdatedAt: z.string().nullable(),
});

export type StoredChordChartDraft = z.output<typeof storedDraftSchema>;

const storageKey = (arrangementId: string) =>
  `pcobooster:chord-chart-draft:${arrangementId}`;

export const isSameDraft = (
  left: ChordChartDraft,
  right: ChordChartDraft
): boolean =>
  left.chart === right.chart &&
  left.key === right.key &&
  JSON.stringify(left.layout) === JSON.stringify(right.layout);

/** An unsaved draft for this browser, or null when there is none or it is unreadable. */
export const readChordChartDraft = (
  arrangementId: string
): StoredChordChartDraft | null => {
  const stored = readBrowserStorage(storageKey(arrangementId));
  if (stored === null) {
    return null;
  }
  try {
    const parsed = storedDraftSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const writeChordChartDraft = (
  arrangementId: string,
  draft: StoredChordChartDraft | null
): void => {
  writeBrowserStorage(
    storageKey(arrangementId),
    draft === null ? null : JSON.stringify(draft)
  );
};
