/**
 * One typed method per Podcast Index endpoint.
 *
 * Tools call these. Nothing above this layer builds a path or knows a parameter
 * name, so an API change is a one-file edit rather than a hunt through forty
 * tool definitions.
 *
 * **`fulltext` is set on everything that can take it, and that is deliberate.**
 * Without it Podcast Index truncates every text field to 100 characters. A
 * description cut at 100 characters looks like a real description, so a model
 * reading one summarises a show from its first sentence and never knows the
 * rest existed. That is a silent wrong answer, which is worse than an error,
 * and the only cost of avoiding it is response size.
 *
 * **`pretty` is never sent.** It exists to indent JSON for humans reading it in
 * a browser. Sending it inflates every response for a parser that does not care.
 */

import type { HttpClient } from "./http.js";
import type { PodcastIndexError } from "./errors.js";
import type {
  AddResponse,
  CategoriesResponse,
  Envelope,
  FeedResponse,
  FeedsResponse,
  ItemResponse,
  ItemsResponse,
  RecentDataResponse,
  StatsResponse,
  ValueResponse,
} from "./types.js";

/** Shared shape of the filters Podcast Index accepts on its listing endpoints. */
export type ListFilters = {
  max?: number;
  since?: number;
  lang?: string;
  /** Comma-separated category names or ids to include. */
  cat?: string;
  /** Comma-separated category names or ids to exclude. */
  notcat?: string;
};

export class PodcastIndexClient {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  get clockSkewSeconds(): number | undefined {
    return this.http.clockSkewSeconds;
  }

  // ---------------------------------------------------------------- search

  searchByTerm(params: {
    q: string;
    max?: number;
    val?: string;
    aponly?: boolean;
    clean?: boolean;
    similar?: boolean;
  }): Promise<FeedsResponse> {
    return this.http.request<FeedsResponse>("/search/byterm", {
      params: { ...params, fulltext: true },
    });
  }

  searchByTitle(params: {
    q: string;
    max?: number;
    val?: string;
    clean?: boolean;
    similar?: boolean;
  }): Promise<FeedsResponse> {
    return this.http.request<FeedsResponse>("/search/bytitle", {
      params: { ...params, fulltext: true },
    });
  }

  searchByPerson(params: { q: string; max?: number }): Promise<ItemsResponse> {
    return this.http.request<ItemsResponse>("/search/byperson", {
      params: { ...params, fulltext: true },
    });
  }

  searchMusic(params: {
    q: string;
    max?: number;
    val?: string;
    aponly?: boolean;
    clean?: boolean;
  }): Promise<FeedsResponse> {
    return this.http.request<FeedsResponse>("/search/music/byterm", {
      params: { ...params, fulltext: true },
    });
  }

  // --------------------------------------------------------------- podcasts

  podcastByFeedId(id: number): Promise<FeedResponse> {
    return this.http.request<FeedResponse>("/podcasts/byfeedid", { params: { id } });
  }

  podcastByFeedUrl(url: string): Promise<FeedResponse> {
    return this.http.request<FeedResponse>("/podcasts/byfeedurl", { params: { url } });
  }

  podcastByGuid(guid: string): Promise<FeedResponse> {
    return this.http.request<FeedResponse>("/podcasts/byguid", { params: { guid } });
  }

  podcastByItunesId(id: number): Promise<FeedResponse> {
    return this.http.request<FeedResponse>("/podcasts/byitunesid", { params: { id } });
  }

  podcastsByMedium(params: { medium: string; max?: number }): Promise<FeedsResponse> {
    return this.http.request<FeedsResponse>("/podcasts/bymedium", { params });
  }

  /**
   * Feeds carrying a Podcasting 2.0 tag.
   *
   * The parameter names are literally `podcast-value` and
   * `podcast-valueTimeSplit`, hyphens included, and they are presence flags
   * rather than values. That is why this method takes booleans and the caller
   * never sees the wire names.
   */
  podcastsByTag(params: {
    value?: boolean;
    valueTimeSplit?: boolean;
    max?: number;
    start_at?: number;
  }): Promise<FeedsResponse> {
    return this.http.request<FeedsResponse>("/podcasts/bytag", {
      params: {
        "podcast-value": params.value,
        "podcast-valueTimeSplit": params.valueTimeSplit,
        max: params.max,
        start_at: params.start_at,
      },
    });
  }

  trending(params: ListFilters = {}): Promise<FeedsResponse> {
    return this.http.request<FeedsResponse>("/podcasts/trending", { params });
  }

  deadPodcasts(): Promise<FeedsResponse> {
    return this.http.request<FeedsResponse>("/podcasts/dead", {});
  }

  /** Up to 500 feeds by podcast GUID in one POST, as a comma-separated list. */
  podcastsBatchByGuid(guids: string[]): Promise<FeedsResponse> {
    return this.http.request<FeedsResponse>("/podcasts/batch/byguid", {
      method: "POST",
      form: { guids: guids.join(",") },
    });
  }

  // --------------------------------------------------------------- episodes

  episodesByFeedId(params: {
    id: number | string;
    max?: number;
    since?: number;
    enclosure?: string;
  }): Promise<ItemsResponse> {
    return this.http.request<ItemsResponse>("/episodes/byfeedid", {
      params: { ...params, fulltext: true },
    });
  }

  episodesByFeedUrl(params: { url: string; max?: number; since?: number }): Promise<ItemsResponse> {
    return this.http.request<ItemsResponse>("/episodes/byfeedurl", {
      params: { ...params, fulltext: true },
    });
  }

  episodesByItunesId(params: {
    id: number;
    max?: number;
    since?: number;
  }): Promise<ItemsResponse> {
    return this.http.request<ItemsResponse>("/episodes/byitunesid", {
      params: { ...params, fulltext: true },
    });
  }

  episodesByPodcastGuid(params: {
    guid: string;
    max?: number;
    since?: number;
  }): Promise<ItemsResponse> {
    return this.http.request<ItemsResponse>("/episodes/bypodcastguid", {
      params: { ...params, fulltext: true },
    });
  }

  episodeById(id: number): Promise<ItemResponse> {
    return this.http.request<ItemResponse>("/episodes/byid", {
      params: { id, fulltext: true },
    });
  }

  /**
   * An episode by its GUID.
   *
   * The GUID alone is not unique across the index, so Podcast Index wants one
   * of feedid, feedurl or podcastguid alongside it to say which show. Without
   * one it answers with whatever it finds first, which is a coin flip.
   */
  episodeByGuid(params: {
    guid: string;
    feedid?: number;
    feedurl?: string;
    podcastguid?: string;
  }): Promise<ItemResponse> {
    return this.http.request<ItemResponse>("/episodes/byguid", {
      params: { ...params, fulltext: true },
    });
  }

  liveEpisodes(max?: number): Promise<ItemsResponse> {
    return this.http.request<ItemsResponse>("/episodes/live", { params: { max } });
  }

  randomEpisodes(params: {
    max?: number;
    lang?: string;
    cat?: string;
    notcat?: string;
  } = {}): Promise<ItemsResponse> {
    return this.http.request<ItemsResponse>("/episodes/random", {
      // Random must never be cached, or "give me another" returns the same
      // episodes for the whole cache window and the tool looks broken.
      params: { ...params, fulltext: true },
      fresh: true,
    });
  }

  // ----------------------------------------------------------------- recent

  recentEpisodes(params: {
    max?: number;
    excludeString?: string;
    before?: number;
  } = {}): Promise<ItemsResponse> {
    return this.http.request<ItemsResponse>("/recent/episodes", {
      params: { ...params, fulltext: true },
    });
  }

  recentFeeds(params: ListFilters = {}): Promise<FeedsResponse> {
    return this.http.request<FeedsResponse>("/recent/feeds", { params });
  }

  recentNewFeeds(params: { max?: number; since?: number; desc?: boolean } = {}): Promise<FeedsResponse> {
    return this.http.request<FeedsResponse>("/recent/newfeeds", { params });
  }

  recentNewValueFeeds(params: { max?: number; since?: number } = {}): Promise<FeedsResponse> {
    return this.http.request<FeedsResponse>("/recent/newvaluefeeds", { params });
  }

  recentSoundbites(max?: number): Promise<ItemsResponse> {
    return this.http.request<ItemsResponse>("/recent/soundbites", { params: { max } });
  }

  recentData(params: { max?: number; since?: number } = {}): Promise<RecentDataResponse> {
    return this.http.request<RecentDataResponse>("/recent/data", { params });
  }

  // ------------------------------------------------------------------ value

  /**
   * A feed with no value block is answered with **HTTP 400**, not 200.
   *
   * That is the normal case, not an error: about 33,000 of the index's 4.7
   * million feeds carry a value block, so the overwhelming majority of honest
   * lookups take this branch. Letting the 400 surface would report the most
   * common outcome as a failure, and a caller told "the request was bad" will
   * retry it differently forever rather than concluding the show simply does
   * not take listener payments.
   *
   * So the specific 400 that means "no value block" is translated into an empty
   * result. Any other 400 still throws, because that one really is a bad
   * request.
   */
  private async value(path: string, params: Record<string, string | number>): Promise<ValueResponse> {
    try {
      return await this.http.request<ValueResponse>(path, { params });
    } catch (error) {
      const status = (error as PodcastIndexError)?.status;
      const detail = (error as PodcastIndexError)?.detail ?? "";
      if (status === 400 && /no value block/i.test(detail)) {
        return { status: "false", value: null, description: "This feed has no value block." };
      }
      throw error;
    }
  }

  valueByFeedId(id: number): Promise<ValueResponse> {
    return this.value("/value/byfeedid", { id });
  }

  valueByFeedUrl(url: string): Promise<ValueResponse> {
    return this.value("/value/byfeedurl", { url });
  }

  valueByPodcastGuid(guid: string): Promise<ValueResponse> {
    return this.value("/value/bypodcastguid", { guid });
  }

  valueByEpisodeGuid(params: { podcastguid: string; episodeguid: string }): Promise<ValueResponse> {
    return this.value("/value/byepisodeguid", params);
  }

  // ------------------------------------------------------------ misc, stats

  categories(): Promise<CategoriesResponse> {
    return this.http.request<CategoriesResponse>("/categories/list", {});
  }

  stats(): Promise<StatsResponse> {
    return this.http.request<StatsResponse>("/stats/current", {});
  }

  // ----------------------------------------------------------------- writes

  /**
   * Tell the index a feed has new content, so it recrawls sooner.
   *
   * Notably this endpoint needs no credential at all, which is why it is the
   * one write in this server that works on an unconfigured install.
   */
  pubNotify(params: { id?: number; url?: string }): Promise<Envelope> {
    return this.http.request<Envelope>("/hub/pubnotify", { params, anonymous: true, fresh: true });
  }

  addByFeedUrl(params: { url: string; itunesid?: number; chash?: string }): Promise<AddResponse> {
    return this.http.request<AddResponse>("/add/byfeedurl", { params, fresh: true });
  }

  addByItunesId(id: number): Promise<AddResponse> {
    return this.http.request<AddResponse>("/add/byitunesid", { params: { id }, fresh: true });
  }
}
