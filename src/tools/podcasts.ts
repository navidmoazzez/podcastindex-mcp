/**
 * Looking up a show you have already identified.
 *
 * `get_podcast` is one tool over four endpoints on purpose. See the note on
 * `resolveFeed` in kit.ts: the caller has whichever identifier they happened to
 * find, and making them route it to the right endpoint is bookkeeping that
 * belongs in code rather than in a model's head.
 */

import { z } from "zod";
import { renderCategories, renderFeed, renderFeeds } from "../format/render.js";
import { clamp, defineTool, maxArg, resolveFeed, showArg } from "./kit.js";

export const getPodcast = defineTool({
  name: "get_podcast",
  title: "Get one podcast",
  description:
    "Everything Podcast Index knows about one show: metadata, category, episode count, when it last published, and which Podcasting 2.0 features it carries. Takes any identifier you have, a feed id, an RSS URL, a podcast GUID, an Apple Podcasts link or an iTunes id, and works out which it is. Start here when you already know the show; use search_podcasts when you are still looking for it.",
  schema: { ...showArg },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => renderFeed(await resolveFeed(ctx.api, args.show), ""),
});

export const getPodcastsBatch = defineTool({
  name: "get_podcasts_batch",
  title: "Get many podcasts at once",
  description:
    "Look up many shows in one request, by podcast GUID. Use this instead of calling get_podcast in a loop whenever you have more than three or four: it is one request rather than one each, which matters against a rate limit and is far faster. Only accepts podcast GUIDs, not feed ids, because that is the only identifier this endpoint takes.",
  schema: {
    guids: z
      .array(z.string())
      .min(1)
      .max(500)
      .describe("Podcast GUIDs. Up to 500 per call, which is the API's own ceiling."),
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const response = await ctx.api.podcastsBatchByGuid(args.guids);
    const found = response.feeds ?? [];
    const missing = args.guids.length - found.length;
    return renderFeeds(found, {
      source: "podcasts/batch/byguid",
      note:
        missing > 0
          ? `${missing} of the ${args.guids.length} GUIDs matched nothing in the index.`
          : undefined,
    });
  },
});

export const getPodcastsByMedium = defineTool({
  name: "get_podcasts_by_medium",
  title: "Browse feeds by medium",
  description:
    "List feeds of one Podcasting 2.0 medium. The medium says what a feed actually contains, and the index carries far more than talk shows: music, video, film, audiobook, newsletter, blog, course and publisher feeds all live here. Use this to find content types that a normal podcast search buries, such as audiobooks or serialised film.",
  schema: {
    medium: z
      .enum([
        "podcast",
        "music",
        "video",
        "film",
        "audiobook",
        "newsletter",
        "blog",
        "publisher",
        "course",
        "mixed",
      ])
      .describe("The medium to list. 'podcast' is the ordinary talk-show default."),
    ...maxArg(30),
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const response = await ctx.api.podcastsByMedium({
      medium: args.medium,
      max: clamp(args.max, 30),
    });
    return renderFeeds(response.feeds ?? [], {
      source: "podcasts/bymedium",
      query: args.medium,
    });
  },
});

export const listCategories = defineTool({
  name: "list_categories",
  title: "List every category",
  description:
    "Every category Podcast Index uses, with its numeric id. Worth calling once before filtering anything by category, because several tools accept either the name or the id and the names are not the same as Apple's genre list.",
  schema: {},
  risk: "read",
  surface: "index",
  handler: async (_args, ctx) => renderCategories((await ctx.api.categories()).feeds ?? []),
});

export const PODCAST_TOOLS = [getPodcast, getPodcastsBatch, getPodcastsByMedium, listCategories];
