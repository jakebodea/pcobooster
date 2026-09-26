import { Conflict } from "@pcobooster/api/application/errors/conflict";
import { ExternalServiceFailure } from "@pcobooster/api/application/errors/external-service-failure";
import { normalizeKeyOption } from "@pcobooster/api/modules/planning-center/plan-items-shared";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import type {
  ArrangementResponse,
  PlanningCenterSongsService,
} from "@pcobooster/api/planning-center/services/songs-service";
import {
  CHORD_CHART_CHORD_COLORS,
  CHORD_CHART_FONT_SIZES,
  CHORD_CHART_MARGINS,
  CHORD_CHART_MAX_COLUMNS,
  CHORD_CHART_ORIENTATIONS,
  CHORD_CHART_PAGE_SIZES,
} from "@pcobooster/contracts/chord-charts";
import type {
  ChordChartArrangement,
  ChordChartCreateInput,
  ChordChartLayout,
  ChordChartPdf,
  ChordChartPdfInput,
  ChordChartSong,
  ChordChartSongCreateInput,
  ChordChartSongOutput,
  ChordChartUpdateInput,
} from "@pcobooster/contracts/chord-charts";
import {
  isNonEmptyString,
  isNumber,
  isString,
} from "@pcobooster/planning-center-models/json";
import type {
  JsonObject,
  JsonValue,
} from "@pcobooster/planning-center-models/json";
import type {
  KeyOption,
  PCResource,
} from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

export type ChordChartSongsService = Pick<
  PlanningCenterSongsService,
  | "getSong"
  | "getSongArrangementsForEditing"
  | "getArrangement"
  | "updateArrangement"
  | "createArrangement"
  | "createSong"
  | "openChartAttachment"
>;

const toText = (value: JsonValue | undefined): string =>
  isString(value) ? value : "";

const toTextOrNull = (value: JsonValue | undefined): string | null =>
  isNonEmptyString(value) ? value : null;

const toNumberOrNull = (value: JsonValue | undefined): number | null =>
  isNumber(value) && Number.isFinite(value) ? value : null;

/** Values outside what the editor offers read as unset rather than failing the response. */
const oneOf = <Value extends string | number>(
  allowed: readonly Value[],
  value: JsonValue | undefined
): Value | null => allowed.find((option) => option === value) ?? null;

const toColumns = (value: JsonValue | undefined): number | null => {
  const columns = toNumberOrNull(value);
  return columns !== null &&
    Number.isInteger(columns) &&
    columns >= 1 &&
    columns <= CHORD_CHART_MAX_COLUMNS
    ? columns
    : null;
};

const toChordColor = (value: JsonValue | undefined): number | null => {
  const color = toNumberOrNull(value);
  return color !== null &&
    Number.isInteger(color) &&
    color >= 0 &&
    color < CHORD_CHART_CHORD_COLORS.length
    ? color
    : null;
};

const toSequence = (attributes: JsonObject): string[] => {
  const short = attributes.sequence_short;
  const source =
    Array.isArray(short) && short.length > 0 ? short : attributes.sequence;
  if (!Array.isArray(source)) {
    return [];
  }
  return source.filter(
    (label): label is string => isString(label) && label.trim().length > 0
  );
};

const belongsToArrangement = (key: PCResource, arrangementId: string) => {
  const relationship = key.relationships?.arrangement?.data;
  return (
    relationship === undefined ||
    relationship === null ||
    (!Array.isArray(relationship) && relationship.id === arrangementId)
  );
};

const arrangementKeys = (
  included: readonly PCResource[],
  arrangementId: string
): KeyOption[] => {
  const keys: KeyOption[] = [];
  for (const item of included) {
    if (item.type === "Key" && belongsToArrangement(item, arrangementId)) {
      keys.push(normalizeKeyOption(item));
    }
  }
  return keys;
};

export const normalizeChordChartArrangement = (
  resource: PCResource,
  included: readonly PCResource[]
): ChordChartArrangement => {
  const { attributes } = resource;
  return {
    id: resource.id,
    name: toText(attributes.name),
    archived: isNonEmptyString(attributes.archived_at),
    bpm: toNumberOrNull(attributes.bpm),
    meter: toTextOrNull(attributes.meter),
    sequence: toSequence(attributes),
    chordChart: toText(attributes.chord_chart),
    chordChartKey: toTextOrNull(attributes.chord_chart_key),
    lyrics: toText(attributes.lyrics),
    keys: arrangementKeys(included, resource.id),
    layout: {
      font: toTextOrNull(attributes.chord_chart_font),
      fontSize: oneOf(CHORD_CHART_FONT_SIZES, attributes.chord_chart_font_size),
      columns: toColumns(attributes.chord_chart_columns),
      chordColor: toChordColor(attributes.chord_chart_chord_color),
      pageSize: oneOf(CHORD_CHART_PAGE_SIZES, attributes.print_page_size),
      orientation: oneOf(
        CHORD_CHART_ORIENTATIONS,
        attributes.print_orientation
      ),
      margin: oneOf(CHORD_CHART_MARGINS, attributes.print_margin),
    },
    updatedAt: toTextOrNull(attributes.updated_at),
  };
};

const normalizeChordChartSong = (resource: PCResource): ChordChartSong => ({
  id: resource.id,
  title: toText(resource.attributes.title),
  author: toText(resource.attributes.author),
  copyright: toText(resource.attributes.copyright),
  ccliNumber:
    isNumber(resource.attributes.ccli_number) ||
    isNonEmptyString(resource.attributes.ccli_number)
      ? String(resource.attributes.ccli_number)
      : null,
});

const normalizeArrangementResponse = (response: ArrangementResponse) =>
  normalizeChordChartArrangement(response.data, response.included);

/**
 * Only fields the caller sent are written. Services reports print settings with the
 * organization's defaults filled in, so writing unchanged ones would pin those defaults.
 */
export const buildChordChartAttributes = (input: {
  readonly chordChart: string;
  readonly chordChartKey: string | null;
  readonly layout?: Partial<ChordChartLayout>;
  readonly name?: string;
}): JsonObject => {
  const attributes: JsonObject = {
    chord_chart: input.chordChart,
    chord_chart_key: input.chordChartKey,
  };
  if (input.name !== undefined) {
    attributes.name = input.name;
  }
  const layout = input.layout ?? {};
  const fields: [keyof ChordChartLayout, string][] = [
    ["font", "chord_chart_font"],
    ["fontSize", "chord_chart_font_size"],
    ["columns", "chord_chart_columns"],
    ["chordColor", "chord_chart_chord_color"],
    ["pageSize", "print_page_size"],
    ["orientation", "print_orientation"],
    ["margin", "print_margin"],
  ];
  // A null resets the setting to the organization default.
  for (const [field, attribute] of fields) {
    const value = layout[field];
    if (value !== undefined) {
      attributes[attribute] = value;
    }
  }
  return attributes;
};

export const getChordChartSong = (
  songId: string,
  songs: ChordChartSongsService
): Effect.Effect<ChordChartSongOutput, PlanningCenterError> =>
  Effect.map(
    Effect.all(
      [songs.getSong(songId), songs.getSongArrangementsForEditing(songId)],
      { concurrency: "unbounded" }
    ),
    ([song, arrangements]) => ({
      song: normalizeChordChartSong(song),
      arrangements: arrangements.data.map((arrangement) =>
        normalizeChordChartArrangement(arrangement, arrangements.included)
      ),
    })
  );

export interface PreparedChordChartUpdate {
  readonly songId: string;
  readonly arrangementId: string;
  readonly attributes: JsonObject;
}

/** Refuses to overwrite a chart someone saved in Services after this edit began. */
export const prepareChordChartUpdate = (
  input: ChordChartUpdateInput,
  songs: ChordChartSongsService
): Effect.Effect<PreparedChordChartUpdate, PlanningCenterError | Conflict> =>
  Effect.gen(function* checkForNewerChart() {
    const current = yield* songs.getArrangement(
      input.songId,
      input.arrangementId
    );
    const currentUpdatedAt = toTextOrNull(current.data.attributes.updated_at);
    if (
      input.baseUpdatedAt !== null &&
      currentUpdatedAt !== null &&
      currentUpdatedAt !== input.baseUpdatedAt
    ) {
      return yield* new Conflict({
        message:
          "This arrangement changed in Planning Center after you opened it. Reload to see the latest version.",
        reason: "arrangement-updated",
      });
    }
    return {
      songId: input.songId,
      arrangementId: input.arrangementId,
      attributes: buildChordChartAttributes(input),
    };
  });

export const commitChordChartUpdate = (
  prepared: PreparedChordChartUpdate,
  songs: ChordChartSongsService
): Effect.Effect<ChordChartArrangement, PlanningCenterError> =>
  Effect.map(
    songs.updateArrangement(
      prepared.songId,
      prepared.arrangementId,
      prepared.attributes
    ),
    normalizeArrangementResponse
  );

export const createChordChartArrangement = (
  input: ChordChartCreateInput,
  songs: ChordChartSongsService
): Effect.Effect<ChordChartArrangement, PlanningCenterError> =>
  Effect.map(
    songs.createArrangement(input.songId, buildChordChartAttributes(input)),
    normalizeArrangementResponse
  );

const DEFAULT_ARRANGEMENT_NAME = "Default";

const buildSongAttributes = (input: ChordChartSongCreateInput): JsonObject => {
  const attributes: JsonObject = { title: input.title };
  if (input.author !== undefined && input.author !== "") {
    attributes.author = input.author;
  }
  if (input.copyright !== undefined && input.copyright !== "") {
    attributes.copyright = input.copyright;
  }
  if (input.ccliNumber !== undefined) {
    attributes.ccli_number = input.ccliNumber;
  }
  return attributes;
};

/**
 * Adds a song and makes sure it has an arrangement to write the chart in: Services may
 * create a default one itself, and otherwise this does. At most three requests.
 */
export const createChordChartSong = (
  input: ChordChartSongCreateInput,
  songs: ChordChartSongsService
): Effect.Effect<ChordChartSongOutput, PlanningCenterError> =>
  Effect.gen(function* addSong() {
    const song = yield* songs.createSong(buildSongAttributes(input));
    const existing = yield* songs.getSongArrangementsForEditing(song.id);
    const arrangements = existing.data.map((arrangement) =>
      normalizeChordChartArrangement(arrangement, existing.included)
    );
    if (arrangements.length === 0) {
      const created = yield* songs.createArrangement(
        song.id,
        buildChordChartAttributes({
          name: DEFAULT_ARRANGEMENT_NAME,
          chordChart: "",
          chordChartKey: null,
        })
      );
      arrangements.push(normalizeArrangementResponse(created));
    }
    return { song: normalizeChordChartSong(song), arrangements };
  });

const PDF_DOWNLOAD_TIMEOUT_MS = 15_000;
const BASE64_CHUNK_BYTES = 0x80_00;

/** Base64 without Node's Buffer, which Workers only have with compatibility flags. */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK_BYTES) {
    binary += String.fromCodePoint(
      ...bytes.subarray(start, start + BASE64_CHUNK_BYTES)
    );
  }
  return btoa(binary);
};

export interface ChordChartPdfDependencies {
  readonly songs: Pick<ChordChartSongsService, "openChartAttachment">;
  readonly fetch: typeof globalThis.fetch;
}

const pdfFailure = (message: string, cause?: unknown) =>
  new ExternalServiceFailure({ message, service: "planning-center", cause });

/**
 * The PDF Services itself renders from the saved chart: a key's chord chart, or the lyrics
 * sheet. Two requests: Planning Center's `open` action, then the file it points to.
 */
export const getChordChartPdf = (
  input: ChordChartPdfInput,
  { songs, fetch }: ChordChartPdfDependencies
): Effect.Effect<ChordChartPdf, PlanningCenterError | ExternalServiceFailure> =>
  Effect.gen(function* renderChart() {
    const arrangementPath = `/services/v2/songs/${input.songId}/arrangements/${input.arrangementId}`;
    const attachmentPath =
      input.keyId === undefined
        ? `${arrangementPath}/attachments/lyric_chart-${input.arrangementId}`
        : `${arrangementPath}/keys/${input.keyId}/attachments/chord_chart-${input.keyId}--`;
    const url = yield* songs.openChartAttachment(attachmentPath);
    if (url === "") {
      return yield* pdfFailure(
        "Planning Center did not return the chart's PDF."
      );
    }
    const response = yield* Effect.tryPromise({
      try: async (signal) =>
        await fetch(url, {
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(PDF_DOWNLOAD_TIMEOUT_MS),
          ]),
        }),
      catch: (cause) =>
        pdfFailure("The chart's PDF could not be downloaded.", cause),
    });
    if (!response.ok) {
      return yield* pdfFailure(
        `The chart's PDF download answered ${String(response.status)}.`
      );
    }
    const bytes = yield* Effect.tryPromise({
      try: async () => new Uint8Array(await response.arrayBuffer()),
      catch: (cause) => pdfFailure("The chart's PDF could not be read.", cause),
    });
    return {
      filename: input.keyId === undefined ? "lyrics.pdf" : "chord-chart.pdf",
      data: bytesToBase64(bytes),
    };
  });
