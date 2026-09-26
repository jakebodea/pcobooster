import {
  CHORD_CHART_KEYS,
  isChord,
  parseKey,
  semitonesBetween,
  transposeChordText,
} from "@pcobooster/planning-center-models/chord-chart-chords";
import type { MusicalKey } from "@pcobooster/planning-center-models/chord-chart-chords";
import { describe, expect, it } from "vitest";

const key = (name: string): MusicalKey => {
  const parsed = parseKey(name);
  if (parsed === null) {
    throw new Error(`Test key ${name} did not parse`);
  }
  return parsed;
};

describe(parseKey, () => {
  it("reads major and minor keys with either accidental", () => {
    expect(parseKey("F#")).toStrictEqual({
      pitch: 6,
      minor: false,
      name: "F#",
    });
    expect(parseKey("Bbm")).toStrictEqual({
      pitch: 10,
      minor: true,
      name: "Bbm",
    });
    expect(parseKey("A♭")).toStrictEqual({
      pitch: 8,
      minor: false,
      name: "Ab",
    });
  });

  it("names enharmonic keys the way Planning Center lists them", () => {
    expect(parseKey("C#")?.name).toBe("Db");
    expect(parseKey("D#m")?.name).toBe("Ebm");
  });

  it("rejects text that is not a key", () => {
    expect(parseKey("H")).toBeNull();
    expect(parseKey("")).toBeNull();
    expect(parseKey(null)).toBeNull();
  });

  it("lists twelve major and twelve minor keys", () => {
    expect(CHORD_CHART_KEYS).toHaveLength(24);
  });
});

describe(isChord, () => {
  it.each([
    "G",
    "Bm",
    "C#m7",
    "Dsus4",
    "G/B",
    "A2",
    "Emaj7",
    "F#m7b5",
    "E/G#",
    "Bb(add9)",
    "C°",
  ])("accepts %s", (chord) => {
    expect(isChord(chord)).toBeTruthy();
  });

  it.each(["Be", "Amazing", "God", "x2", "Hello"])("rejects %s", (word) => {
    expect(isChord(word)).toBeFalsy();
  });
});

describe(transposeChordText, () => {
  it("moves roots and bass notes, spelled for the target key", () => {
    expect(transposeChordText("G D/F# Em7 Csus2", 2, key("A"))).toBe(
      "A E/G# F#m7 Dsus2"
    );
    expect(transposeChordText("E B/D# C#m", 1, key("F"))).toBe("F C/E Dm");
  });

  it("uses flats in flat keys and Planning Center's scale in C", () => {
    expect(transposeChordText("D A/C#", -2, key("C"))).toBe("C G/B");
    expect(transposeChordText("A E/G#", 1, key("Bb"))).toBe("Bb F/A");
    expect(transposeChordText("A#", 0, key("C"))).toBe("Bb");
  });

  it("leaves text that is not a chord alone", () => {
    expect(transposeChordText("N.C. x2", 3, key("E"))).toBe("N.C. x2");
  });
});

describe(semitonesBetween, () => {
  it("chooses the shorter direction", () => {
    expect(semitonesBetween(key("G"), key("A"))).toBe(2);
    expect(semitonesBetween(key("C"), key("A"))).toBe(-3);
  });
});
