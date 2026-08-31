/**
 * What is new and what is moving.
 *
 * Worth separating trending from recent, because they answer opposite
 * questions and the names are close enough to confuse. Trending is Podcast
 * Index's own popularity signal over a window. Recent is chronological and
 * unfiltered, which is the firehose: everything published, in order, mostly
 * from shows nobody has heard of.
 *
 * A caller asking "what is happening in true crime" wants trending. A caller
 * building a monitor wants recent. Answering the first with the second returns
 * a list of automated feeds and looks like the index is broken.
 */

import { z } from "zod";
import { renderEpisodes, renderFeeds, isoFrom } from "../format/render.js";
import { clamp, defineTool, maxArg, normalizeSince, sinceArg } from "./kit.js";

const categoryFilters = {
  lang: z.string().optional().describe("Language code such as en, es, de. Comma-separate several."),
  cat: z.string().optional().describe("Categories to include, by name or id, comma-separated. Call list_categories for the names."),
  notcat: z.string().optional().describe("Categories to exclude, by name or id, comma-separated."),
};

export const getTrending = defineTool({
  name: "get_trending",
  title: "Trending podcasts",
  description:
    "Shows trending in the index right now, which is Podcast Index's own popularity signal rather than a chronological list. This is the tool for 'what is hot in this category'. Filter by category and language to make it useful: unfiltered, it returns whatever is big across all of podcasting, which is rarely the question. The window defaults to the last few days; widen it with 'since' for a slower, more stable read.",
  schema: {
    ...maxArg(20),
    ...sinceArg,
    ...categoryFilters,
  },
  risk: "read",
  surface: "index",
  idempotent: false,
  handler: async (args, ctx) => {
    const response = await ctx.api.trending({
      max: clamp(args.max, 20),
      since: normalizeSince(args.since),
      lang: args.lang,
      cat: args.cat,
      notcat: args.notcat,
    });
    return renderFeeds(response.feeds ?? [], {
      source: "podcasts/trending",
      query: args.cat,
      note: response.since ? `Trending measured since ${isoFrom(response.since)}.` : undefined,
    });
  },
});

export const getRecentFeeds = defineTool({
  name: "get_recent_feeds",
  title: "Recently updated feeds",
  description:
    "Feeds that published something recently, newest activity first. This tracks updates rather than new shows, so an established podcast releasing an episode appears here. Use get_new_feeds for shows that are new to the index.",
  schema: { ...maxArg(20), ...sinceArg, ...categoryFilters },
  risk: "read",
  surface: "index",
  idempotent: false,
  handler: async (args, ctx) => {
    const response = await ctx.api.recentFeeds({
      max: clamp(args.max, 20),
      since: normalizeSince(args.since),
      lang: args.lang,
      cat: args.cat,
      notcat: args.notcat,
    });
    return renderFeeds(response.feeds ?? [], { source: "recent/feeds" });
  },
});

export const getNewFeeds = defineTool({
  name: "get_new_feeds",
  title: "Feeds new to the index",
  description:
    "Shows added to Podcast Index for the first time, newest first. This is genuinely new podcasts rather than new episodes, which makes it the tool for spotting a launch. Expect a lot of noise: anyone can submit a feed, so a large share of these are empty, abandoned or automated.",
  schema: {
    ...maxArg(20),
    ...sinceArg,
    oldest_first: z.boolean().optional().describe("Return oldest first instead of newest first."),
  },
  risk: "read",
  surface: "index",
  idempotent: false,
  handler: async (args, ctx) => {
    const response = await ctx.api.recentNewFeeds({
      max: clamp(args.max, 20),
      since: normalizeSince(args.since),
      ...(args.oldest_first ? {} : { desc: true }),
    });
    return renderFeeds(response.feeds ?? [], { source: "recent/newfeeds" });
  },
});

export const getRecentSoundbites = defineTool({
  name: "get_recent_soundbites",
  title: "Recently published soundbites",
  description:
    "The newest soundbites across the whole index: clips publishers themselves marked as the best moment of an episode. A ready-made feed of what podcasters think is worth quoting this week, and a fast way to find shows that use Podcasting 2.0 tags properly.",
  schema: { ...maxArg(20) },
  risk: "read",
  surface: "index",
  idempotent: false,
  handler: async (args, ctx) => {
    const response = await ctx.api.recentSoundbites(clamp(args.max, 20));
    return renderEpisodes(response.items ?? [], { source: "recent/soundbites" });
  },
});

export const DISCOVERY_TOOLS = [getTrending, getRecentFeeds, getNewFeeds, getRecentSoundbites];
