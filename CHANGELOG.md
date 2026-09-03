# Versions

| Component | Version | Checked |
|---|---|---|
| Podcast Index API | 1.0 | 2026-09-01 |
| @modelcontextprotocol/sdk | 1.30.0 | 2026-09-01 |
| zod | 3.x | 2026-09-01 |
| zod-to-json-schema | 3.24.x | 2026-09-03 |
| Node | 20+ | 2026-09-01 |

## Unreleased

A second surface. The same 36 tools now run as shell commands.

- `podcastindex-cli` is a second binary onto the same entry point, dispatching
  on the invoked name. `podcastindex-mcp` is unchanged and still silent on
  stdout.
- Commands are generated from `ALL_TOOLS`, not described a second time: every
  flag, placeholder, help line and validation comes from the Zod schema the MCP
  tool already declares, so the two surfaces cannot drift. A tool added tomorrow
  is a command tomorrow.
- `--agent` (compact JSON, no prompts, no colour), `--select` for field
  projection, and exit codes a script can branch on: 2 usage, 3 not found,
  4 auth, 5 API, 7 rate limited, 10 config.
- `podcastindex-cli schema <command>` prints the exact JSON Schema an MCP client
  receives, so parity is checkable rather than asserted.
- `WriteGuard` now knows which surface called it, so a refusal names `--confirm`
  in a terminal and `confirm: true` to a model. `PODCASTINDEX_READ_ONLY=1` hides
  the writes from both surfaces identically.
- `makeContext` in `tools/kit.ts` is now the one place a handler context is
  built. The server used to assemble it inline.
- The `references` folder is gone. Its setup guide is now `INSTALL.md`, which
  the README links to. That folder was never in `files`, so it had shipped to
  nobody.
- README gained a complete environment variable table. Nine of the sixteen
  settings the code reads had never been documented, and two never reached
  `--help`. Both are now asserted by a test.

## 0.1.0

Not yet published to npm.

First build. 36 tools over the Podcast Index API and the Podcasting 2.0 files it
points at.

- Reads transcripts rather than returning a link to one. Fetches the file,
  detects SRT, WebVTT, JSON or HTML from the body rather than trusting the
  declared mime type, and returns timestamped text with speaker labels where the
  file carries them.
- `search_transcript` finds the moment a phrase was said, matching against
  merged paragraphs so a phrase split across two cues still matches.
- Chapters parsed from the Podcasting 2.0 file, keeping publisher-excluded
  chapters labelled rather than dropping them, since those are usually sponsor
  reads and hiding them misrepresents the episode.
- Three workflow tools: `get_show_profile`, `find_guest_appearances`,
  `find_shows_to_pitch`.
- `check_feed_health` turns the index's crawl counters into a verdict.
- Request signing with the clock drift measured from the server's own Date
  header, so `doctor` can distinguish a skewed clock from a bad key. Those are
  indistinguishable from the API response and the clock is the more common cause.
- Writes on by default, `confirm` required only on the two tools that add a
  feed to the public directory, which cannot be undone.
- stdio and streamable HTTP. HTTP refuses a non-loopback bind without a token.
- 70 tests against a faked transport. No network, no credentials.
