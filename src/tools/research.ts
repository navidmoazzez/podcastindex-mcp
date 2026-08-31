/**
 * Tools shaped like the question rather than like the API.
 *
 * Everything else in this server maps roughly one tool to one endpoint. These
 * three do not, and they exist because the questions people actually bring are
 * not endpoint-shaped.
 *
 * "Tell me about this show" is five calls: the feed, its episodes, its value
 * block, its crawl health, its people. A model asked to do that either makes
 * five round trips or, more often, makes one and answers from a third of the
 * picture. Fanning out once and returning a brief is both faster and more
 * accurate.
 *
 * "Where has this guest been" is worse. The person endpoint returns episodes in
 * no useful order, repeats shows, and mixes a host's own show in with guest
 * appearances, which is the opposite of what somebody researching a guest
 * wants. Grouping and sorting that is real work and it should not be the
 * caller's.
 */

import { z } from "zod";
import { renderFeed, renderValue, isoFrom } from "../format/render.js";
import type { Episode } from "../api/types.js";
import { clamp, defineTool, maxArg, resolveFeed, showArg } from "./kit.js";

const DAY = 86_400;

export const getShowProfile = defineTool({
  name: "get_show_profile",
  title: "Full profile of one show",
  description:
    "Everything about one show in a single call: metadata, publishing cadence measured from real episode dates, recent episodes, who is credited on them, whether it publishes transcripts or chapters, its payment split, and whether the index is crawling it successfully. Use this instead of calling get_podcast, get_episodes, get_value_block and check_feed_health separately, which is four round trips for the same answer. This is the right first call when the question is about one show.",
  schema: {
    ...showArg,
    episodes: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("How many recent episodes to read for the cadence and people analysis. Defaults to 20."),
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const feed = await resolveFeed(ctx.api, args.show);
    const want = clamp(args.episodes, 20, 100);

    // Both are independent of each other, so they go out together. Serialising
    // them would double the latency of the tool whose whole point is being one
    // call instead of four.
    const [episodesResponse, valueResponse] = await Promise.all([
      ctx.api.episodesByFeedId({ id: feed.id, max: want }),
      ctx.api.valueByFeedId(feed.id).catch(() => null),
    ]);

    const items = episodesResponse.items ?? [];
    const now = Math.floor(Date.now() / 1000);

    // Cadence from the real gaps between publish dates. A show's stated
    // schedule and its actual one routinely disagree, and the actual one is
    // the answer to "how often do they publish".
    const dates = items
      .map((e) => e.datePublished ?? 0)
      .filter(Boolean)
      .sort((a, b) => b - a);
    let cadence = "unknown";
    if (dates.length >= 3) {
      const gaps: number[] = [];
      for (let i = 0; i < dates.length - 1; i++) {
        gaps.push((dates[i] as number) - (dates[i + 1] as number));
      }
      gaps.sort((a, b) => a - b);
      // Median rather than mean: one six month hiatus in an otherwise weekly
      // show would drag a mean into nonsense.
      const median = gaps[Math.floor(gaps.length / 2)] as number;
      const days = median / DAY;
      cadence =
        days <= 1.5 ? "daily" :
        days <= 4 ? "a few times a week" :
        days <= 9 ? "weekly" :
        days <= 18 ? "fortnightly" :
        days <= 40 ? "monthly" :
        `roughly every ${Math.round(days)} days`;
    }

    const newest = dates[0] ?? feed.newestItemPubdate ?? 0;
    const silentDays = newest ? Math.floor((now - newest) / DAY) : undefined;

    const withTranscript = items.filter((e) => e.transcripts?.length || e.transcriptUrl).length;
    const withChapters = items.filter((e) => e.chaptersUrl).length;

    // Who recurs across episodes. A name on most episodes is the host; a name
    // on one is a guest, and the distinction is what makes this list useful.
    const people = new Map<string, { count: number; roles: Set<string> }>();
    for (const episode of items) {
      for (const person of episode.persons ?? []) {
        if (!person.name) continue;
        const entry = people.get(person.name) ?? { count: 0, roles: new Set<string>() };
        entry.count++;
        if (person.role) entry.roles.add(person.role);
        people.set(person.name, entry);
      }
    }
    const recurring = [...people.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 12)
      .map(
        ([name, info]) =>
          `  <person name="${name.replace(/"/g, "'")}" episodes="${info.count}"${
            info.roles.size ? ` roles="${[...info.roles].join(", ")}"` : ""
          } />`,
      );

    const health =
      feed.dead
        ? "dead: the index has stopped crawling this feed"
        : feed.lastHttpStatus && feed.lastHttpStatus >= 400
          ? `last fetch returned HTTP ${feed.lastHttpStatus}`
          : "crawling normally";

    const recent = items
      .slice(0, 10)
      .map(
        (e: Episode) =>
          `  <episode episode_id="${e.id}" published="${isoFrom(e.datePublished) ?? "unknown"}" duration_seconds="${
            e.duration ?? 0
          }" has="${[
            e.transcripts?.length || e.transcriptUrl ? "transcript" : "",
            e.chaptersUrl ? "chapters" : "",
            e.soundbites?.length ? "soundbites" : "",
          ]
            .filter(Boolean)
            .join(" ")}" title="${(e.title ?? "").replace(/"/g, "'")}" />`,
      )
      .join("\n");

    return [
      `<show_profile feed_id="${feed.id}">`,
      renderFeed(feed, "  "),
      `  <publishing cadence="${cadence}" episodes_total="${feed.episodeCount ?? 0}" episodes_analysed="${
        items.length
      }" newest="${isoFrom(newest) ?? "unknown"}"${
        silentDays !== undefined ? ` days_since_last="${silentDays}"` : ""
      } />`,
      `  <podcasting_2_0 transcripts="${withTranscript}/${items.length}" chapters="${withChapters}/${items.length}" value="${
        valueResponse?.value ? "yes" : "no"
      }" />`,
      `  <feed_health status="${health}" crawl_errors="${feed.crawlErrors ?? 0}" parse_errors="${
        feed.parseErrors ?? 0
      }" last_success="${isoFrom(feed.lastGoodHttpStatusTime) ?? "never"}" />`,
      recurring.length ? `  <credited_people>\n${recurring.join("\n")}\n  </credited_people>` : "",
      recent ? `  <recent_episodes>\n${recent}\n  </recent_episodes>` : "",
      valueResponse?.value ? renderValue(valueResponse.value, feed.title ?? String(feed.id)) : "",
      `</show_profile>`,
    ]
      .filter(Boolean)
      .join("\n");
  },
});

export const findGuestAppearances = defineTool({
  name: "find_guest_appearances",
  title: "Trace where a person has appeared",
  description:
    "Every episode a named person is credited on, grouped by show and ordered newest first, with their role on each. This is guest research: it answers 'who has had this person on', 'what do they usually talk about' and 'which shows book people like this'. Shows where the person appears on many episodes are flagged as likely their own, so a host's back catalogue does not drown out the guest spots you were looking for. Only finds shows that publish Podcasting 2.0 person tags, which is a minority of the index, so an empty result is not evidence the person has never been on a podcast.",
  schema: {
    name: z.string().min(2).describe("The person's name, as it would be credited in a feed."),
    ...maxArg(50, "Episodes to consider before grouping."),
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const response = await ctx.api.searchByPerson({ q: args.name, max: clamp(args.max, 50) });
    const items = response.items ?? [];

    if (!items.length) {
      return `<appearances person="${args.name.replace(/"/g, "'")}" count="0">\n  <note>No credited appearances found. Podcast Index only indexes people through the optional <podcast:person> tag, and most shows publish none, so this is weak evidence at best. Try search_podcasts on the person's name in case they host a show, or search_episodes_by_person with a different spelling.</note>\n</appearances>`;
    }

    const byShow = new Map<number, { title: string; episodes: Episode[] }>();
    for (const episode of items) {
      const feedId = episode.feedId ?? 0;
      const entry = byShow.get(feedId) ?? { title: episode.feedTitle ?? "unknown", episodes: [] };
      entry.episodes.push(episode);
      byShow.set(feedId, entry);
    }

    const needle = args.name.trim().toLowerCase();
    const groups = [...byShow.entries()]
      .sort((a, b) => b[1].episodes.length - a[1].episodes.length)
      .map(([feedId, group]) => {
        const episodes = group.episodes.sort(
          (a, b) => (b.datePublished ?? 0) - (a.datePublished ?? 0),
        );
        // Four or more appearances on one show is a host, a co-host or a
        // regular, not a guest spot. Saying so is the difference between a
        // useful list and one dominated by somebody's own back catalogue.
        const likelyTheirOwn = episodes.length >= 4;

        const rows = episodes
          .slice(0, 10)
          .map((e) => {
            const role =
              e.persons?.find((p) => p.name?.toLowerCase() === needle)?.role ?? "credited";
            return `    <episode episode_id="${e.id}" published="${
              isoFrom(e.datePublished) ?? "unknown"
            }" role="${role.replace(/"/g, "'")}" title="${(e.title ?? "").replace(/"/g, "'")}" />`;
          })
          .join("\n");

        return `  <show feed_id="${feedId}" title="${group.title.replace(/"/g, "'")}" appearances="${
          episodes.length
        }"${likelyTheirOwn ? ` likely_own_show="true"` : ""}>\n${rows}\n  </show>`;
      })
      .join("\n");

    return `<appearances person="${args.name.replace(/"/g, "'")}" shows="${byShow.size}" episodes="${
      items.length
    }">\n  <note>Grouped by show, most appearances first. A show marked likely_own_show has four or more appearances by this person, which usually means they host or co-host it rather than guested on it.</note>\n${groups}\n</appearances>`;
  },
});

export const findShowsToPitch = defineTool({
  name: "find_shows_to_pitch",
  title: "Find bookable shows on a topic",
  description:
    "Search for shows on a topic and keep only the ones worth approaching: alive, publishing recently, with a real episode count and a way to contact them. A plain search returns the whole index including feeds that died in 2019, and sorting that by hand is the tedious part of guest outreach. Each result says when it last published, how often, and what contact route exists. Ranked by recent activity rather than by search relevance, because a perfectly matching show that stopped publishing two years ago is not a lead.",
  schema: {
    topic: z.string().min(2).describe("The subject the show should be about."),
    ...maxArg(15, "Shows to return after filtering."),
    active_within_days: z
      .number()
      .int()
      .optional()
      .describe("Require an episode within this many days. Defaults to 90, which filters out dormant shows."),
    min_episodes: z
      .number()
      .int()
      .optional()
      .describe("Require at least this many episodes. Defaults to 10, which filters out feeds that never got started."),
  },
  risk: "read",
  surface: "index",
  handler: async (args, ctx) => {
    const wanted = clamp(args.max, 15, 50);
    const activeWithin = args.active_within_days ?? 90;
    const minEpisodes = args.min_episodes ?? 10;

    // Over-fetch, because the filtering below removes a large share of any
    // search result and asking for exactly `wanted` would reliably return
    // fewer than that after the dead feeds are dropped.
    const response = await ctx.api.searchByTerm({ q: args.topic, max: Math.min(wanted * 6, 200) });
    const now = Math.floor(Date.now() / 1000);

    const candidates = (response.feeds ?? [])
      .filter((feed) => !feed.dead)
      .filter((feed) => (feed.episodeCount ?? 0) >= minEpisodes)
      .filter((feed) => {
        const newest = feed.newestItemPubdate ?? 0;
        return newest > 0 && (now - newest) / DAY <= activeWithin;
      })
      .sort((a, b) => (b.newestItemPubdate ?? 0) - (a.newestItemPubdate ?? 0))
      .slice(0, wanted);

    if (!candidates.length) {
      return `<pitch_list topic="${args.topic.replace(/"/g, "'")}" count="0">\n  <note>No shows matched that are still active. Either the topic is niche, or the filters are tight: try a wider active_within_days, a lower min_episodes, or a broader topic.</note>\n</pitch_list>`;
    }

    const rows = candidates
      .map((feed) => {
        const daysSince = Math.floor((now - (feed.newestItemPubdate ?? now)) / DAY);
        const contact = feed.link
          ? feed.link
          : feed.funding?.url
            ? feed.funding.url
            : undefined;
        return [
          `  <show feed_id="${feed.id}" title="${(feed.title ?? "").replace(/"/g, "'")}"`,
          ` host="${(feed.author || feed.ownerName || "").replace(/"/g, "'")}"`,
          ` episodes="${feed.episodeCount ?? 0}"`,
          ` last_published="${isoFrom(feed.newestItemPubdate) ?? "unknown"}"`,
          ` days_since="${daysSince}"`,
          ` language="${feed.language ?? "unknown"}"`,
          contact ? ` contact="${contact.replace(/"/g, "&quot;")}"` : ` contact="none published"`,
          ` />`,
        ].join("");
      })
      .join("\n");

    return `<pitch_list topic="${args.topic.replace(/"/g, "'")}" count="${
      candidates.length
    }" filters="active within ${activeWithin} days, at least ${minEpisodes} episodes, not marked dead">\n  <note>Ordered by most recently published. The contact value is the show's own website or funding page from its feed, which is the closest thing to a contact route the RSS carries; Podcast Index does not publish email addresses.</note>\n${rows}\n</pitch_list>`;
  },
});

export const RESEARCH_TOOLS = [getShowProfile, findGuestAppearances, findShowsToPitch];
