import { describe, expect, it } from "vitest";

import { changedLayout } from "@/hooks/use-chord-chart-workspace";

const saved = {
  font: "Times-Roman",
  fontSize: 12,
  columns: 2,
  chordColor: 1,
  pageSize: "Letter",
  orientation: "Portrait",
  margin: "0.5in",
} as const;

describe(changedLayout, () => {
  it("sends nothing when the layout is unchanged, so defaults stay inherited", () => {
    expect(changedLayout({ ...saved }, saved)).toStrictEqual({});
  });

  it("sends only the settings the draft changed, including resets", () => {
    expect(
      changedLayout({ ...saved, fontSize: 16, font: null }, saved)
    ).toStrictEqual({ font: null, fontSize: 16 });
  });
});
