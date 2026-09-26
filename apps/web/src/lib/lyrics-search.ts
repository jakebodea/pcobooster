/** Credits often list several writers; the first narrows a search best. */
const AUTHOR_SEPARATOR_PATTERN = /,|&|\band\b/u;

/** The song's title and first writer, the best first search. */
export const lyricsSearchQueryFor = (title: string, author: string): string => {
  const [firstAuthor = ""] = author.split(AUTHOR_SEPARATOR_PATTERN);
  return `${title} ${firstAuthor.trim()}`.trim();
};
