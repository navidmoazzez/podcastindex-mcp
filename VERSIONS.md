# Versions

| Component | Version | Checked |
|---|---|---|
| Podcast Index API | 1.0 | 2026-09-01 |
| @modelcontextprotocol/sdk | 1.30.0 | 2026-09-01 |
| zod | 3.x | 2026-09-01 |
| Node | 20+ | 2026-09-01 |

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
