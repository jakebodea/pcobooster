/**
 * Turns pasted text into Planning Center Lyrics & Chords text: ChordPro files (such as a
 * SongSelect download), chords written above lyrics, or plain lyrics copied from anywhere.
 * The result uses inline ChordPro chords so they stay aligned when Services transposes them.
 */
import {
  COLUMN_BREAK,
  PAGE_BREAK,
  isChordLine,
  isSectionHeading,
} from "@pcobooster/planning-center-models/chord-chart";

export type ChordChartImportFormat =
  | "chordpro-file"
  | "chords-over-lyrics"
  | "inline-chords"
  | "lyrics";

export interface ChordChartImportMetadata {
  readonly title?: string;
  readonly artist?: string;
  readonly key?: string;
  readonly tempo?: string;
  readonly time?: string;
}

export interface ChordChartImport {
  readonly format: ChordChartImportFormat;
  readonly chart: string;
  readonly metadata: ChordChartImportMetadata;
}

const DIRECTIVE_PATTERN =
  /^\{(?<name>[a-z_]+)(?:\s*[:\s]\s*(?<value>.*?))?\s*\}$/iu;
const WORD_PATTERN = /\S+/gu;
const BRACKETED_SECTION_PATTERN = /^[[(](?<label>[^\])]+)[\])]:?$/u;
/** Copyright and license lines SongSelect and lyric sites append; Services prints its own. */
const FOOTER_PATTERN =
  /^(?:ccli\s+(?:song|licen[cs]e)|©|\(c\)|copyright\b|for use solely with the songselect|note:\s*reproduction|www\.ccli\.com|songselect\b)/iu;
const EXCESS_BLANK_LINES_PATTERN = /\n{3,}/gu;
const TRAILING_SPACE_PATTERN = /[ \t]+$/gmu;

/** Section directives and the heading each prints when it names no label. */
const SECTION_DIRECTIVES = new Map([
  ["soc", "CHORUS"],
  ["start_of_chorus", "CHORUS"],
  ["sov", "VERSE"],
  ["start_of_verse", "VERSE"],
  ["sob", "BRIDGE"],
  ["start_of_bridge", "BRIDGE"],
]);
const COMMENT_DIRECTIVES = new Set([
  "c",
  "comment",
  "ci",
  "comment_italic",
  "cb",
  "comment_box",
  "highlight",
]);
const METADATA_DIRECTIVES = new Map<string, keyof ChordChartImportMetadata>([
  ["t", "title"],
  ["title", "title"],
  ["artist", "artist"],
  ["a", "artist"],
  ["key", "key"],
  ["tempo", "tempo"],
  ["time", "time"],
]);

const tidy = (text: string): string =>
  `${text
    .replaceAll(TRAILING_SPACE_PATTERN, "")
    .replaceAll(EXCESS_BLANK_LINES_PATTERN, "\n\n")
    .trim()}\n`;

/** `Verse 1`, `[Chorus]`, and `(Bridge):` become Planning Center headings: `VERSE 1`. */
const toHeading = (line: string): string | null => {
  const trimmed = line.trim();
  const bracketed = BRACKETED_SECTION_PATTERN.exec(trimmed)?.groups?.label;
  const candidate = bracketed ?? trimmed;
  if (!isSectionHeading(candidate)) {
    return null;
  }
  return candidate.replace(/:$/u, "").trim().toUpperCase();
};

/** Headings get a blank line above them, as Services spaces sections. */
const pushHeading = (lines: string[], heading: string) => {
  if (lines.length > 0 && lines.at(-1) !== "") {
    lines.push("");
  }
  lines.push(heading);
};

/** Places each chord of a chord line into the lyric line below it as `[Chord]`. */
export const mergeChordsIntoLyrics = (
  chordLine: string,
  lyricLine: string
): string => {
  const chords = [...chordLine.matchAll(WORD_PATTERN)];
  const lastColumn = chords.at(-1)?.index ?? 0;
  let lyric = lyricLine.padEnd(lastColumn);
  for (const chord of chords.toReversed()) {
    lyric = `${lyric.slice(0, chord.index)}[${chord[0]}]${lyric.slice(chord.index)}`;
  }
  return lyric.replace(/\s+$/u, "");
};

export const detectChordChartFormat = (
  text: string
): ChordChartImportFormat => {
  const lines = text.split(/\r?\n/u);
  if (lines.some((line) => DIRECTIVE_PATTERN.test(line.trim()))) {
    return "chordpro-file";
  }
  if (lines.some((line) => isChordLine(line))) {
    return "chords-over-lyrics";
  }
  if (
    lines.some((line) => /\[[^\]]+\]/u.test(line) && toHeading(line) === null)
  ) {
    return "inline-chords";
  }
  return "lyrics";
};

const convertChordProFile = (text: string) => {
  const metadata: Record<string, string> = {};
  const lines: string[] = [];
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+$/u, "");
    if (line.startsWith("#")) {
      continue;
    }
    const directive = DIRECTIVE_PATTERN.exec(line.trim())?.groups;
    if (directive === undefined) {
      lines.push(toHeading(line) ?? line);
      continue;
    }
    const name = directive.name.toLowerCase();
    const value = directive.value?.trim() ?? "";
    const metadataField = METADATA_DIRECTIVES.get(name);
    const sectionHeading = SECTION_DIRECTIVES.get(name);
    if (metadataField !== undefined) {
      metadata[metadataField] = value;
    } else if (sectionHeading !== undefined) {
      pushHeading(
        lines,
        value.length > 0 ? value.toUpperCase() : sectionHeading
      );
    } else if (COMMENT_DIRECTIVES.has(name)) {
      const heading = toHeading(value);
      if (heading === null) {
        lines.push(`{ ${value} }`);
      } else {
        pushHeading(lines, heading);
      }
    } else if (name === "np" || name === "new_page" || name === "npp") {
      lines.push(PAGE_BREAK);
    } else if (name === "column_break" || name === "colb") {
      lines.push(COLUMN_BREAK);
    }
    // Every other directive (`{eoc}`, `{ccli}`, `{capo}`) would print as a note in
    // Services, so it is dropped.
  }
  return { chart: lines.join("\n"), metadata };
};

const convertChordsOverLyrics = (text: string): string => {
  const source = text.split(/\r?\n/u);
  const lines: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const line = source[index].replace(/\s+$/u, "");
    const heading = toHeading(line);
    if (heading !== null) {
      pushHeading(lines, heading);
      continue;
    }
    const next = source[index + 1];
    const nextIsLyric =
      next !== undefined &&
      next.trim().length > 0 &&
      !isChordLine(next) &&
      toHeading(next) === null;
    if (isChordLine(line) && nextIsLyric) {
      lines.push(mergeChordsIntoLyrics(line, next.replace(/\s+$/u, "")));
      index += 1;
      continue;
    }
    lines.push(line);
  }
  return lines.join("\n");
};

const normalizeHeadings = (text: string): string => {
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const heading = toHeading(line);
    if (heading === null) {
      lines.push(line);
    } else {
      pushHeading(lines, heading);
    }
  }
  return lines.join("\n");
};

const dropFooter = (text: string): string =>
  text
    .split(/\r?\n/u)
    .filter((line) => !FOOTER_PATTERN.test(line.trim()))
    .join("\n");

export const importChordChart = (text: string): ChordChartImport => {
  const source = dropFooter(text);
  const format = detectChordChartFormat(source);
  switch (format) {
    case "chordpro-file": {
      const { chart, metadata } = convertChordProFile(source);
      return { format, chart: tidy(chart), metadata };
    }
    case "chords-over-lyrics": {
      return {
        format,
        chart: tidy(convertChordsOverLyrics(source)),
        metadata: {},
      };
    }
    case "inline-chords":
    case "lyrics": {
      return { format, chart: tidy(normalizeHeadings(source)), metadata: {} };
    }
    default: {
      return format satisfies never;
    }
  }
};

const STANZA_BREAK_PATTERN = /\n\s*\n/u;
const NON_WORD_PATTERN = /[^\p{L}\p{N}]+/gu;

const stanzaKey = (stanza: string) =>
  stanza.toLowerCase().replaceAll(NON_WORD_PATTERN, "");

const toStanzas = (text: string): string[] =>
  text
    .split(STANZA_BREAK_PATTERN)
    .map((stanza) =>
      stanza
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .join("\n")
    )
    .filter((stanza) => stanza !== "");

/**
 * Plain lyrics, such as a lyrics site's, as a starting chart. Stanzas that repeat become
 * choruses and print once, the rest become numbered verses, as Services charts are usually
 * written; the arrangement's sequence gives the order. Lyrics that already name their
 * sections, or have no stanza breaks to go by, keep their own shape.
 */
export const lyricsToChordChart = (text: string): string => {
  const source = dropFooter(text.replaceAll("\r\n", "\n"));
  const stanzas = toStanzas(source);
  const labelled = source.split("\n").some((line) => toHeading(line) !== null);
  if (labelled || stanzas.length < 2) {
    return importChordChart(source).chart;
  }
  const counts = new Map<string, number>();
  for (const stanza of stanzas) {
    const key = stanzaKey(stanza);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeated: string[] = [];
  for (const [key, count] of counts) {
    if (count > 1) {
      repeated.push(key);
    }
  }
  const printed = new Set<string>();
  const lines: string[] = [];
  let verse = 0;
  for (const stanza of stanzas) {
    const key = stanzaKey(stanza);
    if (printed.has(key)) {
      continue;
    }
    printed.add(key);
    const chorus = repeated.indexOf(key);
    if (chorus === -1) {
      verse += 1;
      lines.push(`VERSE ${verse}`);
    } else {
      lines.push(repeated.length === 1 ? "CHORUS" : `CHORUS ${chorus + 1}`);
    }
    lines.push(stanza, "");
  }
  return tidy(lines.join("\n"));
};
