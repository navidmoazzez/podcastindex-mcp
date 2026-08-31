/**
 * The three tools that change something, and why only two of them ask.
 *
 * `notify_feed_update` tells the index a feed has new content so it recrawls
 * sooner. It is idempotent, it needs no credential, and the worst outcome of a
 * careless call is one unnecessary HTTP request by a crawler that was going to
 * come anyway. Guarding it would teach a model to pass `confirm` reflexively,
 * which would then be passed on the two tools where it matters.
 *
 * `submit_feed` and `submit_feed_by_itunes_id` add a podcast to a public global
 * directory that hundreds of apps read, and **this API has no way to remove
 * one**. Undoing a mistake means asking the people who run Podcast Index. That
 * asymmetry is the entire reason those two require confirmation and the first
 * one does not.
 *
 * Both submits also need a key with write permission, which Podcast Index
 * grants separately. A key without it gets a 403, mapped in `api/errors.ts` to
 * a message saying exactly that, so a permission problem never reads as a bug.
 */

import { z } from "zod";
import { PodcastIndexError } from "../api/errors.js";
import { classifyShow, confirmArg, defineTool, snippet } from "./kit.js";

export const notifyFeedUpdate = defineTool({
  name: "notify_feed_update",
  title: "Tell the index a feed has new content",
  description:
    "Ping Podcast Index to say a feed has changed, so it recrawls sooner than its normal schedule. Use this straight after publishing an episode: the index will find it on its own eventually, and this shortens eventually. Safe to call more than once, and it needs no API key, so it works even on an unconfigured install. It does not add a feed that is not already in the index; use submit_feed for that.",
  schema: {
    show: z
      .string()
      .describe("The show, as a Podcast Index feed id or its RSS feed URL. It must already be in the index."),
  },
  risk: "write",
  surface: "open",
  idempotent: true,
  summary: (args) => `notify index of update to ${snippet(args.show, 80)}`,
  handler: async (args, ctx) => {
    const ref = classifyShow(args.show);
    if (ref.kind !== "feedId" && ref.kind !== "feedUrl") {
      throw new PodcastIndexError(
        `This endpoint only takes a feed id or a feed URL, and "${args.show}" is neither. Call get_podcast first to turn a GUID or an Apple link into a feed id.`,
        0,
        "hub/pubnotify",
      );
    }
    const response = await ctx.api.pubNotify(
      ref.kind === "feedId" ? { id: ref.value } : { url: ref.value },
    );
    return {
      notified: true,
      show: args.show,
      status: response.status,
      detail: response.description,
      note: "The index will recrawl sooner than its normal schedule. This is a hint, not a guarantee of an immediate crawl.",
    };
  },
});

export const submitFeed = defineTool({
  name: "submit_feed",
  title: "Add a podcast to the index",
  description:
    "Add a podcast to Podcast Index by its RSS feed URL. This writes to a public global directory that hundreds of podcast apps read, and there is no way to remove a feed through this API afterwards, so it requires confirm: true. If the feed is already indexed you get its existing id back and nothing changes. Needs an API key with write permission, which Podcast Index grants separately from a normal key; without it the call fails with a message saying so and nothing is submitted.",
  schema: {
    feed_url: z.string().url().describe("The RSS feed URL to add. Must be publicly reachable."),
    itunes_id: z
      .number()
      .int()
      .optional()
      .describe("The show's iTunes id, if known. Helps the index match this feed to the same show elsewhere."),
    ...confirmArg,
  },
  risk: "destructive",
  surface: "index",
  idempotent: true,
  summary: (args) => `add ${snippet(args.feed_url, 80)} to the public Podcast Index`,
  handler: async (args, ctx) => {
    const response = await ctx.api.addByFeedUrl({
      url: args.feed_url,
      ...(args.itunes_id ? { itunesid: args.itunes_id } : {}),
    });
    return {
      submitted: true,
      feed_url: args.feed_url,
      feed_id: response.feedId,
      already_existed: Boolean(response.existed),
      status: response.status,
      detail: response.description,
      note: response.existed
        ? "This feed was already in the index. Nothing was added and the existing id is returned."
        : "The feed was accepted. It will be crawled shortly; episodes do not appear instantly.",
    };
  },
});

export const submitFeedByItunesId = defineTool({
  name: "submit_feed_by_itunes_id",
  title: "Add a podcast by its iTunes id",
  description:
    "Add a podcast to Podcast Index using its iTunes id, for when you have an Apple Podcasts link but not the RSS URL. Same effect and same caveats as submit_feed: it writes to a public directory, it cannot be undone through this API, it requires confirm: true, and it needs a key with write permission.",
  schema: {
    itunes_id: z
      .number()
      .int()
      .describe("The numeric iTunes id. From an Apple Podcasts URL this is the number after /id."),
    ...confirmArg,
  },
  risk: "destructive",
  surface: "index",
  idempotent: true,
  summary: (args) => `add iTunes id ${args.itunes_id} to the public Podcast Index`,
  handler: async (args, ctx) => {
    const response = await ctx.api.addByItunesId(args.itunes_id);
    return {
      submitted: true,
      itunes_id: args.itunes_id,
      feed_id: response.feedId,
      already_existed: Boolean(response.existed),
      status: response.status,
      detail: response.description,
    };
  },
});

export const WRITE_TOOLS = [notifyFeedUpdate, submitFeed, submitFeedByItunesId];
