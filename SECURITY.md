# Security

## Reporting a vulnerability

Email **security@navid.media**. Do not open a public issue for a vulnerability.

## What this server can reach

With the credentials it holds, this server can:

- read anything in the public Podcast Index directory
- fetch transcript and chapter files from arbitrary third-party hosts
- ask the index to recrawl a feed, which needs no credential
- **add a podcast to the public global directory**, with a key that has write
  permission, and that cannot be undone through this API

It cannot delete anything, because the API has no delete. It cannot read
private data, because the index holds none.

The blast radius of a leaked key is your rate limit, plus the ability to add
feeds to a public directory if the key carries write permission.

## Where credentials live

In your MCP client's own config file, as environment variables. This server
reads them at startup and writes them nowhere.

**The secret is never transmitted.** It is hashed locally with your key and a
timestamp, and only the resulting SHA-1 is sent.

The only file this server ever writes is the optional audit log at
`PODCASTINDEX_AUDIT_LOG`, created with mode `0600`, holding one JSON line per
attempted write. There is no tool to read or edit it.

## Deliberately not implemented

- **No credential storage.** Nothing is cached or persisted, so there is no
  secret at rest to steal.
- **No tool reads the audit log.** A record a caller can rewrite is not a record.
- **HTTP transport refuses a non-loopback bind without a token.** Anything that
  can reach an open port can spend your key, and the rate limit is per key, so a
  stranger's traffic becomes your failures.
- **No arbitrary URL fetching tool.** Files are only fetched from URLs the index
  itself published for a specific episode, never from a caller-supplied URL,
  which would make this a general-purpose request proxy.

## Prompt injection

This server reads transcripts, show notes and chapter titles. All of it is text
other people wrote, and transcripts are fetched from hosts nobody vetted.

Anybody who can publish a podcast can put "ignore your previous instructions"
into their own transcript file, at no cost, and "summarise this episode" is the
first thing anyone asks.

Two mitigations, and neither is complete. User-authored text is fenced with a
marker naming it as data, with attempts to close that fence early defanged. The
rule is also stated in the server instructions, so it is in context before the
first tool result arrives.

For an agent working unattended on other people's content, `PODCASTINDEX_READ_ONLY=1`
is the real defence. The fencing helps a model behave; only the missing tools
stop it acting.

## Good-faith research

Read, run and pull apart anything here. Nobody but the maintainer can change
this repository, so nothing you do while investigating puts it at risk.

The care is owed to the service the tool talks to, not to the code. When
testing, use your own account and your own data. Do not point it at somebody
else's, and do not hammer a shared API to the point where other people notice.
If a test could affect anyone but you, stop and send a private report first.

Research done in that spirit is welcome, and nothing here is a trap.
