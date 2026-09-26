import { searchLyrics } from "@pcobooster/api/modules/lyrics/lrclib-search";
import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

const record = (id: number, lyrics: string | null, instrumental = false) => ({
  id,
  trackName: "Build My Life",
  artistName: "Pat Barrett",
  albumName: "Build My Life",
  duration: 256,
  instrumental,
  plainLyrics: lyrics,
});

type LrclibBody = ReturnType<typeof record>[] | { error: string };

const respond = (status: number, body: LrclibBody) =>
  vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json(body, { status }));

describe(searchLyrics, () => {
  it("asks LRCLIB with a User-Agent and keeps each distinct lyric once", async () => {
    const fetch = respond(200, [
      record(1, "Worthy of every song"),
      record(2, "Worthy of every song!"),
      record(3, null),
      record(4, "Instrumental", true),
      record(5, "Holy, there is no one like You"),
    ]);
    const results = await Effect.runPromise(
      searchLyrics("build my life", { fetch })
    );
    expect(results).toStrictEqual([
      {
        id: "1",
        title: "Build My Life",
        artist: "Pat Barrett",
        album: "Build My Life",
        durationSeconds: 256,
        lyrics: "Worthy of every song",
      },
      {
        id: "5",
        title: "Build My Life",
        artist: "Pat Barrett",
        album: "Build My Life",
        durationSeconds: 256,
        lyrics: "Holy, there is no one like You",
      },
    ]);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toStrictEqual(
      new URL("https://lrclib.net/api/search?q=build+my+life")
    );
    expect(new Headers(init?.headers).get("User-Agent")).toContain(
      "pcobooster.com"
    );
  });

  it("reports rate limits and unexpected answers instead of empty results", async () => {
    const limited = await Effect.runPromiseExit(
      searchLyrics("song", {
        fetch: respond(429, { error: "Too many requests" }),
      })
    );
    expect(JSON.stringify(limited)).toContain("RateLimited");
    const malformed = await Effect.runPromiseExit(
      searchLyrics("song", { fetch: respond(200, { error: "nope" }) })
    );
    expect(Exit.isFailure(malformed)).toBeTruthy();
    expect(JSON.stringify(malformed)).toContain("ExternalServiceFailure");
  });
});
