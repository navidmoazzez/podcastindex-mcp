#!/usr/bin/env node
/**
 * Entry point.
 *
 * `podcastindex-mcp`          stdio, which is what MCP clients launch
 * `podcastindex-mcp doctor`   check the setup and say what is wrong
 * `podcastindex-mcp --http`   HTTP, for running it somewhere always on
 * `podcastindex-cli <tool>`   the same tools, from a shell
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, VERSION } from "./server.js";
import { loadConfig } from "./config.js";
import { httpOptionsFromEnv, startHttpServer } from "./transport/http.js";
import { runCli, isCliCommand } from "./cli.js";

const HELP = `podcastindex-mcp ${VERSION}

  podcastindex-mcp                     Run over stdio. This is what an MCP client launches.
  podcastindex-mcp doctor              Check the setup and report what is wrong.
  podcastindex-mcp --http [--port=N]   Run over HTTP, for a machine that is always on.
  podcastindex-mcp --version           Print the version.
  podcastindex-cli                     List every tool as a shell command.
  podcastindex-cli <command> --help    What one command takes.

Credentials, from https://api.podcastindex.org/signup. Both halves are needed:
the key identifies you and the secret signs each request.

  PODCASTINDEX_API_KEY              your API key
  PODCASTINDEX_API_SECRET           your API secret

Options:
  PODCASTINDEX_USER_AGENT           identify your product to Podcast Index
  PODCASTINDEX_READ_ONLY=1          hide the three tools that write
  PODCASTINDEX_ALLOW_DESTRUCTIVE=0  keep notify_feed_update, block the two submits
  PODCASTINDEX_AUDIT_LOG            append-only log of every attempted write
  PODCASTINDEX_MAX_TRANSCRIPT_CHARS how much transcript one call returns, default 24000
  PODCASTINDEX_CACHE_TTL_MS         how long a response stays reusable, default 300000
  PODCASTINDEX_REQUEST_TIMEOUT_MS   per-request deadline, default 30000
  PODCASTINDEX_FILE_TIMEOUT_MS      deadline for a transcript file, default 45000
  PODCASTINDEX_MIN_REQUEST_INTERVAL_MS  spacing between requests, default 120
  PODCASTINDEX_MAX_RETRIES          retries on rate limits and 5xx, default 3
  PODCASTINDEX_HTTP_PORT / _HOST / _TOKEN  for --http

If every call fails with an authentication error, check the clock before the
credentials. Requests are signed with a timestamp and the window is three
minutes. Run doctor, which measures it.

https://github.com/thenavidm/podcastindex-mcp
`;

/**
 * One entry point, two programs. `podcastindex-mcp` is the server and must stay
 * silent on stdout; `podcastindex-cli` is the one a person types. Running the
 * CLI binary with no arguments is someone asking what they can type, so it
 * lists the commands rather than hanging on a transport that will never speak.
 */
function invokedAsCli(): boolean {
  const name = (process.argv[1] ?? "").split("/").pop() ?? "";
  return name.startsWith("podcastindex-cli");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (invokedAsCli() && argv.length === 0) {
    process.exitCode = await runCli(["tools"]);
    return;
  }

  // Checked before --help and --version so `<tool> --help` reaches the tool.
  // A bare `--help` starts with a dash, so it falls through to the block below.
  if (isCliCommand(argv)) {
    process.exitCode = await runCli(argv);
    return;
  }

  // An unknown word used to fall through and start the server, which then sat
  // waiting on stdin: a typo looked like a hang, and scripts saw exit code 0.
  // `doctor` and `help` are the entry point's own words and still reach it.
  const OWN_COMMANDS = new Set(["doctor", "help"]);
  if (invokedAsCli() && command !== undefined && !command.startsWith("-") && !OWN_COMMANDS.has(command)) {
    process.stderr.write(
      `${JSON.stringify({ error: `Unknown command '${command}'. Run \`podcastindex-cli\` to list them.` }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (argv.includes("--help") || argv.includes("-h") || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === "doctor") {
    const { runDoctor } = await import("./doctor.js");
    process.exitCode = await runDoctor();
    return;
  }

  const config = loadConfig();
  const built = buildServer(config);

  const shutdown = async (close?: () => Promise<void>): Promise<void> => {
    if (close) await close().catch(() => undefined);
    process.exit(0);
  };

  if (argv.includes("--http")) {
    const { close } = await startHttpServer(built, httpOptionsFromEnv(argv));
    process.on("SIGTERM", () => void shutdown(close));
    process.on("SIGINT", () => void shutdown(close));
    return;
  }

  const transport = new StdioServerTransport();
  await built.server.connect(transport);

  // Handled so `docker stop` and a client shutting down return promptly rather
  // than waiting out a grace period.
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((error: unknown) => {
  process.stderr.write(`[podcastindex-mcp] ${(error as Error).message}\n`);
  process.exit(1);
});
