import { z } from "zod";

import { readBrowserStorage, writeBrowserStorage } from "@/lib/browser-storage";

export const RECENT_SONGS_STORAGE_KEY = "pcobooster:recent-songs";
const MAX_RECENT_SONGS = 8;

const recentSongSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
});

export type RecentSong = z.output<typeof recentSongSchema>;

/**
 * Songs this browser opened most recently, newest first. The search catalog is cached for
 * up to an hour, so this is also how a song added moments ago is found again.
 */
export const parseRecentSongs = (stored: string | null): RecentSong[] => {
  if (stored === null) {
    return [];
  }
  try {
    const parsed = z.array(recentSongSchema).safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
};

export const readRecentSongs = (): RecentSong[] =>
  parseRecentSongs(readBrowserStorage(RECENT_SONGS_STORAGE_KEY));

export const rememberRecentSong = (song: RecentSong): void => {
  const others = readRecentSongs().filter((recent) => recent.id !== song.id);
  writeBrowserStorage(
    RECENT_SONGS_STORAGE_KEY,
    JSON.stringify(
      [
        { id: song.id, title: song.title, author: song.author },
        ...others,
      ].slice(0, MAX_RECENT_SONGS)
    )
  );
};

/** Recent songs whose title or writers contain every word of the query. */
export const matchRecentSongs = (
  songs: readonly RecentSong[],
  query: string
): RecentSong[] => {
  const words = query
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== "");
  return songs.filter((song) => {
    const haystack = `${song.title} ${song.author}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
};
