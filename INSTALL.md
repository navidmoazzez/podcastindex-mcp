# Install

Getting a Podcast Index API key: the long version of section 3 of the README,
every step with what to do when one fails. Two minutes, free, no approval.

## What you are getting

Two values, not one:

| Value | What it does | Example shape |
|---|---|---|
| **API key** | identifies you, travels with every request | `UXKCGDSYGUUEVQJSYDZH` |
| **API secret** | signs every request, never transmitted | a longer string |

Both are required. The key alone cannot authenticate anything, because Podcast
Index does not use bearer tokens: it hashes your key, your secret and the
current timestamp into a signature, and checks the signature.

## Steps

**1.** Go to [api.podcastindex.org/signup](https://api.podcastindex.org/signup).

**2.** Fill in the form. It asks for an email address and a short line about what
you are building. Anything honest is fine.

**3.** The key and secret appear immediately. There is no review queue and no
email confirmation step to wait for.

**4.** Copy both. Put them in your MCP client's config as
`PODCASTINDEX_API_KEY` and `PODCASTINDEX_API_SECRET`.

**5.** Check it:

```bash
npx -y @thenavidm/podcastindex-mcp@latest doctor
```

## Write permission, which you probably do not need

A standard key reads everything. Adding a podcast to the directory is a separate
grant, and 34 of the 36 tools never touch it.

Only `submit_feed` and `submit_feed_by_itunes_id` require it. Without it they
fail with a message saying so, and nothing is submitted.

If you do want it, ask through the contact routes on
[podcastindex.org](https://podcastindex.org). Consider whether you need it: it
is the only permission in this server that can make a permanent change to a
public directory.

## If it does not work

**Check the clock first.** This is the one that wastes an afternoon.

Requests are signed with a unix timestamp and the server accepts a three minute
window either side of its own clock. Outside that, every call fails with a 401,
and a 401 looks exactly like a wrong key. People regenerate a perfectly good
credential and fail again.

`doctor` measures the drift against the server's own clock and tells you. On
macOS the fix is:

```bash
sudo sntp -sS time.apple.com
```

On Linux, enable NTP with `sudo timedatectl set-ntp true`.

**Then check both halves are set.** `doctor` reports each separately and shows
their lengths, which catches a truncated paste.

## Rate limits

Podcast Index does not publish a hard number and is generous in practice. This
server spaces requests out and caches reads for five minutes.

If you do get rate limited, the fix is usually to stop looping. Use
`get_podcasts_batch` for many shows, `get_show_profile` instead of four separate
calls about one show, and `find_transcripts` instead of a transcript lookup per
episode.

## Identifying yourself

Podcast Index asks every client to send a `User-Agent` naming the product. This
server sends its own name by default. If you are embedding it in something,
set `PODCASTINDEX_USER_AGENT` to your product and version.

It is a courtesy that costs nothing, and an absent User-Agent is answered with a
401 that looks like an auth failure.
