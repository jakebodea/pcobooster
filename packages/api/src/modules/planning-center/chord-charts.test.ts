import {
  buildChordChartAttributes,
  commitChordChartUpdate,
  bytesToBase64,
  createChordChartSong,
  getChordChartPdf,
  getChordChartSong,
  prepareChordChartUpdate,
} from "@pcobooster/api/modules/planning-center/chord-charts";
import type { ChordChartSongsService } from "@pcobooster/api/modules/planning-center/chord-charts";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

const arrangement = (attributes: PCResource["attributes"]): PCResource => ({
  id: "arr-1",
  type: "Arrangement",
  attributes: {
    name: "Default",
    chord_chart: "VERSE\n[G]Amazing grace",
    chord_chart_key: "G",
    chord_chart_font_size: 14,
    chord_chart_columns: 2,
    chord_chart_chord_color: 1,
    chord_chart_font: "Helvetica",
    print_page_size: "Letter",
    print_orientation: "Portrait",
    print_margin: "0.5in",
    bpm: 72,
    meter: "4/4",
    sequence: ["Verse 1", "Chorus 1"],
    sequence_short: ["V1", "C"],
    lyrics: "Amazing grace",
    updated_at: "2026-09-01T12:00:00Z",
    ...attributes,
  },
});

const key: PCResource = {
  id: "key-1",
  type: "Key",
  attributes: { name: "Default", starting_key: "G", ending_key: "G" },
  relationships: {
    arrangement: { data: { type: "Arrangement", id: "arr-1" } },
  },
};

const createSongs = () => {
  const songs = {
    getSong: vi.fn<ChordChartSongsService["getSong"]>(() =>
      Effect.succeed({
        id: "song-1",
        type: "Song",
        attributes: {
          title: "Amazing Grace",
          author: "John Newton",
          copyright: "Public Domain",
          ccli_number: 22_025,
        },
      })
    ),
    getSongArrangementsForEditing: vi.fn<
      ChordChartSongsService["getSongArrangementsForEditing"]
    >(() => Effect.succeed({ data: [arrangement({})], included: [key] })),
    getArrangement: vi.fn<ChordChartSongsService["getArrangement"]>(() =>
      Effect.succeed({ data: arrangement({}), included: [key] })
    ),
    updateArrangement: vi.fn<ChordChartSongsService["updateArrangement"]>(
      (_songId, _arrangementId, attributes) =>
        Effect.succeed({
          data: arrangement({
            ...attributes,
            updated_at: "2026-09-02T12:00:00Z",
          }),
          included: [key],
        })
    ),
    createArrangement: vi.fn<ChordChartSongsService["createArrangement"]>(
      (_songId, attributes) =>
        Effect.succeed({ data: arrangement(attributes), included: [] })
    ),
    createSong: vi.fn<ChordChartSongsService["createSong"]>((attributes) =>
      Effect.succeed({ id: "song-2", type: "Song", attributes })
    ),
    openChartAttachment: vi.fn<ChordChartSongsService["openChartAttachment"]>(
      () => Effect.succeed("https://files.example/chart.pdf")
    ),
  } satisfies ChordChartSongsService;
  return songs;
};

describe(getChordChartSong, () => {
  it("reads the song with each arrangement's chart, keys, and print settings", async () => {
    const result = await Effect.runPromise(
      getChordChartSong("song-1", createSongs())
    );
    expect(result).toStrictEqual({
      song: {
        id: "song-1",
        title: "Amazing Grace",
        author: "John Newton",
        copyright: "Public Domain",
        ccliNumber: "22025",
      },
      arrangements: [
        {
          id: "arr-1",
          name: "Default",
          archived: false,
          bpm: 72,
          meter: "4/4",
          sequence: ["V1", "C"],
          chordChart: "VERSE\n[G]Amazing grace",
          chordChartKey: "G",
          lyrics: "Amazing grace",
          keys: [
            { id: "key-1", name: "Default", startingKey: "G", endingKey: "G" },
          ],
          layout: {
            font: "Helvetica",
            fontSize: 14,
            columns: 2,
            chordColor: 1,
            pageSize: "Letter",
            orientation: "Portrait",
            margin: "0.5in",
          },
          updatedAt: "2026-09-01T12:00:00Z",
        },
      ],
    });
  });

  it("reads print settings the editor does not offer as unset", async () => {
    const songs = createSongs();
    songs.getSongArrangementsForEditing.mockReturnValue(
      Effect.succeed({
        data: [
          arrangement({
            chord_chart_font_size: 17,
            chord_chart_columns: 3,
            chord_chart_chord_color: 9,
            print_page_size: "Tabloid",
            chord_chart: null,
            chord_chart_key: "",
          }),
        ],
        included: [],
      })
    );
    const read = await Effect.runPromise(getChordChartSong("song-1", songs));
    const [result] = read.arrangements;
    expect(result?.layout).toStrictEqual({
      font: "Helvetica",
      fontSize: null,
      columns: null,
      chordColor: null,
      pageSize: null,
      orientation: "Portrait",
      margin: "0.5in",
    });
    expect(result?.chordChart).toBe("");
    expect(result?.chordChartKey).toBeNull();
  });
});

describe(buildChordChartAttributes, () => {
  it("writes the chart, key, and only the print settings sent; null resets one", () => {
    expect(
      buildChordChartAttributes({
        chordChart: "VERSE",
        chordChartKey: null,
        layout: { fontSize: 16, columns: null },
      })
    ).toStrictEqual({
      chord_chart: "VERSE",
      chord_chart_key: null,
      chord_chart_font_size: 16,
      chord_chart_columns: null,
    });
  });
});

describe(prepareChordChartUpdate, () => {
  const input = {
    songId: "song-1",
    arrangementId: "arr-1",
    chordChart: "CHORUS\n[C]New",
    chordChartKey: "C",
    layout: { columns: 1 },
  };

  it("saves over the version the edit started from", async () => {
    const songs = createSongs();
    const prepared = await Effect.runPromise(
      prepareChordChartUpdate(
        { ...input, baseUpdatedAt: "2026-09-01T12:00:00Z" },
        songs
      )
    );
    const saved = await Effect.runPromise(
      commitChordChartUpdate(prepared, songs)
    );
    expect(songs.updateArrangement).toHaveBeenCalledWith("song-1", "arr-1", {
      chord_chart: "CHORUS\n[C]New",
      chord_chart_key: "C",
      chord_chart_columns: 1,
    });
    expect(saved.chordChart).toBe("CHORUS\n[C]New");
    expect(saved.updatedAt).toBe("2026-09-02T12:00:00Z");
  });

  it("refuses to overwrite a chart saved in Planning Center since", async () => {
    const songs = createSongs();
    const exit = await Effect.runPromiseExit(
      prepareChordChartUpdate(
        { ...input, baseUpdatedAt: "2026-08-01T00:00:00Z" },
        songs
      )
    );
    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(JSON.stringify(exit)).toContain("arrangement-updated");
    expect(songs.updateArrangement).not.toHaveBeenCalled();
  });
});

describe(createChordChartSong, () => {
  it("adds the song with only the details given", async () => {
    const songs = createSongs();
    const result = await Effect.runPromise(
      createChordChartSong(
        { title: "New Song", author: "", ccliNumber: 7 },
        songs
      )
    );
    expect(songs.createSong).toHaveBeenCalledWith({
      title: "New Song",
      ccli_number: 7,
    });
    expect(result.song).toStrictEqual({
      id: "song-2",
      title: "New Song",
      author: "",
      copyright: "",
      ccliNumber: "7",
    });
    expect(result.arrangements.map((item) => item.id)).toStrictEqual(["arr-1"]);
    expect(songs.createArrangement).not.toHaveBeenCalled();
  });

  it("creates a Default arrangement when Services made none", async () => {
    const songs = createSongs();
    songs.getSongArrangementsForEditing.mockReturnValue(
      Effect.succeed({ data: [], included: [] })
    );
    const result = await Effect.runPromise(
      createChordChartSong({ title: "New Song" }, songs)
    );
    expect(songs.createArrangement).toHaveBeenCalledWith("song-2", {
      chord_chart: "",
      chord_chart_key: null,
      name: "Default",
    });
    expect(result.arrangements).toHaveLength(1);
  });
});

describe(getChordChartPdf, () => {
  const pdfBytes = new TextEncoder().encode("%PDF-1.5 chart");

  it("opens a key's chord chart and returns the PDF Services rendered", async () => {
    const songs = createSongs();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(pdfBytes, { status: 200 }));
    const pdf = await Effect.runPromise(
      getChordChartPdf(
        { songId: "song-1", arrangementId: "arr-1", keyId: "key-1" },
        { songs, fetch }
      )
    );
    expect(songs.openChartAttachment).toHaveBeenCalledWith(
      "/services/v2/songs/song-1/arrangements/arr-1/keys/key-1/attachments/chord_chart-key-1--"
    );
    expect(fetch.mock.calls[0]?.[0]).toBe("https://files.example/chart.pdf");
    expect(pdf).toStrictEqual({
      filename: "chord-chart.pdf",
      data: bytesToBase64(pdfBytes),
    });
    expect(atob(pdf.data)).toBe("%PDF-1.5 chart");
  });

  it("opens the lyrics sheet without a key and reports failed downloads", async () => {
    const songs = createSongs();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("gone", { status: 410 }));
    const exit = await Effect.runPromiseExit(
      getChordChartPdf(
        { songId: "song-1", arrangementId: "arr-1" },
        { songs, fetch }
      )
    );
    expect(songs.openChartAttachment).toHaveBeenCalledWith(
      "/services/v2/songs/song-1/arrangements/arr-1/attachments/lyric_chart-arr-1"
    );
    expect(JSON.stringify(exit)).toContain("ExternalServiceFailure");
  });
});
