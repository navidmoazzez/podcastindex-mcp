/**
 * Value for value: who takes listener payments, and how they split them.
 *
 * This is data no other podcast source has. A value block is a Podcasting 2.0
 * tag naming the wallets an episode's payments are split between and in what
 * proportion, and Podcast Index is where it is aggregated.
 *
 * It is worth understanding what it is not. A value block says a show is set up
 * to receive payments. It says nothing about whether anyone has ever sent one,
 * how much, or whether the wallet still works. Reading it as revenue is the
 * mistake to avoid, so the tools say so rather than leaving it implied.
 */

import { z } from "zod";
import { renderFeeds, renderValue } from "../format/render.js";
import { clamp, classifyShow, defineTool, maxArg, resolveFeed, showArg, sinceArg, normalizeSince } from "./kit.js";

export const getValueBlock = defineTool({
  name: "get_value_block",
  title: "Get a show's payment split",
  description:
    "The value-for-value block for a show: the wallets that receive listener payments and the weight each one takes. Splits are relative weights rather than percentages, so a computed share is shown alongside the raw number. Most podcasts publish no value block at all, and an absent one is reported plainly rather than as an error. A value block means a show can receive payments; it is not evidence that it has received any.",
  schema: { ...showArg },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const ref = classifyShow(args.show);
    const response =
      ref.kind === "feedId"
        ? await ctx.api.valueByFeedId(ref.value)
        : ref.kind === "feedUrl"
          ? await ctx.api.valueByFeedUrl(ref.value)
          : ref.kind === "guid"
            ? await ctx.api.valueByPodcastGuid(ref.value)
            // The value endpoints do not take an iTunes id, so a show named that
            // way is resolved to a feed id first rather than being refused.
            : await ctx.api.valueByFeedId((await resolveFeed(ctx.api, args.show)).id);
    return renderValue(response.value, args.show);
  },
});

export const getEpisodeValue = defineTool({
  name: "get_episode_value",
  title: "Get one episode's payment split",
  description:
    "The value block for a single episode, which can differ from the show's. Publishers override the split per episode to pay a guest a share, so this is how you see who was cut in on a particular conversation. Needs both the podcast GUID and the episode GUID, because that is the only pair this endpoint accepts.",
  schema: {
    podcast_guid: z.string().describe("The show's podcast GUID, from get_podcast."),
    episode_guid: z.string().describe("The episode's GUID from the RSS feed, from get_episodes."),
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const response = await ctx.api.valueByEpisodeGuid({
      podcastguid: args.podcast_guid,
      episodeguid: args.episode_guid,
    });
    return renderValue(response.value, args.episode_guid);
  },
});

export const listValuePodcasts = defineTool({
  name: "list_value_podcasts",
  title: "List shows that take listener payments",
  description:
    "Every feed in the index carrying a value block, paged. This is the whole value-for-value corner of podcasting as a list, which is useful for sizing it or for finding shows that have opted into direct listener payment. Use start_at to page: the list is large.",
  schema: {
    ...maxArg(100),
    start_at: z.number().int().optional().describe("Feed id to resume from, for paging through the list."),
    time_splits_only: z
      .boolean()
      .optional()
      .describe("Only feeds using value time splits, which pay different recipients during different parts of an episode."),
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const response = await ctx.api.podcastsByTag({
      ...(args.time_splits_only ? { valueTimeSplit: true } : { value: true }),
      max: clamp(args.max, 100),
      start_at: args.start_at,
    });
    return renderFeeds(response.feeds ?? [], { source: "podcasts/bytag" });
  },
});

export const getNewValueFeeds = defineTool({
  name: "get_new_value_feeds",
  title: "Feeds that just added a payment split",
  description:
    "Feeds that added a value block recently. This is the growth edge of value-for-value podcasting: shows adopting listener payments for the first time, newest first.",
  schema: { ...maxArg(20), ...sinceArg },
  risk: "read",
  surface: "index",
  idempotent: false,
  handler: async (args, ctx) => {
    const response = await ctx.api.recentNewValueFeeds({
      max: clamp(args.max, 20),
      since: normalizeSince(args.since),
    });
    return renderFeeds(response.feeds ?? [], { source: "recent/newvaluefeeds" });
  },
});

export const VALUE_TOOLS = [
  getValueBlock,
  getEpisodeValue,
  listValuePodcasts,
  getNewValueFeeds,
];
