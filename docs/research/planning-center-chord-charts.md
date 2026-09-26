# Planning Center chord charts

How Services stores Lyrics & Chords, and what the Songs editor (`/songs/$songId`) writes back.

## Storage and API

- A chart belongs to an **arrangement**: `Arrangement.chord_chart` (Services API `2018-11-01`), "a string of lyrics and chords. Supports standard and ChordPro formats."
- The API allows creating and updating arrangements. Both `create_assignable` and `update_assignable` include `chord_chart`, `chord_chart_key`, `chord_chart_font`, `chord_chart_font_size`, `chord_chart_columns`, `chord_chart_chord_color`, `print_page_size`, `print_orientation`, `print_margin`, `name`, `bpm`, `meter`, and `sequence`.
  - `PATCH /services/v2/songs/{song_id}/arrangements/{arrangement_id}`
  - `POST /services/v2/songs/{song_id}/arrangements`
- `lyrics`, `has_chords`, `sequence_short`, and `arrangement_sections` are read-only values Services derives from the chart.
- `chord_chart_key` is the key the chords are written in. Services transposes from it for other keys and for number and numeral charts, so the saved text is the one source of truth.
- The API reports print settings with the organization's defaults filled in (`chord_chart_font` reads `Times-Roman` even when the chart's own setting is unset), so the editor writes only settings the user changed; `null` resets one to the default.
- Services' Formatting dialog offers (read from its page data, September 2026):
  - Fonts: `Helvetica` (Arial, Helvetica), `Courier`, `Monaco`, `Times-Roman`, `Noto Sans`.
  - Chord colors: `chord_chart_chord_color` 0 to 5 for Black, Blue, Green, Orange, Purple, Red.
  - Columns 1 or 2, the 17 font sizes, and the page sizes, orientations, and margins above.

## Rendered PDFs

Services renders every chart PDF itself, and the API exposes them as virtual attachments:

- `GET /songs/{song}/arrangements/{arrangement}/keys/{key}/attachments` lists `chord_chart-{keyId}--` (`pco_type` `AttachmentChart::Chord`), one per arrangement key (plus alternate keys).
- `GET /songs/{song}/arrangements/{arrangement}/attachments` lists `lyric_chart-{arrangementId}` (`AttachmentChart::Lyric`).
- `POST …/attachments/{id}/open` returns an `AttachmentActivity` whose `attachment_url` is a short-lived link to the PDF. Opening logs a view; it changes nothing.
- Services renders only the saved chart. Its own editor saves as you type ("Auto-refresh", "Revert All Changes"), so the Songs editor does the same: with Auto-refresh on, a pause in typing saves, and the preview draws Services' PDF of the result with pdf.js. Keys the arrangement lacks, and number or numeral charts not enabled on it, return 404.

## Text format ("special codes")

From [Special codes for lyrics and chords](https://help.planningcenter.com/en/139441-special-codes-for-lyrics-and-chords.html) and [Use the Lyrics & Chords editor](https://help.planningcenter.com/en/139440-use-the-lyrics---chords-editor.html):

- `[G]` inline ChordPro chords are transposed and stay aligned. Chords written on the line above lyrics work too, but can drift when fonts or keys change.
- Section headings are section names on their own line in capitals: `VERSE 1`, `CHORUS`.
- `COLUMN_BREAK` and `PAGE_BREAK` break the layout; `{{ PAGE_BREAK }}` applies to chord charts only.
- `{ note }` prints on chord and lyric PDFs; `{{ note }}` prints on chord charts only.
- `TRANSPOSE KEY +1` moves the chords after it; `REDEFINE KEY +1` marks chords already written in the new key.
- `<b>`, `<i>`, `<u>`, and `<t>` style text.
- ChordPro directives such as `{title:}` or `{soc}` are not codes; Services prints braces as notes. The editor's import converts them.

## Starting from lyrics

- CCLI retired the SongSelect partner API and accepts no new partners, so there is no API route to fetch licensed lyrics. Services' own SongSelect integration (including editable ChordPro imports) stays inside Services.
- The editor searches [LRCLIB](https://lrclib.net/docs), a free, keyless community lyrics database with good coverage of worship songs, through `chordCharts.lyricsSearch` (one outside request, none to Planning Center). It sends a `User-Agent` as LRCLIB asks. Its lyrics carry no section names, so the editor numbers verses and prints repeated stanzas once as choruses. Genius offers no lyrics through its API, and Musixmatch's free tier returns partial lyrics.
- The editor also imports text a user pastes (a SongSelect ChordPro download, a chords-over-lyrics sheet, or plain lyrics), or starts from another arrangement's chart or lyrics through the API.
