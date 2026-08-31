/**
 * Settings, and the three surfaces this server reaches.
 *
 * Podcast Index looks like one API and is really three things with different
 * requirements, which is why this file is shaped the way it is:
 *
 *   1. the signed API        api.podcastindex.org/api/1.0, needs a key and a
 *                            secret, and signs every single request
 *   2. the open endpoints    hub/pubnotify and the static data files, which
 *                            take no credential at all
 *   3. the open web          transcript and chapter files, which live on the
 *                            podcaster's own host and not on Podcast Index
 *
 * The third one is the reason this server is worth more than a thin wrapper.
 * The API answers most interesting questions with a URL, and a URL is a dead
 * end for a model that cannot open it. Fetching those files is a different kind
 * of request against hosts nobody vetted, so it is a separate surface with its
 * own timeout and its own size cap rather than being folded into the API client.
 *
 * The one setting worth understanding is the clock. Every signed request
 * carries a timestamp and Podcast Index accepts a three minute window either
 * side of its own. A machine with a drifting clock fails every call with an
 * authentication error that reads exactly like a wrong key, which sends people
 * off to regenerate a credential that was never the problem. `doctor` checks
 * for it by name.
 */

export type Config = {
  /** API key. Public half of the credential, sent as a header. */
  apiKey?: string;
  /** API secret. Never sent: it is hashed into the Authorization header. */
  apiSecret?: string;

  readOnly: boolean;
  allowDestructive: boolean;

  requestTimeoutMs: number;
  minRequestIntervalMs: number;
  maxRetries: number;
  cacheTtlMs: number;

  /** Deadline for fetching a transcript or chapter file from a podcaster's host. */
  fileTimeoutMs: number;
  /** Hard cap on a fetched transcript, in characters, before it is truncated. */
  maxTranscriptChars: number;

  apiHost: string;
  userAgent: string;
  auditPath?: string;
};

export const DEFAULT_API_HOST = "https://api.podcastindex.org/api/1.0";

/**
 * Podcast Index requires a User-Agent that identifies the caller and says so in
 * its own docs. A default that named no product would be technically compliant
 * and practically rude, so this names the server and lets anyone embedding it
 * say who they really are.
 */
export const DEFAULT_USER_AGENT = "podcastindex-mcp/0.1.0";

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    process.stderr.write(
      `[podcastindex-mcp] ${name}="${raw}" is not a positive number. Using ${fallback}.\n`,
    );
    return fallback;
  }
  return n;
}

function normalizeHost(raw: string | undefined, fallback: string): string {
  const t = (raw ?? "").trim();
  if (!t) return fallback;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  return withScheme.replace(/\/+$/, "");
}

export function loadConfig(): Config {
  return {
    apiKey: process.env.PODCASTINDEX_API_KEY?.trim() || undefined,
    apiSecret: process.env.PODCASTINDEX_API_SECRET?.trim() || undefined,

    readOnly: envFlag("PODCASTINDEX_READ_ONLY", false),
    allowDestructive: envFlag("PODCASTINDEX_ALLOW_DESTRUCTIVE", true),

    requestTimeoutMs: envInt("PODCASTINDEX_REQUEST_TIMEOUT_MS", 30_000),
    minRequestIntervalMs: envInt("PODCASTINDEX_MIN_REQUEST_INTERVAL_MS", 120),
    maxRetries: envInt("PODCASTINDEX_MAX_RETRIES", 3),
    cacheTtlMs: envInt("PODCASTINDEX_CACHE_TTL_MS", 300_000),

    // A podcaster's own host is slower and flakier than Podcast Index, and a
    // transcript is a bigger download than a JSON response, so it gets its own
    // longer deadline rather than inheriting the API one.
    fileTimeoutMs: envInt("PODCASTINDEX_FILE_TIMEOUT_MS", 45_000),
    // A two hour episode transcribes to roughly 120k characters. Returning that
    // whole thing costs more context than any single answer is worth, so tools
    // that read one paginate over this rather than dumping it.
    maxTranscriptChars: envInt("PODCASTINDEX_MAX_TRANSCRIPT_CHARS", 24_000),

    apiHost: normalizeHost(process.env.PODCASTINDEX_API_HOST, DEFAULT_API_HOST),
    userAgent: process.env.PODCASTINDEX_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
    auditPath: process.env.PODCASTINDEX_AUDIT_LOG || undefined,
  };
}

/** True when both halves of the credential are present. One alone cannot sign. */
export function hasCredentials(config: Config): boolean {
  return Boolean(config.apiKey && config.apiSecret);
}
