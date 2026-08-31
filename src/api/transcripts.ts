/**
 * Reading a transcript, which is the thing the API will not do for you.
 *
 * Podcast Index tells you a transcript exists and gives you a URL. That is
 * where every thin wrapper stops, and it is exactly one step short of useful: a
 * model cannot open a URL, so "here is a link to the transcript" answers no
 * question anybody actually asked. Fetching it, parsing it and handing back
 * timestamped text is the whole point of this module.
 *
 * **Four formats, and the declared type is not trustworthy.** The
 * <podcast:transcript> tag carries a mime type, and publishers get it wrong
 * constantly: SRT served as text/plain, VTT declared application/json, JSON
 * with a .srt extension. So the type is a hint used to order the attempts, and
 * the actual format is detected by sniffing the body. Trusting the declaration
 * would fail on a large minority of real feeds.
 *
 * **Speaker labels are worth preserving.** The Podcasting 2.0 JSON format has a
 * real speaker field. SRT and VTT do not, but a large share of podcast SRT in
 * the wild puts "SPEAKER:" or "<v Speaker>" at the head of a cue, and pulling
 * that out turns a wall of text into a readable interview. Where there is no
 * speaker information, none is invented.
 *
 * **Cues are merged before they are returned.** A raw SRT is a few thousand
 * two-second fragments, and handing that to a model wastes most of the context
 * on timestamps. Consecutive cues from one speaker are joined into paragraphs
 * that keep the start time of the first, which is what a person reading it
 * wants and roughly a tenth of the tokens.
 */

export type Cue = {
  /** Seconds from the start of the episode. */
  start: number;
  end?: number;
  speaker?: string;
  text: string;
};

export type ParsedTranscript = {
  format: "srt" | "vtt" | "json" | "text";
  cues: Cue[];
  /** True when the file had no usable timing and the text is unsegmented. */
  untimed: boolean;
  speakers: string[];
};

/** Sniff the real format from the body, ignoring what the feed claimed. */
export function detectFormat(body: string, declaredType?: string): ParsedTranscript["format"] {
  const head = body.slice(0, 2000).trim();

  if (head.startsWith("{") || head.startsWith("[")) return "json";
  if (/^WEBVTT/i.test(head)) return "vtt";
  // An SRT cue is a number on its own line followed by a timing line using
  // commas for the fractional part. VTT uses a period, which is the only
  // reliable way to tell a headerless VTT from an SRT.
  if (/\d{1,2}:\d{2}:\d{2},\d{3}\s*-->/.test(head)) return "srt";
  if (/\d{1,2}:\d{2}:\d{2}\.\d{3}\s*-->/.test(head)) return "vtt";

  const declared = (declaredType ?? "").toLowerCase();
  if (declared.includes("json")) return "json";
  if (declared.includes("vtt")) return "vtt";
  if (declared.includes("srt") || declared.includes("subrip")) return "srt";
  return "text";
}

export function parseTranscript(body: string, declaredType?: string): ParsedTranscript {
  const format = detectFormat(body, declaredType);
  let cues: Cue[];

  switch (format) {
    case "json":
      cues = parseJsonTranscript(body);
      break;
    case "srt":
    case "vtt":
      cues = parseCueList(body, format);
      break;
    default:
      cues = parsePlainText(body);
  }

  const speakers: string[] = [];
  for (const cue of cues) {
    if (cue.speaker && !speakers.includes(cue.speaker)) speakers.push(cue.speaker);
  }

  return {
    format,
    cues,
    untimed: cues.every((cue) => cue.start === 0),
    speakers,
  };
}

/**
 * The Podcasting 2.0 JSON transcript.
 *
 * The spec's shape is `{ version, segments: [{ speaker, startTime, endTime,
 * body }] }`. Several real files use `text` rather than `body`, and a few wrap
 * the segments in a bare array with no envelope, so both are accepted.
 */
function parseJsonTranscript(body: string): Cue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // A file that claimed JSON and is not gets read as text rather than thrown
    // away. Half a transcript beats an error.
    return parsePlainText(body);
  }

  const segments = Array.isArray(parsed)
    ? parsed
    : ((parsed as { segments?: unknown[] })?.segments ?? []);
  if (!Array.isArray(segments)) return parsePlainText(body);

  const cues: Cue[] = [];
  for (const raw of segments) {
    if (!raw || typeof raw !== "object") continue;
    const seg = raw as Record<string, unknown>;
    const text = String(seg.body ?? seg.text ?? "").trim();
    if (!text) continue;
    const speaker = typeof seg.speaker === "string" ? seg.speaker.trim() : undefined;
    cues.push({
      start: toSeconds(seg.startTime),
      end: seg.endTime === undefined ? undefined : toSeconds(seg.endTime),
      ...(speaker ? { speaker } : {}),
      text,
    });
  }
  return cues;
}

function toSeconds(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** SRT and VTT share a cue structure and differ only in the decimal separator. */
function parseCueList(body: string, format: "srt" | "vtt"): Cue[] {
  const normalized = body.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const blocks = normalized.split(/\n{2,}/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    if (!lines.length) continue;
    if (format === "vtt" && /^(WEBVTT|NOTE|STYLE|REGION)\b/i.test(lines[0] ?? "")) continue;

    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) continue;

    const timing = lines[timingIndex] ?? "";
    const [rawStart, rawEnd] = timing.split("-->");
    const start = parseTimestamp(rawStart ?? "");
    const end = parseTimestamp(rawEnd ?? "");
    if (start === undefined) continue;

    const textLines = lines.slice(timingIndex + 1);
    if (!textLines.length) continue;

    let speaker: string | undefined;
    let text = textLines.join(" ");

    // VTT voice spans: <v Alice>text</v>
    const voice = text.match(/^<v\s+([^>]+)>/i);
    if (voice?.[1]) {
      speaker = voice[1].trim();
      text = text.replace(/^<v\s+[^>]+>/i, "");
    }

    text = stripTags(text).trim();

    if (!text) continue;
    cues.push({ start, ...(end !== undefined ? { end } : {}), ...(speaker ? { speaker } : {}), text });
  }

  return extractLabelledSpeakers(cues);
}

/**
 * Pull "NAME:" speaker labels out of cue text.
 *
 * A leading capitalised word followed by a colon is the common speaker
 * convention in podcast SRT, and it is also how an ordinary sentence begins:
 * "Anyway: here is the thing" is not somebody called Anyway. Getting that wrong
 * invents speakers, which is worse than reporting none, because a reader
 * cannot tell a hallucinated speaker from a real one.
 *
 * So a candidate is only accepted on one of four signals, in a second pass
 * once every candidate in the file is known:
 *
 *   - it is written in capitals, as transcription tools emit
 *   - it is literally "Speaker 1", the other common machine convention
 *   - it heads more than one cue, which a sentence adverb almost never does
 *   - the text after the colon starts a new sentence with a capital letter,
 *     where a continuation like "Anyway: here is" does not
 *
 * The last is the weakest and carries the ones the others miss, such as a guest
 * who speaks exactly once.
 */
function extractLabelledSpeakers(cues: Cue[]): Cue[] {
  const pattern = /^([A-Z][A-Za-z0-9.'-]*(?: [A-Za-z0-9.'-]+){0,2}):\s+(\S.*)$/s;

  const counts = new Map<string, number>();
  for (const cue of cues) {
    if (cue.speaker) continue;
    const label = cue.text.match(pattern)?.[1];
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return cues.map((cue) => {
    if (cue.speaker) return cue;
    const match = cue.text.match(pattern);
    const label = match?.[1];
    const rest = match?.[2];
    if (!label || !rest) return cue;

    const looksMachine = label === label.toUpperCase() || /^Speaker \d+$/i.test(label);
    const recurs = (counts.get(label) ?? 0) > 1;
    const startsSentence = /^[A-Z"'“‘(]/.test(rest);
    if (!looksMachine && !recurs && !startsSentence) return cue;

    return { ...cue, speaker: label, text: rest.trim() };
  });
}

/** `HH:MM:SS,mmm`, `HH:MM:SS.mmm`, or `MM:SS.mmm`. Returns seconds. */
export function parseTimestamp(raw: string): number | undefined {
  const match = raw.trim().match(/(\d{1,3}):(\d{2})(?::(\d{2}))?[.,](\d{1,3})/);
  if (!match) {
    const short = raw.trim().match(/^(\d{1,3}):(\d{2})$/);
    if (!short) return undefined;
    return Number(short[1]) * 60 + Number(short[2]);
  }
  const [, a, b, c, frac] = match;
  const ms = Number((frac ?? "0").padEnd(3, "0")) / 1000;
  // With three groups it is H:M:S; with two it is M:S.
  return c === undefined
    ? Number(a) * 60 + Number(b) + ms
    : Number(a) * 3600 + Number(b) * 60 + Number(c) + ms;
}

/**
 * A transcript with no timing: HTML or plain prose.
 *
 * Returned as paragraphs at time zero rather than refused. It is still the
 * words that were said, and saying so honestly through `untimed` is better than
 * pretending a format was unsupported.
 */
function parsePlainText(body: string): Cue[] {
  const text = stripTags(body);
  return text
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((part) => ({ start: 0, text: part }));
}

function stripTags(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/**
 * Join consecutive cues into paragraphs.
 *
 * A speaker change always starts a new paragraph, and so does a gap in time
 * longer than `gapSeconds`, which is usually a topic break. Everything else
 * accumulates until it reaches a readable length.
 */
export function mergeCues(
  cues: Cue[],
  options: { maxChars?: number; gapSeconds?: number } = {},
): Cue[] {
  const maxChars = options.maxChars ?? 700;
  const gapSeconds = options.gapSeconds ?? 4;
  const out: Cue[] = [];

  for (const cue of cues) {
    const last = out[out.length - 1];
    const sameSpeaker = last && last.speaker === cue.speaker;
    const closeEnough = last && cue.start - (last.end ?? last.start) <= gapSeconds;
    const roomLeft = last && last.text.length + cue.text.length + 1 <= maxChars;

    if (last && sameSpeaker && closeEnough && roomLeft) {
      last.text = `${last.text} ${cue.text}`.replace(/\s+/g, " ");
      if (cue.end !== undefined) last.end = cue.end;
      continue;
    }
    out.push({ ...cue });
  }
  return out;
}

/** `1:02:03` for an hour or more, `2:03` below it. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, "0")}` : `${mm}:${String(s).padStart(2, "0")}`;
}

export type TranscriptMatch = {
  start: number;
  timestamp: string;
  speaker?: string;
  /** The matching paragraph, with a little either side for context. */
  excerpt: string;
};

/**
 * Find where a phrase was said.
 *
 * Case-insensitive substring rather than fuzzy, and that limitation is stated
 * in the tool description, because a model that believes this is semantic
 * search will report "not discussed" when the topic was discussed in different
 * words. Matching is done on the merged paragraphs so a phrase split across two
 * two-second cues still matches, which a naive per-cue search would miss.
 */
export function searchCues(cues: Cue[], query: string, limit = 20): TranscriptMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const matches: TranscriptMatch[] = [];
  for (let i = 0; i < cues.length && matches.length < limit; i++) {
    const cue = cues[i];
    if (!cue || !cue.text.toLowerCase().includes(needle)) continue;

    const before = cues[i - 1]?.text ?? "";
    const after = cues[i + 1]?.text ?? "";
    const excerpt = [before && `…${tail(before, 120)}`, cue.text, after && `${head(after, 120)}…`]
      .filter(Boolean)
      .join(" ");

    matches.push({
      start: cue.start,
      timestamp: formatTimestamp(cue.start),
      ...(cue.speaker ? { speaker: cue.speaker } : {}),
      excerpt,
    });
  }
  return matches;
}

function tail(text: string, n: number): string {
  return text.length <= n ? text : text.slice(text.length - n);
}

function head(text: string, n: number): string {
  return text.length <= n ? text : text.slice(0, n);
}
