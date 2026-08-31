/**
 * Streamable HTTP, for running the server somewhere always on.
 *
 * stdio is what a desktop client launches. HTTP is what claude.ai needs, since
 * it runs connectors from Anthropic's cloud and cannot execute a local command.
 *
 * **It binds loopback by default and refuses to bind anything else without a
 * token.** A server on 0.0.0.0 with no auth hands anyone who finds it the use
 * of this key, and Podcast Index rate limits per key, so a stranger's traffic
 * becomes the owner's 429s. Requiring the token to leave loopback makes the
 * insecure case a deliberate act rather than a default.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { BuiltServer } from "../server.js";

export type HttpOptions = {
  port: number;
  host: string;
  token?: string;
};

export function httpOptionsFromEnv(argv: string[]): HttpOptions {
  const portArg = argv.find((a) => a.startsWith("--port="))?.split("=")[1];
  const hostArg = argv.find((a) => a.startsWith("--host="))?.split("=")[1];
  return {
    port: Number(portArg ?? process.env.PODCASTINDEX_HTTP_PORT ?? 8000),
    host: hostArg ?? process.env.PODCASTINDEX_HTTP_HOST ?? "127.0.0.1",
    token: process.env.PODCASTINDEX_HTTP_TOKEN?.trim() || undefined,
  };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export async function startHttpServer(
  built: BuiltServer,
  options: HttpOptions,
): Promise<{ close: () => Promise<void> }> {
  if (!LOOPBACK.has(options.host) && !options.token) {
    throw new Error(
      `Refusing to listen on ${options.host} without PODCASTINDEX_HTTP_TOKEN. Anything that can reach this port can spend your Podcast Index key, and the rate limit is per key, so a stranger's traffic becomes your 429s. Set a token, or bind 127.0.0.1 and put a reverse proxy in front.`,
    );
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await built.server.connect(transport);

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (options.token) {
      const header = req.headers.authorization ?? "";
      const presented = header.replace(/^Bearer\s+/i, "");
      if (presented !== options.token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, tools: built.toolCount }));
      return;
    }

    void transport.handleRequest(req, res);
  });

  await new Promise<void>((resolve) => http.listen(options.port, options.host, resolve));
  process.stderr.write(
    `[podcastindex-mcp] listening on http://${options.host}:${options.port} with ${built.toolCount} tools${
      options.token ? ", token required" : ""
    }\n`,
  );

  return {
    close: async () => {
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await transport.close().catch(() => undefined);
    },
  };
}
