/**
 * Is this feed actually working.
 *
 * Podcast Index crawls every feed it knows continuously and records what
 * happened: how many times the fetch failed, how many times the XML would not
 * parse, what HTTP status came back last, and when it last succeeded. That is a
 * free, continuously updated health check on any podcast in the world, and
 * almost nothing surfaces it.
 *
 * It matters because feed problems are silent. A publisher whose feed has been
 * 404ing for three weeks finds out when downloads collapse, and the numbers
 * that would have told them sat in a public API the whole time.
 *
 * `check_feed_health` turns those raw counters into a verdict, because the raw
 * numbers do not interpret themselves: `crawlErrors: 3` is meaningless without
 * knowing that the last crawl still succeeded.
 */

import { renderFeeds, renderStats, isoFrom } from "../format/render.js";
import { clamp, defineTool, maxArg, resolveFeed, showArg } from "./kit.js";

const DAY = 86_400;

export const checkFeedHealth = defineTool({
  name: "check_feed_health",
  title: "Check whether a feed is healthy",
  description:
    "Diagnose a podcast feed using the crawl history Podcast Index keeps on it: failed fetches, parse errors, the last HTTP status, when it was last successfully read, and whether the index has marked it dead or as a duplicate of another feed. This answers 'is my feed broken' with evidence rather than a guess, and it works on any feed in the index, not only your own. Worth running before blaming a host for a drop in downloads.",
  schema: { ...showArg },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const feed = await resolveFeed(ctx.api, args.show);
    const now = Math.floor(Date.now() / 1000);

    const problems: string[] = [];
    const notes: string[] = [];

    if (feed.dead) {
      problems.push(
        "The index has marked this feed dead, which means it stopped responding for long enough that crawling was abandoned. New episodes will not appear anywhere that reads Podcast Index until it starts responding again.",
      );
    }
    if (feed.duplicateOf) {
      problems.push(
        `The index treats this as a duplicate of feed ${feed.duplicateOf}. Two feeds serving the same show split its presence, and apps may follow the other one.`,
      );
    }
    if (feed.lastHttpStatus && feed.lastHttpStatus >= 400) {
      problems.push(
        `The last fetch returned HTTP ${feed.lastHttpStatus}. Anything from 400 up means the crawler could not read the feed at that moment.`,
      );
    }
    if ((feed.parseErrors ?? 0) > 0) {
      problems.push(
        `${feed.parseErrors} parse errors recorded. The feed was reachable but its XML was malformed, which usually means an unescaped character or a truncated response rather than a host problem.`,
      );
    }
    if ((feed.crawlErrors ?? 0) > 0) {
      notes.push(
        `${feed.crawlErrors} crawl errors recorded over the life of this feed. A handful is normal for any feed that has existed for years; a rising count alongside an old last-good time is not.`,
      );
    }

    const lastGood = feed.lastGoodHttpStatusTime ?? 0;
    if (lastGood && now - lastGood > 7 * DAY) {
      problems.push(
        `The last successful fetch was ${Math.floor((now - lastGood) / DAY)} days ago. The feed is not being read, whatever it looks like in a browser.`,
      );
    }

    const newest = feed.newestItemPubdate ?? 0;
    if (newest && now - newest > 90 * DAY) {
      notes.push(
        `The newest episode is ${Math.floor(
          (now - newest) / DAY,
        )} days old. That is a publishing gap rather than a technical fault, and the feed itself may be perfectly healthy.`,
      );
    }
    if (feed.locked) {
      notes.push(
        "This feed is locked, meaning the owner has signalled it should not be imported to another host without permission. That is intentional, not a fault.",
      );
    }

    const verdict = problems.length
      ? "problems found"
      : notes.length
        ? "healthy, with notes"
        : "healthy";

    const lines = [
      `<feed_health feed_id="${feed.id}" title="${(feed.title ?? "").replace(/"/g, "'")}" verdict="${verdict}">`,
      `  <crawl last_crawl="${isoFrom(feed.lastCrawlTime) ?? "never"}" last_parse="${
        isoFrom(feed.lastParseTime) ?? "never"
      }" last_success="${isoFrom(feed.lastGoodHttpStatusTime) ?? "never"}" last_status="${
        feed.lastHttpStatus ?? "unknown"
      }" crawl_errors="${feed.crawlErrors ?? 0}" parse_errors="${feed.parseErrors ?? 0}" />`,
      `  <publishing episodes="${feed.episodeCount ?? 0}" newest_episode="${
        isoFrom(feed.newestItemPubdate) ?? "unknown"
      }" />`,
      ...problems.map((p) => `  <problem>${p.replace(/</g, "&lt;")}</problem>`),
      ...notes.map((n) => `  <note>${n.replace(/</g, "&lt;")}</note>`),
      problems.length === 0 && notes.length === 0
        ? `  <note>Nothing wrong. The index is reading this feed successfully.</note>`
        : "",
      `</feed_health>`,
    ].filter(Boolean);

    return lines.join("\n");
  },
});

export const listDeadFeeds = defineTool({
  name: "list_dead_feeds",
  title: "List feeds the index has given up on",
  description:
    "Feeds Podcast Index has marked dead, meaning they stopped responding long enough that crawling was abandoned. Each entry can name the feed it duplicates, where the index concluded one feed superseded another. Useful for auditing a list of shows for ones that have quietly stopped, and for understanding churn in the directory. This is a large list.",
  schema: { ...maxArg(50, "The full list is long; this trims it locally after fetching.") },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const response = await ctx.api.deadPodcasts();
    const all = response.feeds ?? [];
    const max = clamp(args.max, 50);
    return renderFeeds(all.slice(0, max), {
      source: "podcasts/dead",
      note: `The index lists ${all.length} dead feeds in total; ${Math.min(
        max,
        all.length,
      )} are shown. This endpoint returns the whole list at once and has no server-side paging, so narrowing happens here.`,
    });
  },
});

export const getIndexStats = defineTool({
  name: "get_index_stats",
  title: "Podcast Index size and activity",
  description:
    "How big the index is and how much of it is alive: total feeds, total episodes, how many feeds published in the last 3, 10, 30 and 90 days, and how many carry a value block. The activity numbers are the interesting part, because the gap between total feeds and feeds active in 30 days is the honest measure of how much of podcasting is still running.",
  schema: {},
  risk: "read",
  surface: "index",
  handler: async (_args, ctx) => {
    const response = await ctx.api.stats();
    const stats = response.stats ?? {};
    const total = stats.feedCountTotal ?? 0;
    const active30 = stats.feedsWithNewEpisodes30days ?? 0;
    const share = total > 0 ? ((active30 / total) * 100).toFixed(1) : undefined;
    const note = share
      ? `\n  <note>${share}% of feeds in the index published something in the last 30 days.</note>`
      : "";
    return renderStats(stats).replace("</index_stats>", `${note}\n</index_stats>`);
  },
});

export const HEALTH_TOOLS = [checkFeedHealth, listDeadFeeds, getIndexStats];
