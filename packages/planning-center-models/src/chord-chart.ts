/**
 * Reads Planning Center's Lyrics & Chords text (`Arrangement.chord_chart`): ChordPro inline
 * chords (`[G]Amazing grace`), chords written on their own line above the lyrics, and
 * Services' section headings and codes. Services renders the chart itself; these helpers
 * color it for editing and transpose it.
 */
import {
  isChord,
  semitonesBetween,
  transposeChordText,
} from "@pcobooster/planning-center-models/chord-chart-chords";
import type { MusicalKey } from "@pcobooster/planning-center-models/chord-chart-chords";

/** Section names Planning Center formats as headings, optionally numbered (`VERSE 2`). */
const SECTION_NAMES = [
  "intro",
  "verse",
  "pre-chorus",
  "prechorus",
  "pre chorus",
  "chorus",
  "post-chorus",
  "postchorus",
  "post chorus",
  "refrain",
  "bridge",
  "tag",
  "interlude",
  "instrumental",
  "turnaround",
  "vamp",
  "breakdown",
  "ending",
  "outro",
  "coda",
  "misc",
  "spoken",
  "solo",
  "rap",
  "hook",
  "channel",
] as const;

const SECTION_PATTERN = new RegExp(
  `^(?:${SECTION_NAMES.join("|")})(?:\\s*\\d+[a-z]?)?(?:\\s*[(]?\\s*[x×]\\s*\\d+\\s*[)]?)?(?:\\s*[(][^)]*[)])?\\s*:?$`,
  "iu"
);
const BRACKETED_CHORD_PATTERN = /\[(?<chord>[^\]]*)\]/gu;
const PLAIN_TEXT_TAG_PATTERN = /<t>/iu;
/** Chord-line tokens that are not chords: bar lines, repeats, and rests. */
const CHORD_LINE_SYMBOL_PATTERN =
  /^(?:\||\|\||\/|-|\u2013|%|\.|:|\(|\)|[x×]\d+|\(?[x×]\d+\)?|N\.?C\.?|\(\S*\))$/iu;
const WHITESPACE_TOKEN_PATTERN = /\S+/gu;

export const COLUMN_BREAK = "COLUMN_BREAK";
export const PAGE_BREAK = "PAGE_BREAK";

export const isSectionHeading = (line: string): boolean =>
  !line.includes("[") && SECTION_PATTERN.test(line.trim());

/** A line of chords written above lyrics, such as `G    D/F#   Em`. */
export const isChordLine = (line: string): boolean => {
  if (line.includes("[") || PLAIN_TEXT_TAG_PATTERN.test(line)) {
    return false;
  }
  const tokens = line.match(WHITESPACE_TOKEN_PATTERN) ?? [];
  let chords = 0;
  for (const token of tokens) {
    if (isChord(token)) {
      chords += 1;
    } else if (!CHORD_LINE_SYMBOL_PATTERN.test(token)) {
      return false;
    }
  }
  return chords > 0;
};

/** Transposes a chord line, keeping each chord over the lyric column it started on. */
const transposeChordLine = (
  line: string,
  semitones: number,
  to: MusicalKey
): string => {
  let result = "";
  for (const match of line.matchAll(WHITESPACE_TOKEN_PATTERN)) {
    const column = Math.max(match.index, result.length + (result ? 1 : 0));
    result = `${result.padEnd(column)}${transposeChordText(match[0], semitones, to)}`;
  }
  return result;
};

/** The chart's written key moved to another key: rewrites the chords in the text itself. */
export const transposeChordChartText = (
  text: string,
  from: MusicalKey,
  to: MusicalKey
): string => {
  const semitones = semitonesBetween(from, to);
  if (semitones === 0) {
    return text;
  }
  return text
    .split("\n")
    .map((line) => {
      if (isChordLine(line)) {
        return transposeChordLine(line, semitones, to);
      }
      return line.replaceAll(
        BRACKETED_CHORD_PATTERN,
        (_match, chord: string) =>
          `[${transposeChordText(chord, semitones, to)}]`
      );
    })
    .join("\n");
};
