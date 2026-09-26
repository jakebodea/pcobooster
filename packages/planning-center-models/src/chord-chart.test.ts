import {
  isChordLine,
  isSectionHeading,
  transposeChordChartText,
} from "@pcobooster/planning-center-models/chord-chart";
import { parseKey } from "@pcobooster/planning-center-models/chord-chart-chords";
import { describe, expect, it } from "vitest";

const keyE = parseKey("E");
const keyG = parseKey("G");

describe(isSectionHeading, () => {
  it.each([
    "VERSE 1",
    "Chorus",
    "PRE-CHORUS",
    "Bridge 2:",
    "TAG (x2)",
    "CHORUS 2x",
    "INSTRUMENTAL",
  ])("recognizes %s", (line) => {
    expect(isSectionHeading(line)).toBeTruthy();
  });

  it.each(["Verse of my life", "Amazing grace", "[G]Chorus"])(
    "leaves %s as lyrics",
    (line) => {
      expect(isSectionHeading(line)).toBeFalsy();
    }
  );
});

describe(isChordLine, () => {
  it("accepts chords with bar lines and repeats", () => {
    expect(isChordLine("D          Bm       G          D")).toBeTruthy();
    expect(isChordLine("| G | D/F# | Em | C | x2")).toBeTruthy();
  });

  it("rejects lyric lines", () => {
    expect(isChordLine("Be thou my vision")).toBeFalsy();
    expect(isChordLine("A mighty fortress")).toBeFalsy();
  });
});

describe(transposeChordChartText, () => {
  it("rewrites inline chords and keeps chord lines aligned", () => {
    if (keyE === null || keyG === null) {
      throw new Error("Test keys did not parse");
    }
    expect(
      transposeChordChartText(
        "VERSE\n[E]Beyond [C#m]all\nE    B\nLyrics here",
        keyE,
        keyG
      )
    ).toBe("VERSE\n[G]Beyond [Em]all\nG    D\nLyrics here");
  });
});
