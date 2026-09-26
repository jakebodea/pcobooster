import type { RequestContext } from "@pcobooster/api/application/context";
import type { ApplicationFault } from "@pcobooster/api/application/errors";
import { NotFound } from "@pcobooster/api/application/errors/not-found";
import { featureFlagSubjectFor } from "@pcobooster/api/application/feature-flags";
import {
  PlanningCenterAccess,
  withPlanningCenterFaults,
} from "@pcobooster/api/application/planning-center-access";
import type { PlanningCenterRequestAccess } from "@pcobooster/api/application/planning-center-access";
import { searchLyrics } from "@pcobooster/api/modules/lyrics/lrclib-search";
import type { LyricsSearchDependencies } from "@pcobooster/api/modules/lyrics/lrclib-search";
import {
  commitChordChartUpdate,
  createChordChartArrangement,
  createChordChartSong,
  getChordChartPdf,
  getChordChartSong,
  prepareChordChartUpdate,
} from "@pcobooster/api/modules/planning-center/chord-charts";
import type { PreparedChordChartUpdate } from "@pcobooster/api/modules/planning-center/chord-charts";
import { Server } from "@pcobooster/api/server";
import type {
  ChordChartArrangement,
  ChordChartCreateInput,
  ChordChartPdf,
  ChordChartPdfInput,
  ChordChartSongCreateInput,
  ChordChartSongInput,
  ChordChartSongOutput,
  ChordChartUpdateInput,
  LyricsSearchInput,
  LyricsSearchResult,
} from "@pcobooster/contracts/chord-charts";
import { Effect } from "effect";

type ChordChartRequirements = PlanningCenterAccess | RequestContext | Server;

/** The editor and its writes exist only where the `chordCharts` flag is on for this caller. */
const requireChordCharts = (access: PlanningCenterRequestAccess) =>
  Effect.gen(function* checkChordChartsFlag() {
    const { featureFlags } = yield* Server;
    const enabled = yield* featureFlags.isEnabled(
      "chordCharts",
      featureFlagSubjectFor(access.authentication)
    );
    if (!enabled) {
      yield* Effect.fail(
        new NotFound({
          message: "The chord chart editor is not enabled.",
          resource: "chord-charts",
        })
      );
    }
  });

export const readChordChartSong = (
  input: ChordChartSongInput
): Effect.Effect<
  ChordChartSongOutput,
  ApplicationFault,
  ChordChartRequirements
> =>
  Effect.gen(function* readSongCharts() {
    const access = yield* PlanningCenterAccess;
    yield* requireChordCharts(access);
    return yield* getChordChartSong(input.songId, access.services.songs);
  }).pipe(withPlanningCenterFaults);

export const prepareChordChartSave = (
  input: ChordChartUpdateInput
): Effect.Effect<
  PreparedChordChartUpdate,
  ApplicationFault,
  ChordChartRequirements
> =>
  Effect.gen(function* prepareSave() {
    const access = yield* PlanningCenterAccess;
    yield* requireChordCharts(access);
    return yield* prepareChordChartUpdate(input, access.services.songs);
  }).pipe(withPlanningCenterFaults);

export const commitChordChartSave = (
  prepared: PreparedChordChartUpdate
): Effect.Effect<
  ChordChartArrangement,
  ApplicationFault,
  PlanningCenterAccess
> =>
  Effect.gen(function* commitSave() {
    const access = yield* PlanningCenterAccess;
    return yield* commitChordChartUpdate(prepared, access.services.songs);
  }).pipe(withPlanningCenterFaults);

export const createChordChart = (
  input: ChordChartCreateInput
): Effect.Effect<
  ChordChartArrangement,
  ApplicationFault,
  ChordChartRequirements
> =>
  Effect.gen(function* createArrangement() {
    const access = yield* PlanningCenterAccess;
    yield* requireChordCharts(access);
    return yield* createChordChartArrangement(input, access.services.songs);
  }).pipe(withPlanningCenterFaults);

/** Calls the Worker's `fetch` through a wrapper: invoked as a method it loses its binding. */
export const addChordChartSong = (
  input: ChordChartSongCreateInput
): Effect.Effect<
  ChordChartSongOutput,
  ApplicationFault,
  ChordChartRequirements
> =>
  Effect.gen(function* addSong() {
    const access = yield* PlanningCenterAccess;
    yield* requireChordCharts(access);
    return yield* createChordChartSong(input, access.services.songs);
  }).pipe(withPlanningCenterFaults);

/** Planning Center's own render of the saved chart, so the preview matches it exactly. */
export const readChordChartPdf = (
  input: ChordChartPdfInput
): Effect.Effect<ChordChartPdf, ApplicationFault, ChordChartRequirements> =>
  Effect.gen(function* readPdf() {
    const access = yield* PlanningCenterAccess;
    yield* requireChordCharts(access);
    return yield* getChordChartPdf(input, {
      songs: access.services.songs,
      fetch: async (request, init) => await globalThis.fetch(request, init),
    });
  }).pipe(withPlanningCenterFaults);

const workerLyricsSearch: LyricsSearchDependencies = {
  fetch: async (input, init) => await globalThis.fetch(input, init),
};

/** Lyrics from the web to start a chart; one request to LRCLIB, none to Planning Center. */
export const searchChordChartLyrics = (
  input: LyricsSearchInput,
  dependencies: LyricsSearchDependencies = workerLyricsSearch
): Effect.Effect<
  LyricsSearchResult[],
  ApplicationFault,
  ChordChartRequirements
> =>
  Effect.gen(function* searchSongLyrics() {
    const access = yield* PlanningCenterAccess;
    yield* requireChordCharts(access);
    return yield* searchLyrics(input.query, dependencies);
  }).pipe(withPlanningCenterFaults);
