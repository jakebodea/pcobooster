import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  matchRecentSongs,
  readRecentSongs,
  rememberRecentSong,
} from "@/lib/recent-songs";

const installLocalStorageMock = () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
    dispatchEvent: () => true,
  });
};

const song = (id: string, title: string, author = "Writer") => ({
  id,
  title,
  author,
});

describe("recent songs", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("keeps the newest first, once each, up to eight", () => {
    for (let index = 1; index <= 9; index += 1) {
      rememberRecentSong(song(String(index), `Song ${index}`));
    }
    rememberRecentSong(song("5", "Song 5"));
    const recent = readRecentSongs();
    expect(recent.map((item) => item.id)).toStrictEqual([
      "5",
      "9",
      "8",
      "7",
      "6",
      "4",
      "3",
      "2",
    ]);
  });

  it("matches every query word against title and writers", () => {
    const songs = [
      song("1", "Build My Life", "Pat Barrett"),
      song("2", "Goodness of God", "Jenn Johnson"),
    ];
    expect(matchRecentSongs(songs, "build barrett")).toStrictEqual([songs[0]]);
    expect(matchRecentSongs(songs, "god")).toStrictEqual([songs[1]]);
    expect(matchRecentSongs(songs, "build god")).toStrictEqual([]);
  });
});
