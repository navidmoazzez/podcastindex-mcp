/**
 * The shapes Podcast Index actually returns.
 *
 * Written against the published OpenAPI description rather than from memory,
 * because a field name guessed wrong produces a server that compiles, runs, and
 * quietly returns undefined for the one value the caller wanted.
 *
 * Two things are worth knowing before reading these.
 *
 * Almost everything interesting is nullable. Podcasting 2.0 tags are optional
 * in a feed and most publishers use none of them, so `transcripts`, `persons`,
 * `value`, `soundbites` and `chaptersUrl` are absent far more often than
 * present. Code here treats absence as the normal case, not an error.
 *
 * The envelope key changes per endpoint and is not guessable. A podcast search
 * returns `feeds`, an episode search returns `items`, a single lookup returns
 * `feed` or `episode`, and the category list returns its categories under
 * `feeds`, which is simply what the API calls them.
 */

export type Envelope = {
  status: string | boolean;
  description?: string;
  count?: number;
};

export type Transcript = {
  url: string;
  /** Mime type: text/vtt, application/srt, application/json, text/html. */
  type: string;
};

export type Person = {
  id?: number;
  name: string;
  /** host, guest, producer, and so on. Free text in practice. */
  role?: string;
  group?: string;
  href?: string;
  img?: string;
};

export type Soundbite = {
  startTime: number;
  duration: number;
  title?: string;
};

export type ValueDestination = {
  name?: string;
  address?: string;
  type?: string;
  split?: number;
  fee?: boolean;
  customKey?: string;
  customValue?: string;
};

export type ValueBlock = {
  model?: { type?: string; method?: string; suggested?: string };
  destinations?: ValueDestination[];
};

export type SocialInteract = {
  url?: string;
  protocol?: string;
  accountId?: string;
  accountUrl?: string;
  priority?: number;
};

export type Feed = {
  id: number;
  podcastGuid?: string;
  title?: string;
  url?: string;
  originalUrl?: string;
  link?: string;
  description?: string;
  author?: string;
  ownerName?: string;
  image?: string;
  artwork?: string;
  lastUpdateTime?: number;
  lastCrawlTime?: number;
  lastParseTime?: number;
  lastGoodHttpStatusTime?: number;
  lastHttpStatus?: number;
  contentType?: string;
  itunesId?: number | null;
  itunesType?: string;
  generator?: string;
  language?: string;
  explicit?: boolean | number;
  type?: number;
  /** 0 alive, 1 dead. */
  dead?: number;
  medium?: string;
  episodeCount?: number;
  crawlErrors?: number;
  parseErrors?: number;
  categories?: Record<string, string> | null;
  locked?: number;
  imageUrlHash?: number;
  newestItemPubdate?: number;
  /** Only populated on the dead-feeds endpoint. */
  duplicateOf?: number | null;
  value?: ValueBlock | null;
  funding?: { url?: string; message?: string } | null;
};

export type Episode = {
  id: number;
  title?: string;
  link?: string;
  description?: string;
  guid?: string;
  datePublished?: number;
  datePublishedPretty?: string;
  dateCrawled?: number;
  enclosureUrl?: string;
  enclosureType?: string;
  enclosureLength?: number;
  duration?: number;
  explicit?: number;
  episode?: number | null;
  episodeType?: string | null;
  season?: number;
  image?: string;
  feedItunesId?: number | null;
  feedImage?: string;
  feedId?: number;
  feedTitle?: string;
  feedLanguage?: string;
  feedDead?: number;
  feedUrl?: string;
  podcastGuid?: string;
  /** Legacy single-transcript field. `transcripts` is the one to prefer. */
  transcriptUrl?: string | null;
  transcripts?: Transcript[] | null;
  chaptersUrl?: string | null;
  persons?: Person[] | null;
  soundbites?: Soundbite[] | null;
  socialInteract?: SocialInteract[] | null;
  value?: ValueBlock | null;
  /** Live items only. */
  startTime?: number;
  endTime?: number;
  status?: string;
  contentLink?: string;
};

export type Category = { id: number; name: string };

export type IndexStats = {
  feedCountTotal?: number;
  episodeCountTotal?: number;
  feedsWithNewEpisodes3days?: number;
  feedsWithNewEpisodes10days?: number;
  feedsWithNewEpisodes30days?: number;
  feedsWithNewEpisodes90days?: number;
  feedsWithValueBlocks?: number;
};

export type FeedsResponse = Envelope & {
  feeds: Feed[];
  query?: unknown;
  max?: number;
  /** Echoed back by trending and the recent endpoints: the window measured. */
  since?: number;
};
export type FeedResponse = Envelope & { feed: Feed | Feed[]; query?: unknown };
export type ItemsResponse = Envelope & { items: Episode[]; liveItems?: Episode[]; query?: unknown };
export type ItemResponse = Envelope & { episode: Episode | Episode[]; id?: string };
export type ValueResponse = Envelope & { value: ValueBlock | null; query?: unknown };
export type StatsResponse = Envelope & { stats: IndexStats };
export type CategoriesResponse = Envelope & { feeds: Category[] };
export type AddResponse = Envelope & { feedId?: number; existed?: boolean };
export type RecentDataResponse = Envelope & {
  feedCount?: number;
  itemCount?: number;
  max?: number;
  since?: number;
  nextSince?: number;
  data?: { position?: number; feeds?: unknown[]; items?: unknown[] };
};
