/**
 * Finding a show or an episode when all you have is words.
 *
 * Four tools rather than one, because Podcast Index searches four different
 * indexes and they answer genuinely different questions. Collapsing them into a
 * single `search` with a mode argument would hide that a person search returns
 * episodes while a term search returns feeds, which is the thing a caller most
 * needs to know before it reads the result.
 *
 * The person search is the one worth understanding. It reads the Podcasting 2.0
 * <podcast:person> tag, so it finds episodes where somebody was credited rather
 * than merely mentioned. That makes it the only reliable way to ask "where has
 * this guest been", and it is also why it misses shows that publish no person
 * tags, which is most of them.
 */

import { z } from "zod";
import { renderEpisodes, renderFeeds } from "../format/render.js";
import { clamp, defineTool, maxArg } from "./kit.js";

const cleanArg = {
  clean: z
    .boolean()
    .optional()
    .describe("Exclude anything the publisher marked explicit."),
};

export const searchPodcasts = defineTool({
  name: "search_podcasts",
  title: "Search podcasts",
  description:
    "Search the Podcast Index for shows by keyword, across title, author and owner. This is the general starting point when you have a topic or a name and need to find the show. Returns feeds with their Podcast Index feed id, which every other tool accepts. Matching is keyword-based rather than semantic, so two or three plain words work better than a sentence.",
  schema: {
    q: z.string().min(1).describe("Words to search for. Title, author and owner are all matched."),
    ...maxArg(20),
    ...cleanArg,
    similar: z
      .boolean()
      .optional()
      .describe("Also return near matches. Widens a search that came back thin, at the cost of precision."),
    only_with_value: z
      .boolean()
      .optional()
      .describe("Keep only shows that publish a value-for-value block, meaning they accept listener payments."),
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const response = await ctx.api.searchByTerm({
      q: args.q,
      max: clamp(args.max, 20),
      ...(args.only_with_value ? { val: "any" } : {}),
      ...(args.clean ? { clean: true } : {}),
      ...(args.similar ? { similar: true } : {}),
    });
    return renderFeeds(response.feeds ?? [], { source: "search/byterm", query: args.q });
  },
});

export const searchPodcastsByTitle = defineTool({
  name: "search_podcasts_by_title",
  title: "Search podcasts by title only",
  description:
    "Search shows by title alone, ignoring author and owner. Use this when you know roughly what a show is called and a general search returned a wall of shows that merely mention the words. Much more precise than search_podcasts for a known name, and much worse for a topic.",
  schema: {
    q: z.string().min(1).describe("The show title, or part of it."),
    ...maxArg(20),
    ...cleanArg,
    similar: z.boolean().optional().describe("Also return near matches on the title."),
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const response = await ctx.api.searchByTitle({
      q: args.q,
      max: clamp(args.max, 20),
      ...(args.clean ? { clean: true } : {}),
      ...(args.similar ? { similar: true } : {}),
    });
    return renderFeeds(response.feeds ?? [], { source: "search/bytitle", query: args.q });
  },
});

export const searchEpisodesByPerson = defineTool({
  name: "search_episodes_by_person",
  title: "Find episodes crediting a person",
  description:
    "Find episodes where a named person is credited as host, guest, producer or any other role. This reads the Podcasting 2.0 person tag, so it finds real credits rather than passing mentions, which makes it the tool for guest research and for tracing where somebody has appeared. Two honest limits: it only finds shows that publish person tags, which is a minority of the index, and it matches the name as written, so a person credited inconsistently appears under more than one spelling. Returns episodes, not shows.",
  schema: {
    q: z.string().min(1).describe("The person's name, as it would be credited."),
    ...maxArg(30),
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const response = await ctx.api.searchByPerson({ q: args.q, max: clamp(args.max, 30) });
    return renderEpisodes(response.items ?? [], {
      source: "search/byperson",
      query: args.q,
      note: "Only shows that publish <podcast:person> tags appear here, which is a minority of the index. An empty result is not evidence the person has never been on a podcast.",
    });
  },
});

export const searchMusic = defineTool({
  name: "search_music",
  title: "Search music feeds",
  description:
    "Search feeds whose medium is music rather than talk. Podcast Index carries music as a separate medium under the Podcasting 2.0 spec, and those feeds are albums and tracks rather than episodes. Use this for music discovery; a normal podcast search will not surface them well.",
  schema: {
    q: z.string().min(1).describe("Artist, album or track words."),
    ...maxArg(20),
    ...cleanArg,
    only_with_value: z
      .boolean()
      .optional()
      .describe("Keep only feeds that publish a value block, which for music means the artist takes listener payments directly."),
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const response = await ctx.api.searchMusic({
      q: args.q,
      max: clamp(args.max, 20),
      ...(args.only_with_value ? { val: "any" } : {}),
      ...(args.clean ? { clean: true } : {}),
    });
    return renderFeeds(response.feeds ?? [], { source: "search/music/byterm", query: args.q });
  },
});

export const SEARCH_TOOLS = [
  searchPodcasts,
  searchPodcastsByTitle,
  searchEpisodesByPerson,
  searchMusic,
];
