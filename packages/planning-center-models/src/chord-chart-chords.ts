/**
 * Chord and key arithmetic for Planning Center chord charts (`Arrangement.chord_chart`):
 * reading keys and chords and transposing chords into another key.
 */

const SEMITONES = 12;

const NOTE_PITCHES = new Map<string, number>([
  ["C", 0],
  ["B#", 0],
  ["C#", 1],
  ["Db", 1],
  ["D", 2],
  ["D#", 3],
  ["Eb", 3],
  ["E", 4],
  ["Fb", 4],
  ["F", 5],
  ["E#", 5],
  ["F#", 6],
  ["Gb", 6],
  ["G", 7],
  ["G#", 8],
  ["Ab", 8],
  ["A", 9],
  ["A#", 10],
  ["Bb", 10],
  ["B", 11],
  ["Cb", 11],
]);

/** Planning Center's own scale for keys without a sharp or flat preference. */
const NEUTRAL_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;
const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;
const FLAT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

/** Major key names by pitch, as Planning Center lists them. */
const MAJOR_KEY_NAMES = NEUTRAL_NAMES;
const MINOR_KEY_NAMES = [
  "Cm",
  "C#m",
  "Dm",
  "Ebm",
  "Em",
  "Fm",
  "F#m",
  "Gm",
  "G#m",
  "Am",
  "Bbm",
  "Bm",
] as const;

/** Relative-major pitches whose key signatures use sharps and flats. */
const SHARP_KEY_PITCHES = new Set([7, 2, 9, 4, 11, 6, 1]);
const FLAT_KEY_PITCHES = new Set([5, 10, 3, 8]);

/** Every key Planning Center accepts for `chord_chart_key`, majors then minors. */
export const CHORD_CHART_KEYS: readonly string[] = [
  ...MAJOR_KEY_NAMES,
  ...MINOR_KEY_NAMES,
];

const MINOR_THIRD = 3;

export interface MusicalKey {
  /** Pitch class of the tonic, 0 (C) through 11 (B). */
  readonly pitch: number;
  readonly minor: boolean;
  /** The key as written, such as `F#m`. */
  readonly name: string;
}

const KEY_PATTERN = /^(?<root>[A-G])(?<accidental>[#b♯♭]?)(?<minor>m|min|-)?$/u;
const CHORD_PATTERN =
  /^(?<root>[A-G])(?<accidental>[#b♯♭]?)(?<quality>[^/]*?)(?:\/(?<bassRoot>[A-G])(?<bassAccidental>[#b♯♭]?))?$/u;
/** Chord qualities: `m7`, `sus4`, `maj7`, `add9`, `7(b9)`, `°`, `ø`, `∆`, `2`, and so on. */
const QUALITY_PATTERN =
  /^(?:maj|min|dim|aug|sus|add|alt|omit|no|m|M|°|ø|∆|Δ|\+|-|[0-9]|b|#|♭|♯|\(|\)|,)*$/u;
const CHORD_TOKEN_PATTERN = /[A-G][#b♯♭]?[^\s/|[\]{}]*(?:\/[A-G][#b♯♭]?)?/gu;

const normalizeAccidental = (accidental: string | undefined): string => {
  if (accidental === "♯") {
    return "#";
  }
  if (accidental === "♭") {
    return "b";
  }
  return accidental ?? "";
};

const pitchOf = (root: string, accidental: string | undefined) =>
  NOTE_PITCHES.get(`${root}${normalizeAccidental(accidental)}`);

const mod12 = (value: number) => ((value % SEMITONES) + SEMITONES) % SEMITONES;

/** The Planning Center name of a key, such as `Bb` or `F#m`. */
export const keyName = (pitch: number, minor: boolean): string =>
  (minor ? MINOR_KEY_NAMES : MAJOR_KEY_NAMES)[mod12(pitch)];

export const parseKey = (
  value: string | null | undefined
): MusicalKey | null => {
  const match = KEY_PATTERN.exec(value?.trim() ?? "");
  const groups = match?.groups;
  if (groups === undefined) {
    return null;
  }
  const pitch = pitchOf(groups.root, groups.accidental);
  if (pitch === undefined) {
    return null;
  }
  const minor = groups.minor !== undefined;
  return { pitch, minor, name: keyName(pitch, minor) };
};

export const transposeKey = (
  key: MusicalKey,
  semitones: number
): MusicalKey => {
  const pitch = mod12(key.pitch + semitones);
  return { pitch, minor: key.minor, name: keyName(pitch, key.minor) };
};

/** Semitones to move from one key to another, choosing the smaller direction. */
export const semitonesBetween = (from: MusicalKey, to: MusicalKey): number => {
  const up = mod12(to.pitch - from.pitch);
  return up > SEMITONES / 2 ? up - SEMITONES : up;
};

/** Note names that read naturally in a key: sharps in G, flats in F, Planning Center's in C. */
const noteNamesFor = (key: MusicalKey | null): readonly string[] => {
  if (key === null) {
    return NEUTRAL_NAMES;
  }
  const relativeMajor = key.minor ? mod12(key.pitch + MINOR_THIRD) : key.pitch;
  if (SHARP_KEY_PITCHES.has(relativeMajor)) {
    return SHARP_NAMES;
  }
  if (FLAT_KEY_PITCHES.has(relativeMajor)) {
    return FLAT_NAMES;
  }
  return NEUTRAL_NAMES;
};

export interface ParsedChord {
  readonly pitch: number;
  readonly quality: string;
  readonly bassPitch: number | null;
}

export const parseChord = (value: string): ParsedChord | null => {
  const groups = CHORD_PATTERN.exec(value)?.groups;
  if (groups === undefined || !QUALITY_PATTERN.test(groups.quality)) {
    return null;
  }
  const pitch = pitchOf(groups.root, groups.accidental);
  if (pitch === undefined) {
    return null;
  }
  const bassPitch =
    groups.bassRoot === undefined
      ? null
      : (pitchOf(groups.bassRoot, groups.bassAccidental) ?? null);
  return { pitch, quality: groups.quality, bassPitch };
};

export const isChord = (value: string): boolean => parseChord(value) !== null;

/** Rewrites every chord token in `text`, leaving anything that is not a chord untouched. */
const mapChordTokens = (
  text: string,
  format: (chord: ParsedChord) => string
): string =>
  text.replaceAll(CHORD_TOKEN_PATTERN, (token) => {
    const chord = parseChord(token);
    return chord === null ? token : format(chord);
  });

/** Moves every chord in `text` by `semitones`, spelled for `targetKey`. */
export const transposeChordText = (
  text: string,
  semitones: number,
  targetKey: MusicalKey | null
): string => {
  const names = noteNamesFor(targetKey);
  return mapChordTokens(text, (chord) => {
    const root = names[mod12(chord.pitch + semitones)];
    const bass =
      chord.bassPitch === null
        ? ""
        : `/${names[mod12(chord.bassPitch + semitones)]}`;
    return `${root}${chord.quality}${bass}`;
  });
};
