import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

const REPO_DID = "did:plc:rbvrr34edl5ddpuwcubjiost";
const CONF_DID = "did:plc:3xewinw4wtimo2lqfy5fm5sw";
const PDS_HOST = "https://iameli.com";
const BSKY_HOST = "https://bsky.social";
const VOD_HOST = "https://vod-beta.stream.place";
const VIDEO_COLLECTION = "place.stream.video";
const EVENT_COLLECTION = "community.lexicon.calendar.event";
const DATA_DIR = path.resolve(__dirname, "../data");
const TRANSCRIPT_DIR = path.join(DATA_DIR, "transcripts");

interface VideoRecord {
  uri: string;
  cid: string;
  value: {
    $type: string;
    title: string;
    source: {
      ref: string;
      size: number;
      $type: string;
      mimeType: string;
      start?: number;
      end?: number;
    };
    creator: string;
    duration: number;
    createdAt: string;
  };
}

interface Speaker {
  id: string; // Bluesky handle
  name: string;
}

interface EventRecord {
  uri: string;
  cid: string;
  value: {
    $type: string;
    name: string;
    description: string;
    startsAt: string;
    endsAt: string;
    mode: string;
    status: string;
    createdAt: string;
    additionalData: {
      room?: string;
      type?: string;
      category?: string;
      sourceId?: string;
      speakers?: Speaker[];
      vodAtUri?: string;
      isAtmosphereconf?: boolean;
    };
  };
}

interface TalkEntry {
  rkey: string;
  title: string;
  vodUri: string;
  vodCid: string;
  hlsUrl: string;
  durationMs: number;
  createdAt: string;
  // From schedule
  eventUri: string | null;
  description: string | null;
  speakers: Speaker[];
  room: string | null;
  talkType: string | null;
  category: string | null;
  startsAt: string | null;
  endsAt: string | null;
  // Transcript
  transcriptFile: string | null;
}

async function fetchPaginatedRecords<T>(
  host: string,
  repo: string,
  collection: string,
): Promise<T[]> {
  const records: T[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      repo,
      collection,
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);

    const url = `${host}/xrpc/com.atproto.repo.listRecords?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${collection}: ${res.status}`);

    const data = await res.json();
    records.push(...data.records);
    cursor = data.cursor;
  } while (cursor);

  return records;
}

/**
 * Normalize a title for fuzzy comparison: lowercase, strip punctuation,
 * remove common filler words, collapse whitespace.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(
      /\b(the|a|an|at|on|in|of|for|and|with|to|from|by|is|are|was|its)\b/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Score how similar two titles are by counting shared significant words.
 * Returns a value between 0 and 1.
 */
function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeTitle(a).split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(normalizeTitle(b).split(" ").filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared++;
  }
  return shared / Math.max(wordsA.size, wordsB.size);
}

/**
 * Try to match an unmatched VOD to a schedule event using fallback heuristics:
 *  1. Exact timestamp match (createdAt === startsAt)
 *  2. Title similarity (>= 0.4 threshold)
 * Returns the best matching event or null.
 */
function fallbackMatch(
  vod: VideoRecord,
  candidates: EventRecord[],
): EventRecord | null {
  // 1. Exact timestamp match
  const vodTime = new Date(vod.value.createdAt).getTime();
  for (const event of candidates) {
    const eventTime = new Date(event.value.startsAt).getTime();
    if (Math.abs(vodTime - eventTime) < 60_000) {
      return event;
    }
  }

  // 2. Title similarity — require higher threshold for short titles
  //    to avoid false matches like "closing remarks" → "Opening Remarks"
  let bestEvent: EventRecord | null = null;
  let bestScore = 0;
  for (const event of candidates) {
    const score = titleSimilarity(vod.value.title, event.value.name);
    if (score > bestScore) {
      bestScore = score;
      bestEvent = event;
    }
  }
  const normalizedWords = normalizeTitle(vod.value.title).split(" ").filter((w) => w.length > 2);
  const threshold = normalizedWords.length <= 3 ? 0.7 : 0.35;
  if (bestScore >= threshold && bestEvent) {
    return bestEvent;
  }

  return null;
}

function getRkey(uri: string): string {
  return uri.split("/").pop()!;
}

function getPlaylistUrl(uri: string): string {
  return `${VOD_HOST}/xrpc/place.stream.playback.getVideoPlaylist?uri=${encodeURIComponent(uri)}`;
}

// Duration in the video records is in nanoseconds. Convert to ms.
function nsToMs(ns: number): number {
  return Math.round(ns / 1_000_000);
}

async function main() {
  console.log("Fetching video records...");
  const videoRecords = await fetchPaginatedRecords<VideoRecord>(
    PDS_HOST,
    REPO_DID,
    VIDEO_COLLECTION,
  );
  console.log(`Found ${videoRecords.length} video records`);

  // Filter to individual talk VODs (exclude room streams created by repo owner)
  const talkVods = videoRecords.filter((r) => r.value.creator !== REPO_DID);
  console.log(`Filtered to ${talkVods.length} individual talk VODs`);

  console.log("\nFetching schedule events...");
  const eventRecords = await fetchPaginatedRecords<EventRecord>(
    BSKY_HOST,
    CONF_DID,
    EVENT_COLLECTION,
  );
  console.log(`Found ${eventRecords.length} schedule events`);

  // Build a lookup: vodAtUri -> event record
  const eventByVodUri = new Map<string, EventRecord>();
  const matchedEventUris = new Set<string>();
  for (const event of eventRecords) {
    const vodUri = event.value.additionalData?.vodAtUri;
    if (vodUri) {
      eventByVodUri.set(vodUri, event);
    }
  }
  console.log(`${eventByVodUri.size} events have VOD links`);

  // First pass: match by vodAtUri
  const unmatchedVods: VideoRecord[] = [];
  const vodToEvent = new Map<string, EventRecord>();

  for (const vod of talkVods) {
    const event = eventByVodUri.get(vod.uri);
    if (event) {
      vodToEvent.set(vod.uri, event);
      matchedEventUris.add(event.uri);
    } else {
      unmatchedVods.push(vod);
    }
  }
  console.log(`First pass (vodAtUri): ${vodToEvent.size} matched, ${unmatchedVods.length} unmatched`);

  // Second pass: fallback matching for unmatched VODs
  // Candidates are events not already matched by vodAtUri
  const fallbackCandidates = eventRecords.filter(
    (e) => !matchedEventUris.has(e.uri),
  );
  let fallbackMatched = 0;

  for (const vod of [...unmatchedVods]) {
    const event = fallbackMatch(vod, fallbackCandidates);
    if (event) {
      vodToEvent.set(vod.uri, event);
      matchedEventUris.add(event.uri);
      // Remove from candidates so it can't double-match
      const idx = fallbackCandidates.indexOf(event);
      if (idx >= 0) fallbackCandidates.splice(idx, 1);
      // Remove from unmatched
      unmatchedVods.splice(unmatchedVods.indexOf(vod), 1);
      fallbackMatched++;
      console.log(`  [fallback] "${vod.value.title}" → "${event.value.name}"`);
    }
  }
  console.log(`Second pass (fallback): ${fallbackMatched} matched, ${unmatchedVods.length} still unmatched`);

  for (const vod of unmatchedVods) {
    console.log(`  [no match] ${vod.value.title}`);
  }

  // Build the index
  const talks: TalkEntry[] = [];
  let matched = vodToEvent.size;
  let unmatched = talkVods.length - matched;

  for (const vod of talkVods) {
    const rkey = getRkey(vod.uri);
    const event = vodToEvent.get(vod.uri);

    const transcriptFile = `transcripts/${rkey}.json`;
    const hasTranscript = fs.existsSync(path.join(DATA_DIR, transcriptFile));

    talks.push({
      rkey,
      title: vod.value.title,
      vodUri: vod.uri,
      vodCid: vod.cid,
      hlsUrl: getPlaylistUrl(vod.uri),
      durationMs: nsToMs(vod.value.duration),
      createdAt: vod.value.createdAt,
      eventUri: event?.uri ?? null,
      description: event?.value.description ?? null,
      speakers: event?.value.additionalData?.speakers ?? [],
      room: event?.value.additionalData?.room ?? null,
      talkType: event?.value.additionalData?.type ?? null,
      category: event?.value.additionalData?.category ?? null,
      startsAt: event?.value.startsAt ?? null,
      endsAt: event?.value.endsAt ?? null,
      transcriptFile: hasTranscript ? transcriptFile : null,
    });
  }

  // Sort by schedule time (talks with schedule first, then by time)
  talks.sort((a, b) => {
    if (a.startsAt && b.startsAt) return a.startsAt.localeCompare(b.startsAt);
    if (a.startsAt) return -1;
    if (b.startsAt) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });

  // Write output
  const outputPath = path.join(DATA_DIR, "talks.json");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(talks, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`Total talk VODs: ${talkVods.length}`);
  console.log(`Matched to schedule: ${matched}`);
  console.log(`Unmatched: ${unmatched}`);
  console.log(`With transcripts: ${talks.filter((t) => t.transcriptFile).length}`);
  console.log(`\nWritten to ${outputPath}`);
}

main().catch(console.error);
