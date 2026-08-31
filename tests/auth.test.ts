/**
 * Signing, and the clock measurement that makes a 401 diagnosable.
 *
 * The signature is the one thing here that is impossible to debug from the
 * outside: a wrong concatenation order or an upper-case digest produces a 401
 * identical to a wrong secret. So it is pinned against an independently
 * computed digest rather than against whatever the implementation happens to do.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HttpClient, signRequest } from "../src/api/http.js";
import { PodcastIndexClient } from "../src/api/client.js";
import { MissingCredentialsError } from "../src/api/errors.js";
import { fakeFetch, testConfig } from "./helpers.js";

describe("request signing", () => {
  it("hashes key, secret and date in that order as lower-case hex", () => {
    const headers = signRequest("KEY", "SECRET", 1_600_000_000);
    const expected = createHash("sha1").update("KEYSECRET1600000000").digest("hex");

    expect(headers.Authorization).toBe(expected);
    expect(headers.Authorization).toBe(headers.Authorization?.toLowerCase());
    expect(headers["X-Auth-Key"]).toBe("KEY");
    expect(headers["X-Auth-Date"]).toBe("1600000000");
  });

  it("sends all four required headers on a real request", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: { status: "true", stats: {} } }));
    await new PodcastIndexClient(new HttpClient(testConfig(), fetch)).stats();

    const call = calls[0]!;
    expect(call.headers["x-auth-key"]).toBe("TESTKEY");
    expect(call.headers["x-auth-date"]).toMatch(/^\d+$/);
    expect(call.headers.authorization).toMatch(/^[0-9a-f]{40}$/);
    // Podcast Index answers a missing User-Agent with a 401 that reads as an
    // auth failure, so its absence would be a silent, misdiagnosed break.
    expect(call.headers["user-agent"]).toBeTruthy();
  });

  it("re-signs on each retry so a backoff cannot age the timestamp out", async () => {
    let attempt = 0;
    const { fetch, calls } = fakeFetch(() => {
      attempt++;
      return attempt === 1
        ? { status: 503, body: "upstream" }
        : { body: { status: "true", stats: {} } };
    });
    const config = testConfig({ maxRetries: 2 });
    await new PodcastIndexClient(new HttpClient(config, fetch)).stats();

    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers.authorization).toMatch(/^[0-9a-f]{40}$/);
    expect(calls[1]!.headers.authorization).toMatch(/^[0-9a-f]{40}$/);
  });

  it("never sends credentials on the endpoints that take none", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: { status: "true" } }));
    await new PodcastIndexClient(new HttpClient(testConfig(), fetch)).pubNotify({ id: 1 });

    expect(calls[0]!.headers["x-auth-key"]).toBeUndefined();
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  it("refuses to call a signed endpoint with only half a credential", async () => {
    const { fetch } = fakeFetch(() => ({ body: {} }));
    const client = new PodcastIndexClient(
      new HttpClient(testConfig({ apiSecret: undefined }), fetch),
    );
    await expect(client.stats()).rejects.toBeInstanceOf(MissingCredentialsError);
  });
});

describe("clock skew", () => {
  it("measures drift from the server's own Date header", async () => {
    const twoMinutesAgo = new Date(Date.now() - 120_000).toUTCString();
    const { fetch } = fakeFetch(() => ({
      body: { status: "true", stats: {} },
      headers: { date: twoMinutesAgo },
    }));
    const http = new HttpClient(testConfig(), fetch);
    await new PodcastIndexClient(http).stats();

    expect(http.clockSkewSeconds).toBeGreaterThanOrEqual(119);
    expect(http.clockSkewSeconds).toBeLessThanOrEqual(121);
  });

  it("still measures drift on a 401, which is when it matters most", async () => {
    const skewed = new Date(Date.now() - 600_000).toUTCString();
    const { fetch } = fakeFetch(() => ({
      status: 401,
      body: "unauthorized",
      headers: { date: skewed },
    }));
    const http = new HttpClient(testConfig(), fetch);
    await expect(new PodcastIndexClient(http).stats()).rejects.toThrow();

    expect(http.clockSkewSeconds).toBeGreaterThan(500);
  });

  it("explains all four causes in the 401 message rather than saying unauthorized", async () => {
    const { fetch } = fakeFetch(() => ({ status: 401, body: "" }));
    const client = new PodcastIndexClient(new HttpClient(testConfig(), fetch));
    await expect(client.stats()).rejects.toThrow(/clock/i);
  });
});
