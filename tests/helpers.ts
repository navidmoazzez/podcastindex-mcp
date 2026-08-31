/**
 * A fake fetch, so every test runs with no network and no credentials.
 *
 * A test that needs the internet is a test nobody runs, and one that needs a
 * real key is a test that cannot run in CI at all.
 */

import type { FetchLike } from "../src/api/http.js";
import { loadConfig, type Config } from "../src/config.js";

export type Recorded = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

export function fakeFetch(
  responder: (url: string, init?: RequestInit) => { status?: number; body: unknown; headers?: Record<string, string> },
): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });

    const result = responder(url, init);
    const text = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
    return new Response(text, {
      status: result.status ?? 200,
      headers: { date: new Date().toUTCString(), ...(result.headers ?? {}) },
    });
  };
  return { fetch: fetchImpl, calls };
}

/** Config with credentials set and every delay removed, for fast tests. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig(),
    apiKey: "TESTKEY",
    apiSecret: "testsecret",
    minRequestIntervalMs: 1,
    maxRetries: 0,
    cacheTtlMs: 0,
    readOnly: false,
    allowDestructive: true,
    auditPath: undefined,
    ...overrides,
  };
}

export const FEED = {
  id: 920666,
  podcastGuid: "9b024349-ccf0-5f69-a609-6b82873eab3c",
  title: "Test Show",
  url: "https://example.com/feed.xml",
  author: "A Host",
  description: "A show about testing.",
  episodeCount: 42,
  language: "en",
  medium: "podcast",
  dead: 0,
  crawlErrors: 0,
  parseErrors: 0,
  lastHttpStatus: 200,
  // Relative to now, not pinned. A fixture with a hardcoded timestamp starts
  // failing the health checks the moment it ages past their thresholds, which
  // is a test that breaks on the calendar rather than on a change.
  lastCrawlTime: Math.floor(Date.now() / 1000) - 3_600,
  lastParseTime: Math.floor(Date.now() / 1000) - 3_600,
  lastGoodHttpStatusTime: Math.floor(Date.now() / 1000) - 3_600,
  newestItemPubdate: Math.floor(Date.now() / 1000) - 86_400,
};

export const EPISODE = {
  id: 12345,
  title: "Episode One",
  feedId: 920666,
  feedTitle: "Test Show",
  datePublished: Math.floor(Date.now() / 1000) - 86_400,
  duration: 3600,
  guid: "ep-1",
  enclosureUrl: "https://example.com/ep1.mp3",
  description: "In this one we talk about testing.",
  transcripts: [{ url: "https://example.com/ep1.srt", type: "application/srt" }],
  chaptersUrl: "https://example.com/ep1-chapters.json",
  soundbites: [{ startTime: 60, duration: 30, title: "The good bit" }],
  persons: [{ name: "A Guest", role: "guest" }],
};
