/**
 * Shaping results for a model rather than forwarding the API's JSON.
 *
 * A Podcast Index feed object has around thirty-five fields and an episode
 * around thirty. Most of them are crawler bookkeeping: hash values, image url
 * hashes, parse timestamps, http status codes from the last fetch. Passing all
 * of it through costs roughly ten times the tokens of the part anybody wanted,
 * and it buries the identifiers a follow-up call actually needs.
 *
 * So results come back as tagged text: compact, scannable, and carrying the
 * ids. The rules that make it work:
 *
 *   - every listing says where it came from and how many there are
 *   - unix timestamps become ISO-8601, because Podcast Index returns seconds
 *     since the epoch everywhere and two of those cannot be compared by eye
 *   - a feed's Podcasting 2.0 tags are summarised as flags, since "this show
 *     publishes transcripts" is the useful fact and the URLs are per episode
 *   - text other people wrote is fenced
 */

import { fence } from "../safety.js";
import type { Category, Episode, Feed, IndexStats, ValueBlock } from "../api/types.js";

/** Podcast Index returns seconds since the epoch. Zero means "never". */
export function isoFrom(seconds: number | undefined | null): string | undefined {
  if (!seconds || !Number.isFinite(seconds)) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function attr(name: string, value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "";
  return ` ${name}="${escapeAttr(String(value))}"`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function categoryNames(feed: Feed): string | undefined {
  if (!feed.categories) return undefined;
  const names = Object.values(feed.categories).filter(Boolean);
  return names.length ? names.join(", ") : undefined;
}

/**
 * Which Podcasting 2.0 tags a feed carries.
 *
 * This is the fastest read on whether a show is worth further calls. A feed
 * with no value block will never answer a value question, and one with no
 * transcripts cannot be searched, so saying it once here saves a round trip
 * that was always going to come back empty.
 */
function feedTags(feed: Feed): string | undefined {
  const tags: string[] = [];
  if (feed.value) tags.push("value");
  if (feed.funding) tags.push("funding");
  if (feed.locked) tags.push("locked");
  if (feed.medium && feed.medium !== "podcast") tags.push(`medium:${feed.medium}`);
  return tags.length ? tags.join(" ") : undefined;
}

export function renderFeed(feed: Feed, indent = "  "): string {
  const head =
    `${indent}<podcast` +
    attr("feed_id", feed.id) +
    attr("title", feed.title) +
    attr("author", feed.author || feed.ownerName) +
    attr("episodes", feed.episodeCount) +
    attr("language", feed.language) +
    attr("medium", feed.medium) +
    attr("itunes_id", feed.itunesId ?? undefined) +
    attr("newest_episode", isoFrom(feed.newestItemPubdate)) +
    attr("categories", categoryNames(feed)) +
    attr("tags", feedTags(feed)) +
    (feed.dead ? ` dead="true"` : "") +
    `>`;

  const lines = [head];
  if (feed.podcastGuid) lines.push(`${indent}  <podcast_guid>${feed.podcastGuid}</podcast_guid>`);
  if (feed.url) lines.push(`${indent}  <feed_url>${escapeAttr(feed.url)}</feed_url>`);
  if (feed.link) lines.push(`${indent}  <website>${escapeAttr(feed.link)}</website>`);
  if (feed.artwork || feed.image) {
    lines.push(`${indent}  <artwork>${escapeAttr(feed.artwork || feed.image || "")}</artwork>`);
  }
  if (feed.description?.trim()) {
    lines.push(`${indent}  <description>`);
    lines.push(fence("show_notes", feed.description.trim()));
    lines.push(`${indent}  </description>`);
  }
  lines.push(`${indent}</podcast>`);
  return lines.join("\n");
}

export function renderFeeds(
  feeds: Feed[],
  meta: { source: string; query?: string; note?: string },
): string {
  const head =
    `<podcasts` +
    attr("count", feeds.length) +
    attr("source", meta.source) +
    attr("query", meta.query) +
    `>`;
  const body = feeds.map((feed) => renderFeed(feed)).join("\n");
  const note = meta.note ? `\n  <note>${escapeAttr(meta.note)}</note>` : "";
  return `${head}${note}\n${body}\n</podcasts>`;
}

/**
 * Podcasting 2.0 detail on one episode, as flags rather than payloads.
 *
 * The URLs are deliberately not inlined. A transcript URL in a listing invites
 * a model to report it as the answer, which is the failure this whole server
 * exists to avoid. What a caller needs to know here is that a transcript
 * exists; `get_transcript` is how it gets read.
 */
function episodeTags(episode: Episode): string | undefined {
  const tags: string[] = [];
  const transcripts = episode.transcripts?.length ?? (episode.transcriptUrl ? 1 : 0);
  if (transcripts) tags.push("transcript");
  if (episode.chaptersUrl) tags.push("chapters");
  if (episode.soundbites?.length) tags.push(`soundbites:${episode.soundbites.length}`);
  if (episode.persons?.length) tags.push(`people:${episode.persons.length}`);
  if (episode.value) tags.push("value");
  if (episode.socialInteract?.length) tags.push("discussion");
  return tags.length ? tags.join(" ") : undefined;
}

export function renderEpisode(episode: Episode, indent = "  "): string {
  const head =
    `${indent}<episode` +
    attr("episode_id", episode.id) +
    attr("title", episode.title) +
    attr("published", isoFrom(episode.datePublished)) +
    attr("duration_seconds", episode.duration) +
    attr("season", episode.season) +
    attr("number", episode.episode ?? undefined) +
    attr("type", episode.episodeType ?? undefined) +
    attr("feed_id", episode.feedId) +
    attr("show", episode.feedTitle) +
    attr("has", episodeTags(episode)) +
    (episode.status ? attr("live_status", episode.status) : "") +
    `>`;

  const lines = [head];
  if (episode.guid) lines.push(`${indent}  <guid>${escapeAttr(episode.guid)}</guid>`);
  if (episode.enclosureUrl) {
    lines.push(`${indent}  <audio>${escapeAttr(episode.enclosureUrl)}</audio>`);
  }
  if (episode.link) lines.push(`${indent}  <link>${escapeAttr(episode.link)}</link>`);

  if (episode.persons?.length) {
    const people = episode.persons
      .map((p) => (p.role ? `${p.name} (${p.role})` : p.name))
      .filter(Boolean)
      .join(", ");
    if (people) lines.push(`${indent}  <people>${escapeAttr(people)}</people>`);
  }

  if (episode.description?.trim()) {
    lines.push(`${indent}  <description>`);
    lines.push(fence("show_notes", episode.description.trim()));
    lines.push(`${indent}  </description>`);
  }
  lines.push(`${indent}</episode>`);
  return lines.join("\n");
}

export function renderEpisodes(
  episodes: Episode[],
  meta: { source: string; query?: string; note?: string },
): string {
  const head =
    `<episodes` + attr("count", episodes.length) + attr("source", meta.source) + attr("query", meta.query) + `>`;
  const body = episodes.map((episode) => renderEpisode(episode)).join("\n");
  const note = meta.note ? `\n  <note>${escapeAttr(meta.note)}</note>` : "";
  return `${head}${note}\n${body}\n</episodes>`;
}

/**
 * A value block, which is a payment split and deserves care.
 *
 * Splits are relative weights, not percentages, so a block of 90 and 10 and one
 * of 9 and 1 are the same split. Rendering the computed percentage alongside
 * the raw weight is the difference between a reader understanding the split and
 * guessing at it.
 */
export function renderValue(value: ValueBlock | null | undefined, label: string): string {
  if (!value || !value.destinations?.length) {
    return `<value${attr("for", label)} present="false">\n  <note>This feed publishes no value block, which is the normal case. Most podcasts do not carry one.</note>\n</value>`;
  }

  const total = value.destinations.reduce((sum, d) => sum + (Number(d.split) || 0), 0);
  const lines = [
    `<value` +
      attr("for", label) +
      ` present="true"` +
      attr("type", value.model?.type) +
      attr("method", value.model?.method) +
      attr("suggested", value.model?.suggested) +
      attr("recipients", value.destinations.length) +
      `>`,
  ];

  for (const d of value.destinations) {
    const split = Number(d.split) || 0;
    const share = total > 0 ? `${((split / total) * 100).toFixed(1)}%` : undefined;
    lines.push(
      `  <recipient` +
        attr("name", d.name) +
        attr("split", split) +
        attr("share", share) +
        attr("type", d.type) +
        (d.fee ? ` fee="true"` : "") +
        attr("address", d.address) +
        ` />`,
    );
  }
  lines.push(
    `  <note>Splits are relative weights, not percentages. The share column is computed from the total of ${total}.</note>`,
  );
  lines.push(`</value>`);
  return lines.join("\n");
}

export function renderCategories(categories: Category[]): string {
  const body = categories
    .map((c) => `  <category id="${c.id}" name="${escapeAttr(c.name)}" />`)
    .join("\n");
  return `<categories count="${categories.length}">\n${body}\n</categories>`;
}

export function renderStats(stats: IndexStats): string {
  const rows = Object.entries(stats)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `  <stat name="${k}" value="${v}" />`)
    .join("\n");
  return `<index_stats>\n${rows}\n</index_stats>`;
}
