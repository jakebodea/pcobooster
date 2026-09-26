import type { ChordChartArrangement } from "@pcobooster/contracts/chord-charts";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  chordChartErrorMessage,
  useChordChartPdf,
} from "@/hooks/use-chord-chart-song";
import { renderPdfPages } from "@/lib/pdf-pages";

const LYRICS_TARGET = "lyrics";

const keyLabel = (key: ChordChartArrangement["keys"][number]): string => {
  const name = key.name.trim();
  const start = key.startingKey ?? "";
  if (name === "" || name === start) {
    return start === "" ? "Chord chart" : `Chords in ${start}`;
  }
  return start === "" ? name : `${name} (${start})`;
};

const observeWidth = (
  element: HTMLElement,
  onWidth: (width: number) => void
): (() => void) => {
  const observer = new ResizeObserver(([entry]) => {
    onWidth(Math.floor(entry?.contentRect.width ?? 0));
  });
  observer.observe(element);
  return () => {
    observer.disconnect();
  };
};

/** Draws the PDF into `pages` unless a newer render starts first; returns the cancel. */
const drawPages = (
  pages: HTMLElement,
  data: string,
  width: number,
  callbacks: { onDrawn: () => void; onFailed: () => void }
): (() => void) => {
  let current = true;
  const draw = async () => {
    try {
      const canvases = await renderPdfPages(data, width);
      if (current) {
        pages.replaceChildren(...canvases);
        callbacks.onDrawn();
      }
    } catch {
      if (current) {
        callbacks.onFailed();
      }
    }
  };
  void draw();
  return () => {
    current = false;
  };
};

/**
 * Pages drawn into `pagesRef`. A new render replaces the old pages only once it is
 * ready, so the preview never blanks and keeps its scroll position.
 */
const usePdfPages = (data: string | undefined) => {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const pages = pagesRef.current;
    return pages ? observeWidth(pages, setWidth) : undefined;
  }, []);

  useEffect(() => {
    const pages = pagesRef.current;
    return data === undefined || pages === null || width === 0
      ? undefined
      : drawPages(pages, data, width, {
          onDrawn: () => {
            setDrawn(true);
            setFailed(false);
          },
          onFailed: () => {
            setFailed(true);
          },
        });
  }, [data, width]);

  return { pagesRef, drawn, failed };
};

export interface PlanningCenterPdfPreviewProps {
  songId: string;
  arrangement: ChordChartArrangement;
  /** Shown beside the chart picker, such as Auto-refresh and Formatting. */
  actions: ReactNode;
  /** A line about unsaved edits, shown above the pages. */
  status: ReactNode;
}

/**
 * The chart exactly as Planning Center renders it: Services' own PDF of the saved chart,
 * for one of the arrangement's keys or its lyrics sheet.
 */
export const PlanningCenterPdfPreview = ({
  songId,
  arrangement,
  actions,
  status,
}: PlanningCenterPdfPreviewProps) => {
  const [target, setTarget] = useState<string>(
    arrangement.keys[0]?.id ?? LYRICS_TARGET
  );
  const keyId = target === LYRICS_TARGET ? null : target;
  const pdf = useChordChartPdf({
    songId,
    arrangementId: arrangement.id,
    keyId,
    updatedAt: arrangement.updatedAt,
  });
  const { pagesRef, drawn, failed } = usePdfPages(pdf.data?.data);
  const rendering = pdf.isFetching || (pdf.data !== undefined && !drawn);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 p-2">
        <NativeSelect
          aria-label="Chart to preview"
          size="sm"
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
          }}
        >
          {arrangement.keys.map((key) => (
            <NativeSelectOption key={key.id} value={key.id}>
              {keyLabel(key)}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value={LYRICS_TARGET}>Lyrics</NativeSelectOption>
        </NativeSelect>
        {rendering ? (
          <Spinner aria-label="Rendering in Planning Center" />
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">{actions}</div>
      </div>
      {status}
      {arrangement.keys.length === 0 ? (
        <p className="text-muted-foreground px-3 pb-2 text-xs">
          This arrangement has no key in Planning Center, so only its lyrics
          sheet renders. Add a key there to preview chord charts.
        </p>
      ) : null}
      <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {pdf.isError ? (
          <div className="flex flex-col items-start gap-2 p-2">
            <p className="text-muted-foreground text-sm">
              {chordChartErrorMessage(pdf.error)}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void pdf.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {failed ? (
          <p className="text-muted-foreground p-2 text-sm">
            The PDF from Planning Center could not be drawn.
          </p>
        ) : null}
        {drawn || pdf.isError ? null : (
          <Skeleton variant="control" className="aspect-[8.5/11] w-full" />
        )}
        <div
          ref={pagesRef}
          aria-label="Chord chart from Planning Center"
          className="flex flex-col gap-4"
        />
      </div>
    </div>
  );
};
