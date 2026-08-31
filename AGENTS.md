# Working on this repo

For someone changing the code. Installation lives in the README.

## Layout

```
src/
  index.ts        entry, arg parsing, transport selection
  server.ts       assembles the server: instructions, tools, resources, prompts
  config.ts       settings from environment
  safety.ts       write gating, annotations, injection fencing
  doctor.ts       the troubleshooting command
  api/
    http.ts       request signing, throttle, retry, cache, file fetching
    client.ts     one typed method per endpoint
    errors.ts     status to actionable message
    types.ts      the shapes the API returns
    transcripts.ts  format detection and parsing
    chapters.ts   the Podcasting 2.0 chapters file
  format/render.ts  shaping output for a model
  tools/          one module per group, grouped by what they reach
  transport/http.ts streamable HTTP
```

## Commands

```bash
npm run verify      typecheck, build, test. Run this before pushing
npm test            vitest, no network, no credentials
npm run typecheck
npm run build
node dist/index.js doctor
```

## Decisions already made

Do not re-derive these.

| | |
|---|---|
| Language | TypeScript, Node 20+, ESM |
| Package | `@thenavidm/podcastindex-mcp` |
| Transport | stdio and streamable HTTP |
| Tests | vitest against a faked fetch, never the network |
| Writes | on by default, `confirm` only on the two irreversible ones |

## Things that will bite you

**Signing.** `signRequest` concatenates key, secret and timestamp in that order
and lower-cases the hex. Any deviation gives a 401 identical to a bad secret.
There is a test pinning it against an independently computed digest. Do not
change it to match an implementation detail.

**Re-sign on every retry.** A backoff can be eight seconds, and the signing
window is three minutes. Signing once per call and retrying with a stale
timestamp would fail intermittently under load, which is the worst kind of bug.

**`fulltext` on everything.** Without it the API truncates text fields to 100
characters and a truncated description still looks like a description. That is a
silent wrong answer, not an error.

**Presence-only parameters.** `?clean=false` still means clean to this API, so
`withParams` drops a false boolean entirely rather than sending it. Do not
"fix" that into sending the value.

**Never cache random.** `randomEpisodes` passes `fresh: true`. Without it,
asking twice returns the same episodes for the whole cache window.

**Empty is not 404.** The single-lookup endpoints answer a miss with 200 and an
empty `feed` or `episode`. `resolveFeed` detects that. New lookup tools need to
do the same or they will return a blank object as though it were a result.

**Transcript format detection sniffs the body.** Publishers mislabel mime types
constantly. The declared type is a hint used only to order the attempts.

**Speaker labels are a heuristic.** `extractLabelledSpeakers` accepts a
candidate on one of four signals, documented in the file. It is deliberately
conservative: inventing a speaker is worse than reporting none, because a reader
cannot tell a fabricated one from a real one.

## Adding a tool

1. Add it to the right module in `src/tools/`, with `defineTool`
2. Write the description for a model that cannot see the code. Say what it
   reaches, what it costs, and what will surprise the caller. The test suite
   enforces a minimum length because a thin description is a real bug
3. Set `risk` honestly. `destructive` means it cannot be undone
4. Export it from the module's array, which `tools/index.ts` already collects
5. Update the tool count in `package.json`, `README.md` and `SKILL.md`

## Verification

GitHub Actions does not run on this account, so `ci.yml` is inert and CI is not
verification. Check locally:

```bash
npm run verify
node dist/index.js doctor
```

Then a real MCP handshake against `dist/index.js`, not just unit tests. A server
can pass every test and still fail to register a tool.

## Writing

No em dashes. Short paragraphs. Comments explain why, never what.

Never name another project or maintainer anywhere in this repo. Never put AI
attribution in a commit.
