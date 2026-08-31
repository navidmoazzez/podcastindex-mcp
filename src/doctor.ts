/**
 * The command that says what is actually broken.
 *
 * Integrations fail for about five reasons and all of them look identical from
 * inside an MCP client, which reports "the tool errored" and nothing else.
 *
 * The reason this file earns its place here specifically is the clock. Podcast
 * Index signs every request with a timestamp and accepts a three minute window.
 * A machine outside that window fails every call with a 401, and a 401 reads as
 * "wrong key" to everybody, so the natural response is to regenerate a
 * perfectly good credential and fail again. Measuring the drift against the
 * server's own Date header turns a mystery into one line of output.
 */

import { PodcastIndexClient } from "./api/client.js";
import { HttpClient } from "./api/http.js";
import { hasCredentials, loadConfig } from "./config.js";
import { ALL_TOOLS } from "./tools/index.js";

type Check = { name: string; ok: boolean; detail: string };

/** How far outside the signing window is fatal. The API allows three minutes. */
const WINDOW_SECONDS = 180;

export async function runDoctor(): Promise<number> {
  const config = loadConfig();
  const http = new HttpClient(config);
  const api = new PodcastIndexClient(http);
  const checks: Check[] = [];

  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "Node version",
    ok: major >= 20,
    detail: major >= 20 ? `v${process.versions.node}` : `v${process.versions.node}, needs 20 or newer`,
  });

  checks.push({
    name: "API key",
    ok: Boolean(config.apiKey),
    detail: config.apiKey
      ? `set, ${config.apiKey.length} characters`
      : "PODCASTINDEX_API_KEY is not set",
  });
  checks.push({
    name: "API secret",
    ok: Boolean(config.apiSecret),
    detail: config.apiSecret
      ? `set, ${config.apiSecret.length} characters`
      : "PODCASTINDEX_API_SECRET is not set. The key alone cannot sign a request",
  });

  let clockDetail = "not measured";
  let clockOk = true;

  if (hasCredentials(config)) {
    try {
      const stats = await api.stats();
      const total = stats.stats?.feedCountTotal;
      checks.push({
        name: "Podcast Index API",
        ok: true,
        detail: total ? `reachable and authenticated, ${total.toLocaleString()} feeds indexed` : "reachable and authenticated",
      });
    } catch (error) {
      checks.push({
        name: "Podcast Index API",
        ok: false,
        detail: (error as Error)?.message ?? String(error),
      });
    }

    // Measured even when the call above failed, because the 401 response
    // carries a Date header too, and a drifting clock is the likeliest reason
    // that call failed in the first place.
    const skew = api.clockSkewSeconds;
    if (skew === undefined) {
      clockDetail = "could not be measured: no response reached the server";
      clockOk = false;
    } else if (Math.abs(skew) >= WINDOW_SECONDS) {
      clockOk = false;
      clockDetail = `this machine is ${Math.abs(skew)} seconds ${
        skew > 0 ? "ahead of" : "behind"
      } Podcast Index, which is outside the ${WINDOW_SECONDS} second signing window. Every request will fail with a 401 that looks like a bad key. Fix the clock rather than the credentials: enable automatic time sync in system settings, or run "sudo sntp -sS time.apple.com" on macOS`;
    } else {
      clockDetail = `${Math.abs(skew)} seconds ${skew >= 0 ? "ahead" : "behind"}, well inside the ${WINDOW_SECONDS} second signing window`;
    }
  } else {
    clockDetail = "not measured: credentials are needed to reach the server";
  }

  checks.push({ name: "Clock sync", ok: clockOk, detail: clockDetail });

  const writeTools = ALL_TOOLS.filter((tool) => tool.risk !== "read").length;
  checks.push({
    name: "Tools registered",
    ok: true,
    detail: config.readOnly
      ? `${ALL_TOOLS.length - writeTools} of ${ALL_TOOLS.length}, writes hidden by PODCASTINDEX_READ_ONLY=1`
      : `${ALL_TOOLS.length}, including ${writeTools} that write`,
  });

  if (config.auditPath) {
    checks.push({ name: "Audit log", ok: true, detail: config.auditPath });
  }

  const width = Math.max(...checks.map((c) => c.name.length));
  const lines = checks.map(
    (c) => `${c.ok ? "  ok  " : " FAIL "} ${c.name.padEnd(width)}  ${c.detail}`,
  );

  const failed = checks.filter((c) => !c.ok);
  process.stdout.write(`podcastindex-mcp doctor\n\n${lines.join("\n")}\n\n`);

  if (!failed.length) {
    process.stdout.write("Everything checks out.\n");
    return 0;
  }

  process.stdout.write(
    `${failed.length} problem${failed.length === 1 ? "" : "s"}. Fix the first one and run this again: they often cascade.\n`,
  );
  if (!hasCredentials(config)) {
    process.stdout.write(
      "\nGet a free key and secret at https://api.podcastindex.org/signup, then set both in the server's env block.\n",
    );
  }
  return 1;
}
