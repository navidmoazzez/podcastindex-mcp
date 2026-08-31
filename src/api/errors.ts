/**
 * Turning a failure into something the caller can act on.
 *
 * Every message here is written for a model that cannot see the code, cannot
 * see the config, and gets exactly one line to decide whether to retry, retry
 * differently, or stop and tell the user something.
 *
 * The case this file exists for is Podcast Index answering 401. That single
 * status covers four completely different problems: no credential configured,
 * a wrong key, a wrong secret, and a machine whose clock has drifted outside
 * the three minute signing window. They are indistinguishable from the response
 * body, and the last one is both the most common in practice and the only one
 * nobody guesses. So the 401 message names all four in the order worth checking
 * and points at `doctor`, rather than saying "unauthorized" and leaving someone
 * to regenerate a key that was fine.
 */

export type ErrorSurface = "index" | "open" | "web";

export class PodcastIndexError extends Error {
  readonly status: number;
  readonly resource: string;
  readonly surface?: ErrorSurface;
  readonly detail?: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    status: number,
    resource: string,
    options: {
      surface?: ErrorSurface;
      detail?: string;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "PodcastIndexError";
    this.status = status;
    this.resource = resource;
    this.surface = options.surface;
    this.detail = options.detail;
    this.retryable = options.retryable ?? false;
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = { error: this.message };
    if (this.status) out.status = this.status;
    if (this.resource) out.resource = this.resource;
    if (this.surface) out.surface = this.surface;
    if (this.detail) out.detail = this.detail;
    return out;
  }
}

export class AuthError extends PodcastIndexError {
  constructor(message: string, resource: string, detail?: string) {
    super(message, 401, resource, { surface: "index", detail, retryable: false });
    this.name = "AuthError";
  }
}

export class MissingCredentialsError extends PodcastIndexError {
  constructor(what: string) {
    super(
      `This tool needs a Podcast Index API key and secret, and ${what}. Both halves are required: the key identifies the caller and the secret signs the request, so one without the other cannot authenticate. Get a pair free at https://api.podcastindex.org/signup, then set PODCASTINDEX_API_KEY and PODCASTINDEX_API_SECRET in the server's env block and restart the client. Run "npx -y @thenavidm/podcastindex-mcp@latest doctor" to check them.`,
      0,
      "config",
      { surface: "index" },
    );
    this.name = "MissingCredentialsError";
  }
}

export class WritePermissionError extends PodcastIndexError {
  constructor(resource: string) {
    super(
      `This key does not have write permission, which Podcast Index grants separately from a normal API key. Adding a feed to the index needs it; everything else in this server does not. Ask for write access at https://podcastindex.org/ or through the Podcast Index developer chat, then try again. Nothing was submitted.`,
      403,
      resource,
      { surface: "index", retryable: false },
    );
    this.name = "WritePermissionError";
  }
}

export class WriteBlockedError extends PodcastIndexError {
  constructor(message: string) {
    super(message, 0, "guard", { retryable: false });
    this.name = "WriteBlockedError";
  }
}

export class NotFoundError extends PodcastIndexError {
  constructor(message: string, resource: string) {
    super(message, 404, resource, { retryable: false });
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends PodcastIndexError {
  constructor(resource: string, retryAfter?: number) {
    super(
      `Podcast Index is rate limiting this key${
        retryAfter ? `. It asked for a ${retryAfter} second pause` : ""
      }. Space the calls out, or prefer the batch and profile tools which answer the same question in one request instead of many.`,
      429,
      resource,
      { surface: "index", retryable: true },
    );
    this.name = "RateLimitError";
  }
}

export class TimeoutError extends PodcastIndexError {
  constructor(message: string, resource: string, surface?: ErrorSurface) {
    super(message, 0, resource, { surface, retryable: true });
    this.name = "TimeoutError";
  }
}

/**
 * Map an HTTP status onto an error whose message says what to do next.
 *
 * The 401 branch is the one that matters. See the note at the top of the file.
 */
export function errorFor(
  status: number,
  resource: string,
  body: string,
  surface: ErrorSurface = "index",
): PodcastIndexError {
  const detail = body.slice(0, 300).trim() || undefined;

  if (status === 401) {
    return new AuthError(
      `Podcast Index rejected the credentials. That single response covers four different causes, in the order worth checking: this machine's clock has drifted more than three minutes from real time, which invalidates the signature on every request and is the most common cause and the least obvious; the secret is wrong or truncated; the key is wrong; or the pair has been revoked. Run "npx -y @thenavidm/podcastindex-mcp@latest doctor", which tests the clock against the server's own time and says which of these it is.`,
      resource,
      detail,
    );
  }

  if (status === 403) return new WritePermissionError(resource);

  if (status === 429) return new RateLimitError(resource);

  if (status === 404) {
    return new NotFoundError(
      `Podcast Index has nothing at ${resource}. For a lookup by id this means the feed is not in the index; for a search it usually means a malformed parameter rather than an empty result, since a search that matches nothing returns 200 with an empty list.`,
      resource,
    );
  }

  if (status >= 500) {
    return new PodcastIndexError(
      `Podcast Index returned ${status} for ${resource}. This is upstream and usually brief.`,
      status,
      resource,
      { surface, detail, retryable: true },
    );
  }

  return new PodcastIndexError(
    `Podcast Index returned ${status} for ${resource}.`,
    status,
    resource,
    { surface, detail },
  );
}

export function isRetryable(error: unknown): boolean {
  return error instanceof PodcastIndexError && error.retryable;
}
