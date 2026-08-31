/**
 * Shared plumbing every tool uses.
 *
 * Registering forty tools by hand is forty chances to forget an annotation,
 * leak a stack trace, or return a shape a model cannot read. This wraps all of
 * it once, so a tool module only describes what it actually does.
 *
 * The piece of real logic here is `resolveFeed`. Podcast Index identifies a
 * show four different ways and has a different endpoint for each, while a
 * person asking a question has whichever one they happened to find: a feed URL
 * from their host, an Apple link they copied, a numeric id from an earlier
 * result. Four near-identical tools would push that bookkeeping onto the model,
 * which then has to know that an Apple Podcasts URL contains an iTunes id. One
 * tool that recognises all four is the difference between a working call and a
 * plausible guess at the wrong endpoint.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { PodcastIndexError, NotFoundError } from "../api/errors.js";
import type { PodcastIndexClient } from "../api/client.js";
import type { HttpClient } from "../api/http.js";
import type { Config } from "../config.js";
import { annotationsFor, type Risk, type Surface, type WriteGuard } from "../safety.js";
import type { Feed } from "../api/types.js";

export type ToolContext = {
  api: PodcastIndexClient;
  http: HttpClient;
  config: Config;
  guard: WriteGuard;
};

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function ok(data: unknown): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/**
 * Errors come back as a normal result with `isError`, not a thrown exception.
 *
 * A thrown MCP error reaches the model as a protocol failure with no structure.
 * A result it can read tells it what went wrong and usually how to fix it,
 * which is the difference between a correct retry and a give-up. Every message
 * in `api/errors.ts` is written on that assumption, and throwing here would
 * throw all of them away.
 */
export function fail(error: unknown): ToolResult {
  const payload =
    error instanceof PodcastIndexError
      ? error.toJSON()
      : { error: (error as Error)?.message ?? String(error) };
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: true };
}

/** The argument that names a show, in every shape someone might have one. */
export const showArg = {
  show: z
    .string()
    .describe(
      "The show, in whichever form you have. Any of: a Podcast Index feed id (920666), an RSS feed URL, a podcast GUID, an Apple Podcasts URL, or a bare iTunes id. The form is detected, so pass what you have rather than converting it.",
    ),
};

export const confirmArg = {
  confirm: z
    .boolean()
    .optional()
    .describe(
      "Must be true for this to run. It adds a feed to a public directory that many podcast apps read, and this API has no way to remove it afterwards.",
    ),
};

export const maxArg = (fallback: number, note = "") => ({
  max: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe(`How many to return. Defaults to ${fallback}.${note ? ` ${note}` : ""}`),
});

export const sinceArg = {
  since: z
    .number()
    .int()
    .optional()
    .describe(
      "Only include things published after this time, as a unix timestamp in seconds. A negative number is read as seconds before now, so -604800 means the last week.",
    ),
};

/** What kind of identifier a caller handed us. */
export type ShowRef =
  | { kind: "feedId"; value: number }
  | { kind: "feedUrl"; value: string }
  | { kind: "guid"; value: string }
  | { kind: "itunesId"; value: number };

/**
 * Work out which of the four identifiers a string is.
 *
 * Order matters. A URL is checked before a bare number because an Apple
 * Podcasts URL contains a numeric id, and a GUID before a feed id because a
 * podcast GUID is a UUID and would otherwise fall through to the URL branch.
 */
export function classifyShow(raw: string): ShowRef {
  const input = raw.trim();

  if (/^\d+$/.test(input)) return { kind: "feedId", value: Number(input) };

  // Apple Podcasts links end in /id1234567890, sometimes with a query string.
  const apple = input.match(/podcasts\.apple\.com\/.*\/id(\d+)/i);
  if (apple?.[1]) return { kind: "itunesId", value: Number(apple[1]) };

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) {
    return { kind: "guid", value: input };
  }

  if (/^https?:\/\//i.test(input)) return { kind: "feedUrl", value: input };

  throw new PodcastIndexError(
    `"${raw}" is not a show identifier this understands. Pass a Podcast Index feed id, an RSS feed URL, a podcast GUID, or an Apple Podcasts URL. If you only have a name, call search_podcasts first.`,
    0,
    "show",
  );
}

/**
 * Fetch a feed from whichever identifier the caller had.
 *
 * The single-feed endpoints answer a miss with 200 and an empty `feed`, not a
 * 404, so an absent show has to be detected here rather than surfacing as an
 * empty object that reads like a real result.
 */
export async function resolveFeed(api: PodcastIndexClient, raw: string): Promise<Feed> {
  const ref = classifyShow(raw);

  const response =
    ref.kind === "feedId"
      ? await api.podcastByFeedId(ref.value)
      : ref.kind === "feedUrl"
        ? await api.podcastByFeedUrl(ref.value)
        : ref.kind === "guid"
          ? await api.podcastByGuid(ref.value)
          : await api.podcastByItunesId(ref.value);

  const feed = Array.isArray(response.feed) ? response.feed[0] : response.feed;
  if (!feed || !feed.id) {
    throw new NotFoundError(
      `Podcast Index has no feed for "${raw}" (read as a ${ref.kind}). The index is large but not complete, and a show can be missing entirely. If you have the RSS URL, submit_feed adds it.`,
      "podcasts",
    );
  }
  return feed;
}

/** Turn a negative `since` into an absolute unix timestamp. */
export function normalizeSince(since: number | undefined): number | undefined {
  if (since === undefined) return undefined;
  if (since < 0) return Math.floor(Date.now() / 1000) + since;
  return since;
}

export type ToolSpec<S extends ZodRawShape> = {
  name: string;
  /** One line, imperative. Shown in tool pickers. */
  title: string;
  description: string;
  schema: S;
  risk: Risk;
  surface: Surface;
  /** True when calling twice has the same effect as calling once. */
  idempotent?: boolean;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
  /** One line for the audit log and the confirm message, when this writes. */
  summary?: (args: z.infer<z.ZodObject<S>>) => string;
};

export function defineTool<S extends ZodRawShape>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

/**
 * A tool of any shape, for the one place tools are collected into a list.
 *
 * `ToolSpec` is generic over its schema, so a list of tools with different
 * schemas has no single type: each handler takes a different argument shape and
 * function parameters are contravariant. The type safety that matters lives
 * inside each `defineTool` call, where schema and handler are checked against
 * each other. This only loosens the seam where they are gathered.
 */
export type AnyToolSpec = Omit<ToolSpec<ZodRawShape>, "handler" | "summary"> & {
  handler: (args: never, ctx: ToolContext) => Promise<unknown>;
  summary?: (args: never) => string;
};

/** Register one tool against the server, with guarding and error handling. */
export function register(server: McpServer, ctx: ToolContext, spec: AnyToolSpec): void {
  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.schema,
      annotations: {
        title: spec.title,
        ...annotationsFor(spec.risk, { idempotent: spec.idempotent }),
      },
    },
    // The SDK derives its callback type from the schema generic. This wrapper is
    // generic over the same shape, but TypeScript cannot prove the two equal
    // through the indirection, so the cast lives at this single boundary rather
    // than in every tool definition.
    (async (args: Record<string, unknown>) => {
      try {
        if (spec.risk !== "read") {
          const summary = spec.summary?.(args as never) ?? spec.name;
          const confirm = (args as { confirm?: boolean }).confirm;
          ctx.guard.check(spec.name, spec.risk, confirm, summary);
        }
        return ok(await spec.handler(args as never, ctx));
      } catch (error) {
        return fail(error);
      }
    }) as never,
  );
}

/** Clamp a caller-supplied max into a range the upstream will accept. */
export function clamp(value: number | undefined, fallback: number, max = 1000): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

/** Trim a summary to one readable line for the audit log. */
export function snippet(text: string | undefined, length = 60): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}
