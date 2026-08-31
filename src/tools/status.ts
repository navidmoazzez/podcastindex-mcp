/**
 * One call that says what is actually working.
 *
 * Worth a tool of its own rather than leaving a model to discover the state
 * through failures. An MCP client reports a failed call as "the tool errored"
 * and nothing more, so without this the first sign of a missing credential is
 * a model guessing at why a search came back empty.
 */

import { defineTool } from "./kit.js";
import { hasCredentials } from "../config.js";

export const status = defineTool({
  name: "status",
  title: "What this server can currently reach",
  description:
    "Report whether the Podcast Index credentials are configured and working, how far this machine's clock is from the server's, and which tool groups are available. Call this first when anything is failing in a way that looks like a permissions or connectivity problem, rather than inferring the cause from an empty result.",
  schema: {},
  risk: "read",
  surface: "open",
  handler: async (_args, ctx) => {
    const configured = hasCredentials(ctx.config);

    let reachable = false;
    let checkError: string | undefined;
    if (configured) {
      try {
        await ctx.api.stats();
        reachable = true;
      } catch (error) {
        checkError = (error as Error)?.message;
      }
    }

    const skew = ctx.api.clockSkewSeconds;

    return {
      credentials_configured: configured,
      api_reachable: reachable,
      ...(checkError ? { api_error: checkError } : {}),
      clock_skew_seconds: skew ?? null,
      clock_ok: skew === undefined ? null : Math.abs(skew) < 120,
      read_only: ctx.config.readOnly,
      audit_log: ctx.config.auditPath ?? null,
      available: {
        search_and_lookup: configured,
        transcripts_and_chapters: configured,
        value_for_value: configured,
        // pubnotify is the one write that needs no credential at all.
        notify_feed_update: !ctx.config.readOnly,
        submit_feed: configured && !ctx.config.readOnly,
      },
      note: configured
        ? "Submitting a feed additionally needs a key with write permission, which Podcast Index grants separately. There is no way to check that without attempting a submit."
        : "Set PODCASTINDEX_API_KEY and PODCASTINDEX_API_SECRET. Both are needed: the key identifies the caller and the secret signs each request.",
    };
  },
});

export const STATUS_TOOLS = [status];
