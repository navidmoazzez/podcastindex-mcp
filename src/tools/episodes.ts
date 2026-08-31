/**
 * Episodes: a show's back catalogue, and one episode in detail.
 *
 * The same one-tool-many-endpoints choice as `get_podcast`, for the same
 * reason. What is specific here is `since`, which is the difference between
 * pulling forty episodes to find the three published this week and asking for
 * the three. Negative values are read as "seconds ago", because a model
 * computing a unix timestamp from a relative date gets it wrong often enough
 * to matter.
 */

import { z } from "zod";
import { NotFoundError } from "../api/errors.js";
import { renderEpisode, renderEpisodes } from "../format/render.js";
import { clamp, classifyShow, defineTool, maxArg, normalizeSince, showArg, sinceArg } from "./kit.js";

export const getEpisodes = defineTool({
  name: "get_episodes",
  title: "Get a show's episodes",
  description:
    "Episodes for one show, newest first. Takes any show identifier: feed id, RSS URL, podcast GUID, Apple link or iTunes id. Each episode says which Podcasting 2.0 extras it carries in its 'has' attribute, so you can see at a glance which ones have a transcript or chapters worth fetching. Use 'since' rather than a large 'max' when you only want recent episodes.",
  schema: {
    ...showArg,
    ...maxArg(20, "Shows with long back catalogues can return thousands, so keep this tight."),
    ...sinceArg,
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const ref = classifyShow(args.show);
    const max = clamp(args.max, 20);
    const since = normalizeSince(args.since);

    const response =
      ref.kind === "feedId"
        ? await ctx.api.episodesByFeedId({ id: ref.value, max, since })
        : ref.kind === "feedUrl"
          ? await ctx.api.episodesByFeedUrl({ url: ref.value, max, since })
          : ref.kind === "guid"
            ? await ctx.api.episodesByPodcastGuid({ guid: ref.value, max, since })
            : await ctx.api.episodesByItunesId({ id: ref.value, max, since });

    const items = response.items ?? [];
    const live = response.liveItems ?? [];
    const rendered = renderEpisodes(items, { source: "episodes", query: args.show });

    // liveItems are scheduled or in-progress broadcasts and are not part of the
    // back catalogue. Merging them into the list would put an unpublished
    // stream where a model expects the newest episode.
    if (!live.length) return rendered;
    return `${rendered}\n${renderEpisodes(live, {
      source: "episodes/liveItems",
      note: "These are scheduled or currently broadcasting live items, not published episodes.",
    })}`;
  },
});

export const getEpisode = defineTool({
  name: "get_episode",
  title: "Get one episode",
  description:
    "One episode in full: description, credited people, soundbites, value block, and the transcript and chapter pointers. Takes a Podcast Index episode id, which is the fastest path, or an episode GUID. A GUID is only unique within a show, so pass the show as well when using one, or the answer is whichever episode the index finds first.",
  schema: {
    episode_id: z
      .number()
      .int()
      .optional()
      .describe("Podcast Index episode id. The reliable identifier, from any listing."),
    guid: z
      .string()
      .optional()
      .describe("The episode GUID from the RSS feed. Needs 'show' alongside it to be unambiguous."),
    show: z
      .string()
      .optional()
      .describe("The show, when looking up by GUID. Feed id, RSS URL or podcast GUID."),
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    if (!args.episode_id && !args.guid) {
      throw new NotFoundError("Pass either episode_id or guid.", "episodes");
    }

    let response;
    if (args.episode_id) {
      response = await ctx.api.episodeById(args.episode_id);
    } else {
      const scope: { feedid?: number; feedurl?: string; podcastguid?: string } = {};
      if (args.show) {
        const ref = classifyShow(args.show);
        if (ref.kind === "feedId") scope.feedid = ref.value;
        else if (ref.kind === "feedUrl") scope.feedurl = ref.value;
        else if (ref.kind === "guid") scope.podcastguid = ref.value;
      }
      response = await ctx.api.episodeByGuid({ guid: args.guid as string, ...scope });
    }

    const episode = Array.isArray(response.episode) ? response.episode[0] : response.episode;
    if (!episode || !episode.id) {
      throw new NotFoundError(
        `No episode matched. If you used a GUID without a show, try again with 'show' set, since a GUID is only unique inside one feed.`,
        "episodes",
      );
    }
    return renderEpisode(episode, "");
  },
});

export const getLiveEpisodes = defineTool({
  name: "get_live_episodes",
  title: "Podcasts broadcasting live now",
  description:
    "Episodes currently marked live across the whole index, from the Podcasting 2.0 liveItem tag. This is a small and fast-moving list: live podcasting is a niche within the index, so a handful of results is normal and an empty one is possible. Each entry carries a start time, an end time and a status.",
  schema: { ...maxArg(20) },
  risk: "read",
  surface: "index",
  idempotent: false,
  handler: async (args, ctx) => {
    const response = await ctx.api.liveEpisodes(clamp(args.max, 20));
    return renderEpisodes(response.items ?? [], {
      source: "episodes/live",
      note: "Live items change minute to minute. A result here is a snapshot, not a schedule.",
    });
  },
});

export const getRandomEpisodes = defineTool({
  name: "get_random_episodes",
  title: "Random episodes",
  description:
    "Random episodes from across the index, optionally filtered by language and category. Genuinely random rather than ranked, which makes it useful for sampling what a category actually contains rather than what its top shows look like. Never cached, so calling it again gives different episodes.",
  schema: {
    ...maxArg(10),
    lang: z.string().optional().describe("Language code such as en, es, de. Comma-separate several."),
    cat: z.string().optional().describe("Categories to include, by name or id, comma-separated."),
    notcat: z.string().optional().describe("Categories to exclude, by name or id, comma-separated."),
  },
  risk: "read",
  surface: "index",
  idempotent: false,
  handler: async (args, ctx) => {
    const response = await ctx.api.randomEpisodes({
      max: clamp(args.max, 10),
      lang: args.lang,
      cat: args.cat,
      notcat: args.notcat,
    });
    return renderEpisodes(response.items ?? [], { source: "episodes/random" });
  },
});

export const getRecentEpisodes = defineTool({
  name: "get_recent_episodes",
  title: "Newest episodes across the index",
  description:
    "The most recently published episodes across every show in the index, newest first. This is the firehose: it is what podcasting published in the last few minutes, not what is popular. Use get_trending for popularity. The exclude filter is worth using, because a handful of high-frequency automated feeds otherwise dominate every result.",
  schema: {
    ...maxArg(20),
    exclude: z
      .string()
      .optional()
      .describe("Drop episodes whose title contains this string. Useful for filtering out repetitive automated feeds."),
    before: z
      .number()
      .int()
      .optional()
      .describe("Only episodes published before this unix timestamp, for paging backwards through the firehose."),
  },
  risk: "read",
  surface: "index",
  idempotent: false,
  handler: async (args, ctx) => {
    const response = await ctx.api.recentEpisodes({
      max: clamp(args.max, 20),
      excludeString: args.exclude,
      before: args.before,
    });
    return renderEpisodes(response.items ?? [], { source: "recent/episodes" });
  },
});

export const EPISODE_TOOLS = [
  getEpisodes,
  getEpisode,
  getLiveEpisodes,
  getRandomEpisodes,
  getRecentEpisodes,
];
