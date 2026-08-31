/**
 * The parser, which is the part of this server that does real work.
 *
 * Every case here is a shape that appears in real feeds. The mislabelled ones
 * especially: publishers get the mime type wrong often enough that trusting the
 * declaration would fail on a large minority of shows, so format detection is
 * tested against files that lie about what they are.
 */

import { describe, expect, it } from "vitest";
import {
  detectFormat,
  formatTimestamp,
  mergeCues,
  parseTimestamp,
  parseTranscript,
  searchCues,
} from "../src/api/transcripts.js";
import { parseChapters } from "../src/api/chapters.js";

const SRT = `1
00:00:01,000 --> 00:00:04,000
Alice: Welcome to the show.

2
00:00:04,500 --> 00:00:08,000
Alice: Today we are talking about pricing.

3
00:00:09,000 --> 00:00:12,000
Bob: I have opinions about pricing.
`;

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Alice>Welcome to the show.

00:01:30.000 --> 00:01:34.000
<v Bob>That is a long gap.
`;

const JSON_TRANSCRIPT = JSON.stringify({
  version: "1.0.0",
  segments: [
    { speaker: "Alice", startTime: 1, endTime: 4, body: "Welcome to the show." },
    { speaker: "Bob", startTime: 4.5, endTime: 8, body: "Glad to be here." },
  ],
});

describe("format detection", () => {
  it("detects each format from the body", () => {
    expect(detectFormat(SRT)).toBe("srt");
    expect(detectFormat(VTT)).toBe("vtt");
    expect(detectFormat(JSON_TRANSCRIPT)).toBe("json");
    expect(detectFormat("<p>Just some prose.</p>")).toBe("text");
  });

  it("trusts the body over a wrong declared type, because publishers mislabel", () => {
    expect(detectFormat(SRT, "application/json")).toBe("srt");
    expect(detectFormat(JSON_TRANSCRIPT, "application/x-subrip")).toBe("json");
    expect(detectFormat(VTT, "text/plain")).toBe("vtt");
  });

  it("tells a headerless VTT from an SRT by the decimal separator", () => {
    // The only difference between the two at this point is the comma.
    expect(detectFormat("00:00:01.000 --> 00:00:04.000\nHello")).toBe("vtt");
    expect(detectFormat("00:00:01,000 --> 00:00:04,000\nHello")).toBe("srt");
  });
});

describe("timestamps", () => {
  it("parses both separators and both lengths", () => {
    expect(parseTimestamp("00:00:04,500")).toBeCloseTo(4.5);
    expect(parseTimestamp("00:00:04.500")).toBeCloseTo(4.5);
    expect(parseTimestamp("01:02:03,000")).toBe(3723);
    expect(parseTimestamp("02:03.000")).toBeCloseTo(123);
  });

  it("formats hours only when there are hours", () => {
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });
});

describe("parsing", () => {
  it("pulls NAME: speaker labels out of SRT", () => {
    const parsed = parseTranscript(SRT);
    expect(parsed.format).toBe("srt");
    expect(parsed.speakers).toEqual(["Alice", "Bob"]);
    expect(parsed.cues[0]!.text).toBe("Welcome to the show.");
    expect(parsed.cues[0]!.speaker).toBe("Alice");
  });

  it("pulls speakers out of VTT voice spans", () => {
    const parsed = parseTranscript(VTT);
    expect(parsed.format).toBe("vtt");
    expect(parsed.speakers).toEqual(["Alice", "Bob"]);
    expect(parsed.cues[1]!.start).toBe(90);
  });

  it("reads the Podcasting 2.0 JSON format, speakers included", () => {
    const parsed = parseTranscript(JSON_TRANSCRIPT);
    expect(parsed.format).toBe("json");
    expect(parsed.cues).toHaveLength(2);
    expect(parsed.cues[1]!.speaker).toBe("Bob");
  });

  it("accepts a bare segment array and a `text` key, both of which appear in the wild", () => {
    const parsed = parseTranscript(JSON.stringify([{ startTime: 0, text: "Hello there." }]));
    expect(parsed.cues[0]!.text).toBe("Hello there.");
  });

  it("falls back to prose rather than throwing when JSON is malformed", () => {
    const parsed = parseTranscript('{"segments": [broken', "application/json");
    expect(parsed.cues.length).toBeGreaterThan(0);
  });

  it("reads an HTML transcript as untimed prose rather than refusing it", () => {
    const parsed = parseTranscript("<p>First para.</p>\n\n<p>Second para.</p>");
    expect(parsed.format).toBe("text");
    expect(parsed.untimed).toBe(true);
    expect(parsed.cues.map((c) => c.text)).toContain("First para.");
  });

  it("does not mistake a sentence colon for a speaker label", () => {
    const parsed = parseTranscript(`1
00:00:01,000 --> 00:00:04,000
Anyway: here is the thing I meant to say and it goes on for a while.
`);
    expect(parsed.cues[0]!.speaker).toBeUndefined();
  });
});

describe("merging", () => {
  it("joins consecutive cues from one speaker into a paragraph", () => {
    const merged = mergeCues(parseTranscript(SRT).cues);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.speaker).toBe("Alice");
    expect(merged[0]!.text).toBe("Welcome to the show. Today we are talking about pricing.");
  });

  it("keeps the start time of the first cue in a paragraph", () => {
    const merged = mergeCues(parseTranscript(SRT).cues);
    expect(merged[0]!.start).toBe(1);
  });

  it("breaks a paragraph on a long silence even for the same speaker", () => {
    const merged = mergeCues(parseTranscript(VTT).cues, { gapSeconds: 4 });
    expect(merged).toHaveLength(2);
  });
});

describe("searching", () => {
  it("finds a phrase and returns its timestamp", () => {
    const merged = mergeCues(parseTranscript(SRT).cues);
    const hits = searchCues(merged, "pricing");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.timestamp).toBe("0:01");
  });

  it("matches a phrase that spans two cues, which per-cue search would miss", () => {
    // "show. Today" only exists once the two Alice cues are merged.
    const merged = mergeCues(parseTranscript(SRT).cues);
    expect(searchCues(merged, "show. Today")).toHaveLength(1);
  });

  it("is case-insensitive and returns nothing rather than guessing", () => {
    const merged = mergeCues(parseTranscript(SRT).cues);
    expect(searchCues(merged, "PRICING").length).toBeGreaterThan(0);
    expect(searchCues(merged, "quantum mechanics")).toHaveLength(0);
  });
});

describe("chapters", () => {
  it("parses, sorts, and keeps sponsor chapters labelled rather than dropping them", () => {
    const parsed = parseChapters(
      JSON.stringify({
        version: "1.2.0",
        chapters: [
          { startTime: 300, title: "Main topic" },
          { startTime: 60, title: "Sponsor", toc: false },
          { startTime: 0, title: "Intro" },
        ],
      }),
    );
    expect(parsed.chapters.map((c) => c.title)).toEqual(["Intro", "Sponsor", "Main topic"]);
    expect(parsed.hiddenCount).toBe(1);
    expect(parsed.chapters[1]!.toc).toBe(false);
  });

  it("drops entries with no startTime, which cannot be placed on a timeline", () => {
    const parsed = parseChapters(JSON.stringify({ chapters: [{ title: "Nowhere" }, { startTime: 0 }] }));
    expect(parsed.chapters).toHaveLength(1);
  });

  it("says what went wrong when the URL served HTML instead of JSON", () => {
    expect(() => parseChapters("<html><body>404</body></html>")).toThrow(/did not return JSON/);
  });
});

describe("speaker heuristics", () => {
  const cue = (text: string) => `1
00:00:01,000 --> 00:00:04,000
${text}
`;

  it("accepts a capitalised machine label", () => {
    expect(parseTranscript(cue("ALICE: some words here")).cues[0]!.speaker).toBe("ALICE");
  });

  it("accepts the Speaker N convention", () => {
    expect(parseTranscript(cue("Speaker 1: some words here")).cues[0]!.speaker).toBe("Speaker 1");
  });

  it("accepts a label that recurs even when the text continues lowercase", () => {
    const parsed = parseTranscript(`1
00:00:01,000 --> 00:00:04,000
Anyway: here is the thing.

2
00:00:05,000 --> 00:00:08,000
Anyway: and another thing.
`);
    // Twice is no longer a sentence adverb, it is how this file labels a speaker.
    expect(parsed.cues[0]!.speaker).toBe("Anyway");
  });

  it("invents no speaker for a plain unlabelled transcript", () => {
    expect(parseTranscript(cue("Just some narration with no label.")).speakers).toEqual([]);
  });
});
