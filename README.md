<div align="center">
  <img src="https://cdn.navid.media/connectors/podcastindex-icon.png" alt="Podcast Index" width="88">
</div>

# Podcast Index MCP

[![License](https://img.shields.io/badge/License-MIT-blue)](./LICENSE)
[![YouTube](https://img.shields.io/badge/YouTube-@thenavidm-red?logo=youtube&logoColor=white)](https://youtube.com/@thenavidm?sub_confirmation=1)
[![X](https://img.shields.io/badge/X-@thenavidm-black?logo=x)](https://x.com/thenavidm)

The open podcast directory for Claude, Cursor, and any other AI agent.

It searches four million podcasts, and then it does the thing the API stops
short of: it opens the transcript. Podcast Index hands out a link to an
episode's transcript file and goes no further, which is useless to an assistant
that cannot click. This fetches the file, works out whether it is SRT, WebVTT,
JSON or HTML, and gives you the actual words with timestamps and speakers.

So you can ask when something was said, and get an answer.

There are 36 tools. One free key covers all but two of them.

Built by [Navid Moazzez](https://navid.me).

```
You: on that Lex Fridman episode with Carmack, when do they get into VR latency?

Claude: Found it. Episode 309, transcript is a 3-hour VTT.

  Three places, and only one is the real discussion:

    1:47:12  Carmack  "the latency problem is not a rendering problem,
                       it is a scheduling problem", this is the one,
                       runs about 20 minutes
    0:38:40  Carmack  passing mention, comparing it to the Quest port
    2:51:03  Lex      callback in the wrap-up

  The 1:47 section is where he lays out the whole argument. Want the
  transcript from there?
```

## Contents

| | Section | |
|---|---|---|
| 1 | [What you can ask it](#1-what-you-can-ask-it-) | Real prompts, not features |
| 2 | [Quick install](#2-quick-install-) | One line |
| 3 | [Setup](#3-setup-) | Getting a key, about two minutes |
| 4 | [Connect your client](#4-connect-your-client-) | Every client, copy and paste |
| 5 | [Check it worked](#5-check-it-worked-) | `doctor`, and what actually fails |
| 6 | [Tools](#6-tools-) | All 36, grouped by what they reach |
| 7 | [What Podcast Index actually does](#7-what-podcast-index-actually-does-) | The traps, learned the hard way |
| 8 | [Your data](#8-your-data-) | What is sent, and what never is |
| 9 | [Writing safely](#9-writing-safely-) | Short, because almost nothing writes |
| 10 | [Troubleshooting](#10-troubleshooting-) | Symptom to cause |
| 11 | [FAQ](#11-faq-) | Including what an MCP server is |

---

## 1. What you can ask it 💬

- When did they talk about pricing on that episode, and what did they say?
- Read me this episode and pull out the three claims worth remembering.
- Where has this person been a guest, and what do they always get asked?
- Find me fifteen podcasts about indie games that are still publishing, and skip the dead ones.
- Is my feed broken? Downloads dropped last week and I do not know why.
- What is trending in true crime this week, in Swedish?
- Which of this show's episodes actually have transcripts?
- Who does this podcast split its listener payments with?
- Give me the chapter list so I can see if this episode is worth two hours.
- Tell me everything about this show in one go: cadence, guests, health, the lot.

The first one is the point. Podcast Index will tell you a transcript exists and
give you a URL. No podcast tool reads it back to you. This one does, which is
why "when did they say that" is a question you can now ask.

## 2. Quick install ⚡

Node 20 or newer. Nothing else.

> **Not on npm yet.**
> The install lines below are what this will look like once the package ships.
> Until then, clone the repo and point your client at `dist/index.js` after
> running `npm install && npm run build`.

```bash
npx -y @thenavidm/podcastindex-mcp@latest --version
```

That is the whole install. `npx` fetches it on demand, so there is nothing to
update later.

## 3. Setup 🔑

You need a key **and** a secret. Both. The key says who you are and the secret
signs each request, so one without the other cannot authenticate. They are free,
there is no approval step, and it takes about two minutes.

### Have an agent do it

The agent cannot sign up for you. What it can do is wire up the config once you
have the credentials and verify the connection.

Paste this into Claude Code, Cursor, or any agent with terminal access:

```
Set up the Podcast Index MCP server for me.

1. Open https://api.podcastindex.org/signup and tell me to fill it in. Wait for me.
2. When I paste the key and secret back, add the server to my client config
   with PODCASTINDEX_API_KEY and PODCASTINDEX_API_SECRET set.
3. Run the doctor command and tell me what it says.
4. If the clock check fails, tell me how to fix the clock. Do not tell me to
   regenerate the key.
```

### Or do it yourself

**Step 1.** Go to [api.podcastindex.org/signup](https://api.podcastindex.org/signup).

**Step 2.** Fill in the form. You need an email address and a line about what
you are building. There is no review and no waiting: the credentials appear
immediately.

**Step 3.** Copy both values. The key is short and looks like `UXKCGDSYGUUEVQJSYDZH`.
The secret is longer. Keep the secret private: anything holding it can spend
your rate limit.

That is it. Everything except adding a podcast to the directory works now.

> **You do not need write permission.**
> Write access is a separate grant, and 34 of the 36 tools do not use it. Only
> `submit_feed` and `submit_feed_by_itunes_id` need it, and they say so if you
> call them without it. Skip this unless you actually want to add feeds to the
> public directory.

To revoke a key, contact Podcast Index through the support links on
[podcastindex.org](https://podcastindex.org).

## 4. Connect your client 🔌

### Claude Code

```bash
claude mcp add podcastindex \
  -e PODCASTINDEX_API_KEY=your_key \
  -e PODCASTINDEX_API_SECRET=your_secret \
  -- npx -y @thenavidm/podcastindex-mcp@latest
```

Add `--scope user` to make it available in every project rather than the
current one.

### Claude Desktop

| Platform | Config path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "podcastindex": {
      "command": "npx",
      "args": ["-y", "@thenavidm/podcastindex-mcp@latest"],
      "env": {
        "PODCASTINDEX_API_KEY": "your_key",
        "PODCASTINDEX_API_SECRET": "your_secret"
      }
    }
  }
}
```

> **Tip**
> Claude Desktop does not inherit your shell PATH, so a bare `npx` can fail with
> "command not found". Use the absolute path from `which npx` if it does.

Quit Claude Desktop completely and reopen it.

### claude.ai on the web

claude.ai runs connectors from Anthropic's cloud, not from your machine, so it
needs a public HTTPS URL rather than a local command.

```bash
npx -y @thenavidm/podcastindex-mcp@latest --http --port 8000
```

Host that somewhere with a public HTTPS URL and set `PODCASTINDEX_HTTP_TOKEN`,
which the server requires before it will bind anything but loopback. Then in
claude.ai: **Customize**, **Connectors**, **+**, **Add custom connector**, paste
the URL, **Add**.

On Team and Enterprise an owner adds it first under **Organization settings**,
**Connectors**, then each member enables it.

### Cursor

`.cursor/mcp.json`, same JSON shape as Claude Desktop, key `mcpServers`.

### Windsurf

`~/.codeium/windsurf/mcp_config.json`, key `mcpServers`.

### VS Code

`.vscode/mcp.json`. The key is **`servers`**, not `mcpServers`, and each entry
needs `"type": "stdio"`.

```json
{
  "servers": {
    "podcastindex": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@thenavidm/podcastindex-mcp@latest"],
      "env": {
        "PODCASTINDEX_API_KEY": "your_key",
        "PODCASTINDEX_API_SECRET": "your_secret"
      }
    }
  }
}
```

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.podcastindex]
command = "npx"
args = ["-y", "@thenavidm/podcastindex-mcp@latest"]

[mcp_servers.podcastindex.env]
PODCASTINDEX_API_KEY = "your_key"
PODCASTINDEX_API_SECRET = "your_secret"
```

### Gemini CLI

`~/.gemini/settings.json`, key `mcpServers`, same shape as Claude Desktop.

### Everything else

Any stdio MCP client takes the same three things: the command `npx`, the args,
and the env block.

## 5. Check it worked 🩺

```bash
npx -y @thenavidm/podcastindex-mcp@latest doctor
```

```
podcastindex-mcp doctor

  ok   Node version       v22.14.0
  ok   API key            set, 20 characters
  ok   API secret         set, 40 characters
  ok   Podcast Index API  reachable and authenticated, 4,312,880 feeds indexed
  ok   Clock sync         2 seconds ahead, well inside the 180 second signing window
  ok   Tools registered   36, including 3 that write

Everything checks out.
```

The clock line is the one to read. See below for why.

## 6. Tools 🛠️

### Reading what is actually in an episode

The group worth installing this for. These leave Podcast Index and fetch files
from the publisher's own host.

| Tool | What it does |
|---|---|
| `get_transcript` | Fetches and parses the transcript into timestamped text with speakers |
| `search_transcript` | Finds the moment a phrase was said, with a timestamp |
| `get_chapters` | The publisher's own table of contents, sponsor breaks included and labelled |
| `get_soundbites` | The clips the publisher marked as the best moments |
| `find_transcripts` | Which of a show's episodes have transcripts, in one request |

### Questions instead of endpoints

| Tool | What it does |
|---|---|
| `get_show_profile` | One call for cadence, guests, health, Podcasting 2.0 coverage and payments |
| `find_guest_appearances` | Every episode a person is credited on, grouped by show |
| `find_shows_to_pitch` | Shows on a topic that are alive, publishing, and worth approaching |

### Search

| Tool | What it does |
|---|---|
| `search_podcasts` | Keyword search across title, author and owner |
| `search_podcasts_by_title` | Title only, for when you know the name |
| `search_episodes_by_person` | Episodes crediting a named person |
| `search_music` | Music feeds, which are a separate medium here |

### Shows and episodes

| Tool | What it does |
|---|---|
| `get_podcast` | One show, from any identifier you happen to have |
| `get_podcasts_batch` | Up to 500 shows in a single request |
| `get_podcasts_by_medium` | Browse audiobooks, film, video, courses, newsletters |
| `list_categories` | Every category and its id |
| `get_episodes` | A show's episodes, newest first |
| `get_episode` | One episode in full |
| `get_live_episodes` | Podcasts broadcasting right now |
| `get_random_episodes` | Random sampling, filterable by category |
| `get_recent_episodes` | The firehose of everything just published |

### What is new and what is moving

| Tool | What it does |
|---|---|
| `get_trending` | Trending shows, filterable by category and language |
| `get_recent_feeds` | Feeds that just published |
| `get_new_feeds` | Shows new to the index |
| `get_recent_soundbites` | The newest publisher-picked highlights |

### Value for value

| Tool | What it does |
|---|---|
| `get_value_block` | A show's payment split, with computed shares |
| `get_episode_value` | One episode's split, which can differ from the show's |
| `list_value_podcasts` | Every feed that takes listener payments |
| `get_new_value_feeds` | Shows that just added a payment split |

### Health and size

| Tool | What it does |
|---|---|
| `check_feed_health` | Crawl errors, parse errors, last good fetch, and a verdict |
| `list_dead_feeds` | Feeds the index gave up on |
| `get_index_stats` | How big the index is and how much of it is alive |
| `status` | What this server can currently reach |

### Writes

| Tool | Needs |
|---|---|
| `notify_feed_update` | nothing, not even a key |
| `submit_feed` | `confirm: true`, and a key with write permission |
| `submit_feed_by_itunes_id` | `confirm: true`, and a key with write permission |

## 7. What Podcast Index actually does 🧭

The things that will surprise you, and the reasons this server is shaped the
way it is.

### A wrong clock looks exactly like a wrong key

This is the one that costs people an hour.

Every request is signed with a SHA-1 of your key, your secret and the current
unix timestamp, and Podcast Index accepts a **three minute window** either side
of its own clock. A laptop that slept through a timezone change, a container
with no time sync, or a VM restored from a snapshot will fail every single call
with a 401.

A 401 reads as "bad credentials" to everybody, so the natural response is to
regenerate a key that was never the problem.

`doctor` measures the drift against the server's own clock and says so. If it
reports skew, fix the clock, not the credentials. On macOS:

```bash
sudo sntp -sS time.apple.com
```

### Podcasting 2.0 tags are optional, and mostly absent

| Tag | What it gives you | How common |
|---|---|---|
| `transcript` | a URL to SRT, VTT, JSON or HTML | uncommon |
| `chapters` | a URL to a chapters JSON file | uncommon |
| `person` | credited hosts, guests, producers | uncommon |
| `soundbite` | publisher-chosen highlight clips | rare |
| `value` | a payment split for listener payments | a small minority |

An empty result is a fact about that show, not a broken call. Nothing here can
transcribe audio that was never transcribed, and retrying will not help.

This matters most for guest research. `find_guest_appearances` only sees shows
that publish person tags, so a thin result is a floor on somebody's appearances
and never a complete list.

### Transcript files lie about their format

The feed declares a mime type and publishers get it wrong constantly: SRT served
as `text/plain`, VTT declared `application/json`, JSON with an `.srt` extension.

So this server detects the format from the file body and treats the declaration
as a hint. Trusting it would fail on a large minority of real shows.

Where a publisher offers several formats, JSON is preferred, because **only the
Podcasting 2.0 JSON format carries real speaker names**. The same episode as SRT
is usually an undifferentiated wall of text. Some SRT and VTT does carry
speakers, as a `NAME:` prefix or a `<v Name>` span, and those are parsed out.

### The transcript is not on Podcast Index

`transcriptUrl` and `chaptersUrl` point at files on the **publisher's own
server**. So those tools fail for reasons that have nothing to do with the
index: dead links, moved files, HTML error pages, hosts that time out.

When a transcript fetch fails, the podcaster's hosting is down. The index is
fine and the call was correct.

### A value block is not revenue

It says a show is configured to receive listener payments and names the wallets
and their weights. It says nothing about whether anyone has ever paid.

Splits are **relative weights, not percentages**. A block of 90 and 10 is the
same split as one of 9 and 1, so this server shows the computed share alongside
the raw number.

### Descriptions get silently truncated

Without the `fulltext` flag the API cuts every text field to 100 characters, and
a description cut at 100 characters still looks like a description. A model
reading one would summarise a show from its first sentence and never know the
rest existed.

This server sets `fulltext` on every call that accepts it. You will not hit this,
but it is why responses are larger than the raw API's.

### An episode GUID is not unique

It is unique only inside its own feed. Look one up without saying which show,
and the API answers with whichever it finds first, which is a coin flip. Pass
`show` alongside `guid` on `get_episode`.

Feed ids and episode ids are different numbers. A feed id will not work where an
episode id is wanted.

### Adding a feed cannot be undone

`submit_feed` writes to a public global directory that hundreds of apps read,
and **this API has no delete**. Removing something means asking the people who
run Podcast Index.

That is why those two tools need `confirm: true` and `notify_feed_update` does
not.

## 8. Your data 📦

There is no backend. Nothing is collected, and nothing is sent anywhere except
the two places below.

| Goes to | What |
|---|---|
| `api.podcastindex.org` | your key, a timestamp, a signature, and your query |
| the publisher's host | a plain GET for a transcript or chapter file, no credentials |

**Your secret is never transmitted.** It is hashed into a signature locally and
the hash is what travels.

Credentials live wherever your MCP client keeps its config, which is a plain
JSON or TOML file on your own machine. This server writes nothing to disk unless
you set `PODCASTINDEX_AUDIT_LOG`, and then only a line per attempted write.

Everything Podcast Index holds is public. There is no personal listening data
here to leak, because the index does not have any.

## 9. Writing safely 🔒

Of 36 tools, 33 only read.

`notify_feed_update` asks the index to recrawl a feed sooner. It is idempotent,
needs no credential, and is not guarded, because guarding harmless things trains
the habit that makes real guards useless.

`submit_feed` and `submit_feed_by_itunes_id` add a podcast to a public directory
and cannot be undone through this API. Both require `confirm: true`.

| Variable | Effect |
|---|---|
| `PODCASTINDEX_READ_ONLY=1` | the three write tools are not registered at all |
| `PODCASTINDEX_ALLOW_DESTRUCTIVE=0` | keeps the recrawl ping, blocks the two submits |
| `PODCASTINDEX_AUDIT_LOG=<path>` | one JSON line per attempted write, allowed and blocked |

Read-only removes the tools rather than erroring on them, because a model cannot
call a tool it cannot see, and an error is an invitation to retry differently.

**On prompt injection.** Transcripts, show notes and chapter titles are text
strangers wrote, fetched from hosts nobody vetted, and anybody who can publish a
podcast can put "ignore your instructions" into their own transcript. This
server fences that text as data before a model reads it, and says so in its
instructions.

That helps. It is not a guarantee. For an agent working unattended,
`PODCASTINDEX_READ_ONLY=1` is the real defence.

## 10. Troubleshooting 🔧

Run `doctor` first. It tests every credential and measures the clock.

| Symptom | Cause |
|---|---|
| Every call fails with an auth error | Check the clock before the key. Three minute signing window, and drift is the most common cause |
| `doctor` says the secret is not set | Both halves are needed. The key alone cannot sign a request |
| A submit fails with a permission error | Write access is granted separately from a normal key |
| `get_transcript` says the show publishes none | Most shows do not. This is a fact about the show, not a failure |
| A transcript times out | The publisher's host, not the index. Raise `PODCASTINDEX_FILE_TIMEOUT_MS` |
| Transcript comes back with no speakers | The publisher supplied SRT without labels. Only the JSON format guarantees speakers |
| `find_guest_appearances` returns nothing | Only shows publishing person tags are visible, which is a minority |
| Rate limited | Use `get_podcasts_batch` and `get_show_profile` instead of loops of single calls |
| Claude Desktop cannot find `npx` | It does not inherit your shell PATH. Use the absolute path from `which npx` |

## 11. FAQ ❓

<details>
<summary><b>What is an MCP server?</b></summary>

A standard way to give an AI assistant real access to a tool, so it can act
rather than guess. You install it once, your assistant gains the tools, and it
works in Claude, Cursor, and anything else that speaks MCP.

Without one, an assistant asked about a podcast answers from whatever it
absorbed in training. With one, it goes and looks.

</details>

<details>
<summary><b>What is Podcast Index?</b></summary>

An open, free directory of podcasts. Around four million feeds, run
independently of Apple and Spotify, with an API anybody can use.

It is also where Podcasting 2.0 lives: an open extension to RSS that lets
publishers attach transcripts, chapters, guest credits, highlight clips and
payment details to their episodes. That extra data is most of why this server
is interesting.

</details>

<details>
<summary><b>Do I need to be technical to use this?</b></summary>

You need to paste a block of JSON into a config file and sign up for a free key.
That is the whole technical bar. Step 3 walks through it, and you can hand the
prompt in that section to an agent and let it do the wiring.

</details>

<details>
<summary><b>Is my data sent anywhere? Who can see it?</b></summary>

There is no backend and no telemetry. Your queries go to Podcast Index, and
transcript fetches go to the publisher's own server. That is all.

Your API secret never leaves your machine. It is used to compute a signature
locally, and only the signature is sent.

</details>

<details>
<summary><b>What can it do that I cannot do on the website already?</b></summary>

Read transcripts. The Podcast Index website will show you that an episode has a
transcript and link to the file. It will not search inside it, and it will not
search across episodes.

The other one is scale. "Find every episode this person has been on, grouped by
show" is one call here and an afternoon by hand.

</details>

<details>
<summary><b>Can it delete something by accident?</b></summary>

No. Nothing here deletes anything, because the API has no delete.

The action worth knowing about is the opposite: `submit_feed` adds a podcast to
a public directory permanently, and there is no way to remove it through this
API. It requires `confirm: true` for exactly that reason, and it needs a key
with write permission that you will not have unless you asked for one.

</details>

<details>
<summary><b>Does it cost anything?</b></summary>

No. The server is MIT licensed and a Podcast Index API key is free with no
approval step and no paid tier.

</details>

<details>
<summary><b>Does it work with ChatGPT or Cursor, or only Claude?</b></summary>

Any client that speaks MCP. Section 4 covers Claude Code, Claude Desktop,
claude.ai, Cursor, Windsurf, VS Code, Codex CLI and Gemini CLI.

claude.ai is the one that works differently, because it runs connectors from
Anthropic's cloud and needs the HTTP transport rather than a local command.

</details>

<details>
<summary><b>Why do I need two values instead of one API key?</b></summary>

Podcast Index signs every request rather than using a bearer token. The key
identifies you and travels with the request; the secret is hashed together with
a timestamp to prove the request is yours and is recent.

The upside is the secret is never transmitted. The downside is the timestamp
has a three minute window, so a drifting clock breaks everything. `doctor`
checks for it.

</details>

<details>
<summary><b>Why does an episode have no transcript?</b></summary>

Because the publisher did not attach one. Transcripts in podcasting are an
optional RSS tag, and most shows do not use it.

Nothing here transcribes audio. If a show publishes no transcript,
`get_transcript` cannot produce one, and it will say so rather than guessing at
the content from the show notes.

</details>

<details>
<summary><b>How do I disconnect it?</b></summary>

Remove the entry from your client's config and restart the client. There is
nothing installed globally to uninstall, since `npx` fetches it per run, and
nothing on disk to clean up unless you configured an audit log.

</details>

## About the author 👋

Navid Moazzez is a leading AI business strategist. He helps creators and founders master AI and build their own AI Operating System (AI OS) to automate their business and life. This Podcast Index MCP server is one piece of that system.

**Links**

- Personal website: [navid.me](https://navid.me)
- Navid Media: [navid.media](https://navid.media)
- YouTube: [@thenavidm](https://youtube.com/@thenavidm?sub_confirmation=1) and [@thenavidai](https://youtube.com/@thenavidai?sub_confirmation=1)
- X: [@thenavidm](https://x.com/thenavidm)
- Instagram: [@thenavidm](https://instagram.com/thenavidm)
- LinkedIn: [thenavidm](https://linkedin.com/in/thenavidm)

## Dependencies

| Package | Licence | Why |
|---|---|---|
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | The MCP protocol itself |
| [zod](https://github.com/colinhacks/zod) | MIT | Tool input schemas |

Data comes from [Podcast Index](https://podcastindex.org), which is free and
open. The [Podcasting 2.0 namespace](https://github.com/Podcastindex-org/podcast-namespace)
is what defines the transcript, chapter, person, soundbite and value tags this
server reads.

## License

MIT. See [LICENSE](./LICENSE).

© 2026 NM Media. Made with ❤️ by [Navid Moazzez](https://navid.me).
