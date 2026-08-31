/**
 * Chapters, the other thing the API only points at.
 *
 * The Podcasting 2.0 <podcast:chapters> tag gives a URL to a JSON file the
 * publisher hosts. Podcast Index passes the URL through and never fetches it,
 * so a chapter list is one more thing that exists in principle and is
 * unreadable in practice until something goes and gets it.
 *
 * Chapters are worth the trip because they are the publisher's own table of
 * contents. They say what an episode covers and when, which answers "is this
 * episode about the thing I care about" far more cheaply than reading a
 * transcript, and they carry the links a host promised in the show notes.
 *
 * The format is stable and small, so this is mostly validation. The one real
 * decision is `toc`: the spec lets a publisher mark a chapter as not belonging
 * in a table of contents, which is how sponsor reads are usually flagged. They
 * are kept, and labelled, rather than dropped, because "where are the ads"
 * is a legitimate question and silently removing them would make the timeline
 * lie about what is in the episode.
 */

export type Chapter = {
  /** Seconds from the start of the episode. */
  startTime: number;
  endTime?: number;
  title?: string;
  img?: string;
  url?: string;
  /**
   * False when the publisher marked this as not belonging in a table of
   * contents, which in practice means an ad or a sponsor read.
   */
  toc: boolean;
  location?: { name?: string; geo?: string; osm?: string };
};

export type ParsedChapters = {
  version?: string;
  chapters: Chapter[];
  /** Chapters the publisher excluded from the table of contents. */
  hiddenCount: number;
};

export function parseChapters(body: string): ParsedChapters {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(
      "The chapters URL did not return JSON. Podcasting 2.0 chapters are a JSON file hosted by the publisher, and a URL that serves HTML here usually means the file has moved or the host is returning an error page.",
    );
  }

  const root = (parsed ?? {}) as { version?: unknown; chapters?: unknown };
  const raw = Array.isArray(root.chapters) ? root.chapters : Array.isArray(parsed) ? parsed : [];

  const chapters: Chapter[] = [];
  let hiddenCount = 0;

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const c = entry as Record<string, unknown>;
    const startTime = Number(c.startTime);
    // startTime is the only required field in the spec. An entry without one
    // cannot be placed on the timeline, so it is not a chapter.
    if (!Number.isFinite(startTime)) continue;

    const toc = c.toc === undefined ? true : Boolean(c.toc);
    if (!toc) hiddenCount++;

    const endTime = Number(c.endTime);
    chapters.push({
      startTime,
      ...(Number.isFinite(endTime) ? { endTime } : {}),
      ...(typeof c.title === "string" && c.title.trim() ? { title: c.title.trim() } : {}),
      ...(typeof c.img === "string" ? { img: c.img } : {}),
      ...(typeof c.url === "string" ? { url: c.url } : {}),
      toc,
      ...(c.location && typeof c.location === "object"
        ? { location: c.location as Chapter["location"] }
        : {}),
    });
  }

  chapters.sort((a, b) => a.startTime - b.startTime);

  return {
    ...(typeof root.version === "string" ? { version: root.version } : {}),
    chapters,
    hiddenCount,
  };
}
