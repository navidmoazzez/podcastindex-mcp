/**
 * The one HTTP path every network call goes through, and the request signing.
 *
 * **Signing.** Podcast Index authenticates each request on its own rather than
 * with a session. Three headers travel together: the key, a unix timestamp, and
 * a SHA-1 of the key, the secret and that timestamp concatenated in that order,
 * lower-case hex. The secret itself is never transmitted.
 *
 * **The timestamp is the trap.** The server accepts roughly a three minute
 * window either side of its own clock. A laptop that slept through a timezone
 * change, a container with no NTP, or a VM restored from a snapshot will fail
 * every single call with a 401 that is indistinguishable from a wrong key. So
 * this client records the server's own `Date` header on every response and
 * exposes the drift, which is what lets `doctor` say "your clock is 4 minutes
 * fast" instead of "unauthorized".
 *
 * **Two surfaces, deliberately separate.** `request` talks to Podcast Index
 * with credentials. `fetchFile` fetches a transcript or a chapter file from
 * whatever host the podcaster put it on. Those hosts are arbitrary, unvetted,
 * frequently slow, and occasionally serve a 200 MB file where a transcript was
 * promised. Folding them into one client would mean either signing requests to
 * strangers, which leaks nothing but is sloppy, or giving Podcast Index the
 * loose limits an unknown host needs. So they are separate methods with
 * separate deadlines and a size cap on the one that needs it.
 *
 * `fetchImpl` is injectable so tests exercise all of this without a network.
 * A test that needs the internet is a test nobody runs.
 */

import { createHash } from "node:crypto";
import type { Config } from "../config.js";
import {
  MissingCredentialsError,
  PodcastIndexError,
  TimeoutError,
  errorFor,
  isRetryable,
  type ErrorSurface,
} from "./errors.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type CacheEntry = { at: number; value: unknown };

export type RequestOptions = {
  /** Query parameters. Undefined and empty values are dropped, not sent blank. */
  params?: Record<string, string | number | boolean | undefined>;
  /** Skip the cache for this call. */
  fresh?: boolean;
  method?: "GET" | "POST";
  /** Form body for the two POST batch endpoints. */
  form?: Record<string, string>;
  /**
   * Send no credentials. For hub/pubnotify and the static data files, which
   * Podcast Index serves to anyone. Signing them would work but would make the
   * server look like it needs a key for things it does not.
   */
  anonymous?: boolean;
};

/** The signing headers for one request, at one moment in time. */
export function signRequest(
  apiKey: string,
  apiSecret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const date = String(nowSeconds);
  // Concatenation order is fixed by the API and the digest is lower-case hex.
  // Getting either wrong produces a 401 that looks exactly like a bad secret.
  const authorization = createHash("sha1").update(`${apiKey}${apiSecret}${date}`).digest("hex");
  return {
    "X-Auth-Key": apiKey,
    "X-Auth-Date": date,
    Authorization: authorization,
  };
}

export class HttpClient {
  private readonly config: Config;
  private readonly fetchImpl: FetchLike;
  private readonly cache = new Map<string, CacheEntry>();
  /** Tail of the request queue. Each call waits for the one before it. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  /**
   * Seconds this machine's clock is ahead of the server's, from the last
   * response that carried a Date header. Positive means we are fast.
   * Undefined until a request has completed.
   */
  clockSkewSeconds?: number;

  constructor(config: Config, fetchImpl: FetchLike = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  /** A signed call against the Podcast Index API. */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.config.apiHost}${path}`;
    const surface: ErrorSurface = options.anonymous ? "open" : "index";

    if (!options.anonymous && !(this.config.apiKey && this.config.apiSecret)) {
      throw new MissingCredentialsError(
        this.config.apiKey ? "the secret is missing" : "neither is set",
      );
    }

    const full = withParams(url, options.params);
    const method = options.method ?? "GET";
    const key = `${method} ${full}${options.form ? JSON.stringify(options.form) : ""}`;

    // Only GETs are cached. A POST batch is cheap to repeat and caching one
    // would silently answer a changed list with a stale response.
    if (!options.fresh && method === "GET") {
      const hit = this.cache.get(key);
      if (hit && Date.now() - hit.at < this.config.cacheTtlMs) return hit.value as T;
    }

    const value = await this.enqueue(() => this.attempt<T>(full, method, options, surface));

    if (method === "GET") {
      this.cache.set(key, { at: Date.now(), value });
      // Unbounded growth would be a slow leak in a long-lived server. The cap
      // is far above any single conversation's working set.
      if (this.cache.size > 500) {
        const oldest = this.cache.keys().next();
        if (!oldest.done) this.cache.delete(oldest.value);
      }
    }
    return value;
  }

  /**
   * Fetch a file from a podcaster's own host: a transcript, a chapter file.
   *
   * Unsigned, longer deadline, and capped by bytes read rather than trusting
   * Content-Length, because a host that lies about the length is exactly the
   * kind of host that serves a transcript URL pointing at a 300 MB audio file.
   */
  async fetchFile(
    url: string,
    options: { accept?: string; maxBytes?: number } = {},
  ): Promise<{ body: string; contentType: string; truncated: boolean; url: string }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new PodcastIndexError(`"${url}" is not a URL.`, 0, url, { surface: "web" });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new PodcastIndexError(
        `Refusing to fetch a ${parsed.protocol} URL. Only http and https are read.`,
        0,
        url,
        { surface: "web" },
      );
    }

    // Generous, because these are the biggest thing the server reads and a
    // truncated transcript is still useful where a rejected one is not.
    const maxBytes = options.maxBytes ?? 8_000_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.fileTimeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": this.config.userAgent,
          Accept: options.accept ?? "*/*",
        },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw errorFor(response.status, hostOf(url), body, "web");
      }

      const contentType = response.headers.get("content-type") ?? "";
      const raw = await response.text();
      const truncated = raw.length > maxBytes;
      return {
        body: truncated ? raw.slice(0, maxBytes) : raw,
        contentType,
        truncated,
        url: response.url || url,
      };
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        throw new TimeoutError(
          `${hostOf(url)} did not respond within ${this.config.fileTimeoutMs}ms. This is the podcaster's own host, not Podcast Index, and a slow or dead transcript host is common. Raise PODCASTINDEX_FILE_TIMEOUT_MS if it is simply slow.`,
          hostOf(url),
          "web",
        );
      }
      if (error instanceof PodcastIndexError) throw error;
      throw new PodcastIndexError(
        `Could not fetch ${hostOf(url)}: ${(error as Error)?.message ?? String(error)}. Transcript and chapter files are hosted by the podcaster, so this URL can be dead while the feed itself is fine.`,
        0,
        hostOf(url),
        { surface: "web" },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Serialise every request behind the configured minimum interval. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const gap = this.config.minRequestIntervalMs - (Date.now() - this.lastRequestAt);
      if (gap > 0) await sleep(gap);
      this.lastRequestAt = Date.now();
      return task();
    });
    // The queue must keep moving even when a call rejects, or one failure
    // deadlocks every request behind it for the life of the process.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async attempt<T>(
    url: string,
    method: "GET" | "POST",
    options: RequestOptions,
    surface: ErrorSurface,
  ): Promise<T> {
    let lastError: unknown;

    for (let tryNumber = 0; tryNumber <= this.config.maxRetries; tryNumber++) {
      if (tryNumber > 0) {
        // Exponential with jitter. Without the jitter, several tools that
        // started together retry together and trip the same limit again.
        const base = Math.min(1000 * 2 ** (tryNumber - 1), 8000);
        await sleep(base + Math.random() * 250);
      }
      try {
        return await this.once<T>(url, method, options, surface);
      } catch (error) {
        lastError = error;
        if (!isRetryable(error)) throw error;
      }
    }
    throw lastError;
  }

  private async once<T>(
    url: string,
    method: "GET" | "POST",
    options: RequestOptions,
    surface: ErrorSurface,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    const headers: Record<string, string> = {
      // Podcast Index asks every client to identify itself, and answers an
      // absent User-Agent with a 401 that looks like an auth failure.
      "User-Agent": this.config.userAgent,
      Accept: "application/json",
    };

    // Signed fresh on every attempt rather than once per call. A retry after an
    // eight second backoff would otherwise present a timestamp that has aged,
    // and enough retries would age it out of the window entirely.
    if (!options.anonymous && this.config.apiKey && this.config.apiSecret) {
      Object.assign(headers, signRequest(this.config.apiKey, this.config.apiSecret));
    }

    let body: string | undefined;
    if (options.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(options.form).toString();
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, { method, signal: controller.signal, headers, body });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        throw new TimeoutError(
          `No response from ${hostOf(url)} within ${this.config.requestTimeoutMs}ms. Raise PODCASTINDEX_REQUEST_TIMEOUT_MS if the host is simply slow.`,
          hostOf(url),
          surface,
        );
      }
      throw new PodcastIndexError(
        `Could not reach ${hostOf(url)}: ${(error as Error)?.message ?? String(error)}`,
        0,
        hostOf(url),
        { surface, retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }

    this.recordClockSkew(response);

    const text = await response.text();
    if (!response.ok) throw errorFor(response.status, hostOf(url), text, surface);

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new PodcastIndexError(
        `${hostOf(url)} returned a response that is not JSON.`,
        response.status,
        hostOf(url),
        { surface, detail: text.slice(0, 200) },
      );
    }
  }

  /**
   * Learn the clock offset from the server's own Date header.
   *
   * This is the whole reason a drifting clock is diagnosable rather than a
   * mystery 401. Every HTTP response carries a Date, so the measurement is free
   * and needs no extra request, including on the 401 itself.
   */
  private recordClockSkew(response: Response): void {
    const serverDate = response.headers.get("date");
    if (!serverDate) return;
    const serverMs = Date.parse(serverDate);
    if (!Number.isFinite(serverMs)) return;
    this.clockSkewSeconds = Math.round((Date.now() - serverMs) / 1000);
  }
}

function withParams(
  url: string,
  params?: Record<string, string | number | boolean | undefined>,
): string {
  if (!params) return url;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    // Several Podcast Index flags are presence-only: `?clean` means clean, and
    // `?clean=false` still means clean. So a false boolean is omitted entirely
    // rather than sent as a value the API would read as "on".
    if (value === false) continue;
    if (value === true) {
      parts.push(encodeURIComponent(key));
      continue;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  if (!parts.length) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${parts.join("&")}`;
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
