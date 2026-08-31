/**
 * Reading what an episode actually contains.
 *
 * This is the group the server exists for. Every other tool in here answers a
 * question about metadata: who published it, when, how often, under what
 * category. These answer what was said.
 *
 * Podcast Index will tell you a transcript exists and hand you a URL. It will
 * not fetch it, and a URL is a dead end for a model, so the useful half of the
 * Podcasting 2.0 spec sits one step out of reach behind every plain wrapper.
 * These tools take that step: fetch the file from the publisher's host, work
 * out what format it really is, and return timestamped text.
 *
 * Two design decisions worth stating.
 *
 * **A full transcript is not returned by default.** A two hour episode is
 * roughly 120,000 characters, which is more context than almost any question
 * about it is worth. `get_transcript` returns a bounded window and says how
 * much is left, and `search_transcript` exists so that the common question,
 * "where did they talk about X", never needs the whole thing at all.
 *
 * **Failures here are ordinary, not exceptional.** These files live on the
 * publisher's own host. They 404, they move, they serve HTML error pages, and
 * they time out. That is the normal weather, so every error says whose fault it
 * is: a dead transcript URL is the podcaster's host being down, not Podcast
 * Index being wrong and not a bad call.
 */

import { z } from "zod";
import { NotFoundError, PodcastIndexError } from "../api/errors.js";
import { parseChapters } from "../api/chapters.js";
import {
  formatTimestamp,
  mergeCues,
  parseTranscript,
  searchCues,
  type Cue,
} from "../api/transcripts.js";
import { fence } from "../safety.js";
import type { Episode } from "../api/types.js";
import { clamp, classifyShow, defineTool, maxArg, showArg, type ToolContext } from "./kit.js";

/** Fetch one episode, or say plainly that it is not there. */
async function loadEpisode(ctx: ToolContext, episodeId: number): Promise<Episode> {
  const response = await ctx.api.episodeById(episodeId);
  const episode = Array.isArray(response.episode) ? response.episode[0] : response.episode;
  if (!episode || !episode.id) {
    throw new NotFoundError(
      `Podcast Index has no episode with id ${episodeId}. Episode ids come from get_episodes or a search result; a feed id will not work here.`,
      "episodes",
    );
  }
  return episode;
}

/**
 * Pick which transcript file to read when a publisher offers several.
 *
 * Preference order is JSON, then VTT, then SRT, then anything else, and it is
 * not arbitrary. Only the Podcasting 2.0 JSON format carries real speaker
 * fields, so choosing it turns an interview into an attributed conversation
 * where the same episode as SRT is an undifferentiated wall. VTT beats SRT
 * because its voice spans sometimes carry speakers too.
 */
function pickTranscript(episode: Episode, preferred?: string): { url: string; type: string } | undefined {
  const list = episode.transcripts?.length
    ? episode.transcripts
    : episode.transcriptUrl
      ? [{ url: episode.transcriptUrl, type: "" }]
      : [];
  if (!list.length) return undefined;

  if (preferred) {
    const wanted = list.find((t) => t.type?.toLowerCase().includes(preferred.toLowerCase()));
    if (wanted) return wanted;
  }

  const rank = (type: string): number => {
    const t = (type ?? "").toLowerCase();
    if (t.includes("json")) return 0;
    if (t.includes("vtt")) return 1;
    if (t.includes("srt") || t.includes("subrip")) return 2;
    return 3;
  };
  return [...list].sort((a, b) => rank(a.type) - rank(b.type))[0];
}

function noTranscript(episode: Episode): PodcastIndexError {
  return new NotFoundError(
    `"${episode.title ?? episode.id}" publishes no transcript. Most podcasts do not: the <podcast:transcript> tag is optional and a minority of feeds carry it. This is a fact about the show, not a failure of the lookup, and no amount of retrying will change it. Nothing here can transcribe the audio.`,
    "transcript",
  );
}

/** Render merged cues as timestamped, speaker-labelled text. */
function renderCues(cues: Cue[]): string {
  return cues
    .map((cue) => {
      const time = formatTimestamp(cue.start);
      return cue.speaker ? `[${time}] ${cue.speaker}: ${cue.text}` : `[${time}] ${cue.text}`;
    })
    .join("\n\n");
}

export const getTranscript = defineTool({
  name: "get_transcript",
  title: "Read an episode transcript",
  description:
    "Fetch and read the actual transcript of an episode, as timestamped text with speaker labels where the file has them. This is the tool that turns a podcast into something readable: Podcast Index only publishes a link to the transcript file, and this goes and gets it, works out whether it is SRT, WebVTT, JSON or HTML, and parses it. Long transcripts are returned in windows rather than whole, because a two hour episode is far more text than any single question needs; the response says how much remains and the offset to continue from. If you are looking for one specific moment, use search_transcript instead, which is one call rather than paging. Not every episode has a transcript, and most do not.",
  schema: {
    episode_id: z.number().int().describe("Podcast Index episode id, from get_episodes or a search."),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Character offset to resume from, for reading a long transcript in windows. Defaults to 0."),
    format: z
      .enum(["json", "vtt", "srt"])
      .optional()
      .describe("Force a particular transcript file when the publisher offers several. Defaults to the richest available, which is JSON where it exists because only JSON carries speaker names."),
  },
  risk: "read",
  surface: "web",
  handler: async (args, ctx) => {
    const episode = await loadEpisode(ctx, args.episode_id);
    const chosen = pickTranscript(episode, args.format);
    if (!chosen) throw noTranscript(episode);

    const file = await ctx.http.fetchFile(chosen.url, {
      accept: "text/vtt, application/json, application/x-subrip, text/plain, */*",
    });
    const parsed = parseTranscript(file.body, chosen.type || file.contentType);
    if (!parsed.cues.length) {
      throw new PodcastIndexError(
        `The transcript at ${chosen.url} was fetched but contained no readable text. The file exists and the URL works, so this is usually a publisher serving an empty or placeholder transcript.`,
        0,
        "transcript",
        { surface: "web" },
      );
    }

    const merged = mergeCues(parsed.cues);
    const full = renderCues(merged);
    const offset = args.offset ?? 0;
    const window = full.slice(offset, offset + ctx.config.maxTranscriptChars);
    const remaining = Math.max(0, full.length - (offset + window.length));

    const header =
      `<transcript` +
      ` episode_id="${episode.id}"` +
      ` episode="${(episode.title ?? "").replace(/"/g, "'")}"` +
      ` show="${(episode.feedTitle ?? "").replace(/"/g, "'")}"` +
      ` format="${parsed.format}"` +
      ` segments="${merged.length}"` +
      ` speakers="${parsed.speakers.length ? parsed.speakers.join(", ") : "none labelled"}"` +
      ` offset="${offset}"` +
      ` returned_chars="${window.length}"` +
      ` remaining_chars="${remaining}"` +
      (parsed.untimed ? ` timed="false"` : "") +
      `>`;

    const notes: string[] = [];
    if (remaining > 0) {
      notes.push(
        `  <note>${remaining} characters remain. Call again with offset=${offset + window.length} to continue, or use search_transcript to jump straight to a phrase.</note>`,
      );
    }
    if (parsed.untimed) {
      notes.push(
        `  <note>This transcript carries no timing information, so every timestamp reads 0:00. The publisher supplied prose rather than a timed caption file.</note>`,
      );
    }
    if (file.truncated) {
      notes.push(`  <note>The source file was unusually large and was truncated on download.</note>`);
    }

    return `${header}\n${notes.join("\n")}${notes.length ? "\n" : ""}${fence("transcript", window)}\n</transcript>`;
  },
});

export const searchTranscript = defineTool({
  name: "search_transcript",
  title: "Find where something was said",
  description:
    "Search inside an episode's transcript and return the moments a phrase was said, each with a timestamp, the speaker where known, and the surrounding conversation. This is the fast path for 'when did they talk about X': one call, no paging, and the timestamp tells you where to skip to in the audio. Matching is literal and case-insensitive rather than semantic, so search for the words that would actually have been spoken and try a couple of phrasings before concluding a topic never came up. An empty result means those words are absent, not that the subject was not discussed.",
  schema: {
    episode_id: z.number().int().describe("Podcast Index episode id."),
    query: z.string().min(2).describe("The phrase to find. Literal substring match, case-insensitive."),
    ...maxArg(20, "How many matching moments to return."),
  },
  risk: "read",
  surface: "web",
  handler: async (args, ctx) => {
    const episode = await loadEpisode(ctx, args.episode_id);
    const chosen = pickTranscript(episode);
    if (!chosen) throw noTranscript(episode);

    const file = await ctx.http.fetchFile(chosen.url, {
      accept: "text/vtt, application/json, application/x-subrip, text/plain, */*",
    });
    const parsed = parseTranscript(file.body, chosen.type || file.contentType);
    const merged = mergeCues(parsed.cues);
    const matches = searchCues(merged, args.query, clamp(args.max, 20));

    const header =
      `<transcript_matches` +
      ` episode_id="${episode.id}"` +
      ` episode="${(episode.title ?? "").replace(/"/g, "'")}"` +
      ` query="${args.query.replace(/"/g, "'")}"` +
      ` count="${matches.length}"` +
      ` searched_segments="${merged.length}"` +
      `>`;

    if (!matches.length) {
      return `${header}\n  <note>Those exact words do not appear in this transcript. The search is literal, so try a different phrasing before concluding the topic was not discussed.</note>\n</transcript_matches>`;
    }

    const body = matches
      .map(
        (m) =>
          `  <match at="${m.timestamp}" seconds="${Math.floor(m.start)}"${
            m.speaker ? ` speaker="${m.speaker.replace(/"/g, "'")}"` : ""
          }>\n${fence("transcript", m.excerpt)}\n  </match>`,
      )
      .join("\n");
    return `${header}\n${body}\n</transcript_matches>`;
  },
});

export const getChapters = defineTool({
  name: "get_chapters",
  title: "Read an episode's chapters",
  description:
    "Fetch and read the chapter list a publisher attached to an episode: titles, start times, images and links. Chapters are the publisher's own table of contents, so this answers 'what is in this episode and when' far more cheaply than reading the transcript. Chapters the publisher marked as excluded from the table of contents are kept and labelled rather than dropped, because in practice that flag marks sponsor reads and hiding them would make the timeline misrepresent the episode. Like transcripts, chapters are optional and most episodes have none.",
  schema: {
    episode_id: z.number().int().describe("Podcast Index episode id."),
  },
  risk: "read",
  surface: "web",
  handler: async (args, ctx) => {
    const episode = await loadEpisode(ctx, args.episode_id);
    if (!episode.chaptersUrl) {
      throw new NotFoundError(
        `"${episode.title ?? episode.id}" publishes no chapters. The <podcast:chapters> tag is optional and most episodes do not carry one. Nothing here can generate chapters from the audio.`,
        "chapters",
      );
    }

    const file = await ctx.http.fetchFile(episode.chaptersUrl, { accept: "application/json, */*" });
    const parsed = parseChapters(file.body);
    if (!parsed.chapters.length) {
      throw new PodcastIndexError(
        `The chapters file at ${episode.chaptersUrl} parsed cleanly but listed no chapters.`,
        0,
        "chapters",
        { surface: "web" },
      );
    }

    const rows = parsed.chapters
      .map((c) => {
        const time = formatTimestamp(c.startTime);
        const bits = [
          `  <chapter at="${time}" seconds="${Math.floor(c.startTime)}"`,
          c.title ? ` title="${c.title.replace(/"/g, "'")}"` : "",
          c.toc ? "" : ` in_contents="false"`,
          c.url ? ` link="${c.url.replace(/"/g, "&quot;")}"` : "",
          ` />`,
        ];
        return bits.join("");
      })
      .join("\n");

    const note = parsed.hiddenCount
      ? `\n  <note>${parsed.hiddenCount} of these are marked as not belonging in the table of contents, shown above as in_contents="false". Publishers use that flag for sponsor reads and interstitials.</note>`
      : "";

    return `<chapters episode_id="${episode.id}" episode="${(episode.title ?? "").replace(/"/g, "'")}" count="${parsed.chapters.length}"${
      parsed.version ? ` version="${parsed.version}"` : ""
    }>${note}\n${rows}\n</chapters>`;
  },
});

export const getSoundbites = defineTool({
  name: "get_soundbites",
  title: "Get an episode's soundbites",
  description:
    "The clips a publisher marked as the best moments of an episode, with start time and duration. Soundbites are the show's own pick of what is worth quoting, which makes them the cheapest possible answer to 'what is the highlight of this episode' and a ready-made list for promotional clips. Comes straight from the episode record with no extra fetch. Optional and uncommon, like the rest of the Podcasting 2.0 tags.",
  schema: {
    episode_id: z.number().int().describe("Podcast Index episode id."),
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const episode = await loadEpisode(ctx, args.episode_id);
    const bites = episode.soundbites ?? [];
    if (!bites.length) {
      throw new NotFoundError(
        `"${episode.title ?? episode.id}" publishes no soundbites. The <podcast:soundbite> tag is optional and uncommon.`,
        "soundbites",
      );
    }
    const rows = bites
      .map(
        (b) =>
          `  <soundbite at="${formatTimestamp(b.startTime)}" seconds="${Math.floor(
            b.startTime,
          )}" duration_seconds="${b.duration}"${b.title ? ` title="${b.title.replace(/"/g, "'")}"` : ""} />`,
      )
      .join("\n");
    return `<soundbites episode_id="${episode.id}" count="${bites.length}"${
      episode.enclosureUrl ? ` audio="${episode.enclosureUrl.replace(/"/g, "&quot;")}"` : ""
    }>\n${rows}\n</soundbites>`;
  },
});

export const findTranscripts = defineTool({
  name: "find_transcripts",
  title: "Find which episodes have transcripts",
  description:
    "Scan a show's recent episodes and report which of them publish a transcript or chapters, without fetching any of the files. Call this before get_transcript or search_transcript on an unfamiliar show: it is one request, and it tells you whether the show transcribes at all rather than discovering it through a failed lookup per episode. A show that transcribes usually transcribes everything, and a show that does not never will.",
  schema: {
    ...showArg,
    ...maxArg(50, "How many recent episodes to check."),
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const ref = classifyShow(args.show);
    const max = clamp(args.max, 50);
    const response =
      ref.kind === "feedId"
        ? await ctx.api.episodesByFeedId({ id: ref.value, max })
        : ref.kind === "feedUrl"
          ? await ctx.api.episodesByFeedUrl({ url: ref.value, max })
          : ref.kind === "guid"
            ? await ctx.api.episodesByPodcastGuid({ guid: ref.value, max })
            : await ctx.api.episodesByItunesId({ id: ref.value, max });

    const items = response.items ?? [];
    const withTranscript = items.filter((e) => e.transcripts?.length || e.transcriptUrl);
    const withChapters = items.filter((e) => e.chaptersUrl);

    const rows = items
      .map((e) => {
        const t = pickTranscript(e);
        return `  <episode episode_id="${e.id}" title="${(e.title ?? "").replace(/"/g, "'")}" transcript="${
          t ? (t.type || "yes") : "no"
        }" chapters="${e.chaptersUrl ? "yes" : "no"}" />`;
      })
      .join("\n");

    const verdict =
      withTranscript.length === 0
        ? "This show publishes no transcripts on the episodes checked. get_transcript will fail for all of them."
        : withTranscript.length === items.length
          ? "Every episode checked has a transcript."
          : `${withTranscript.length} of ${items.length} episodes checked have a transcript.`;

    return `<transcript_coverage show="${args.show.replace(/"/g, "'")}" checked="${items.length}" with_transcript="${
      withTranscript.length
    }" with_chapters="${withChapters.length}">\n  <note>${verdict}</note>\n${rows}\n</transcript_coverage>`;
  },
});

export const CONTENT_TOOLS = [
  getTranscript,
  searchTranscript,
  getChapters,
  getSoundbites,
  findTranscripts,
];
