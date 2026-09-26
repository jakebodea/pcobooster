import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isSameDraft,
  readChordChartDraft,
  writeChordChartDraft,
} from "@/lib/chord-chart-draft";

const layout = {
  font: null,
  fontSize: 12,
  columns: 2,
  chordColor: 1,
  pageSize: "Letter",
  orientation: "Portrait",
  margin: "0.5in",
} as const;

const installLocalStorageMock = () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
    dispatchEvent: () => true,
  });
};

describe("chord chart drafts", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("round-trips a draft through browser storage", () => {
    const draft = {
      chart: "VERSE\n[G]Amazing",
      key: "G",
      layout,
      baseUpdatedAt: "2026-09-01T12:00:00Z",
    };
    writeChordChartDraft("arr-1", draft);
    expect(readChordChartDraft("arr-1")).toStrictEqual(draft);
    writeChordChartDraft("arr-1", null);
    expect(readChordChartDraft("arr-1")).toBeNull();
  });

  it("compares drafts by chart, key, and layout", () => {
    const draft = { chart: "A", key: "G", layout };
    expect(isSameDraft(draft, { ...draft })).toBeTruthy();
    expect(isSameDraft(draft, { ...draft, key: "A" })).toBeFalsy();
    expect(
      isSameDraft(draft, { ...draft, layout: { ...layout, columns: 1 } })
    ).toBeFalsy();
  });
});
