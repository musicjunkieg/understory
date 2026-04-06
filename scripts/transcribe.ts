import "dotenv/config";
import { AssemblyAI } from "assemblyai";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const REPO_DID = "did:plc:rbvrr34edl5ddpuwcubjiost";
const PDS_HOST = "https://iameli.com";
const VOD_HOST = "https://vod-beta.stream.place";
const COLLECTION = "place.stream.video";
const TRANSCRIPT_DIR = path.resolve(__dirname, "../data/transcripts");
const BATCH_SIZE = 10;

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

interface ListRecordsResponse {
  records: VideoRecord[];
  cursor?: string;
}

async function fetchAllVideoRecords(): Promise<VideoRecord[]> {
  const records: VideoRecord[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      repo: REPO_DID,
      collection: COLLECTION,
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);

    const url = `${PDS_HOST}/xrpc/com.atproto.repo.listRecords?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch records: ${res.status}`);

    const data: ListRecordsResponse = await res.json();
    records.push(...data.records);
    cursor = data.cursor;
  } while (cursor);

  return records;
}

function isIndividualTalkVOD(record: VideoRecord): boolean {
  // Full-day room streams are created by the repo owner (Streamplace itself).
  // Individual talk VODs are created by different DIDs (room-specific stream accounts).
  if (record.value.creator === REPO_DID) return false;
  return true;
}

function getRkey(uri: string): string {
  return uri.split("/").pop()!;
}

function getPlaylistUrl(uri: string): string {
  return `${VOD_HOST}/xrpc/place.stream.playback.getVideoPlaylist?uri=${encodeURIComponent(uri)}`;
}

async function extractAudio(
  playlistUrl: string,
  outputPath: string,
): Promise<void> {
  console.log(`  Extracting audio to ${path.basename(outputPath)}...`);
  execFileSync(
    "ffmpeg",
    ["-y", "-i", playlistUrl, "-vn", "-q:a", "2", outputPath],
    { timeout: 600_000, stdio: ["pipe", "pipe", "pipe"] },
  );
}

async function transcribeTalk(
  client: AssemblyAI,
  record: VideoRecord,
): Promise<void> {
  const rkey = getRkey(record.uri);
  const outputPath = path.join(TRANSCRIPT_DIR, `${rkey}.json`);

  // Skip if already transcribed
  if (fs.existsSync(outputPath)) {
    console.log(`  [skip] ${record.value.title} — already transcribed`);
    return;
  }

  const mp3Path = `/tmp/${rkey}.mp3`;
  const playlistUrl = getPlaylistUrl(record.uri);

  try {
    // Extract audio
    await extractAudio(playlistUrl, mp3Path);

    // Transcribe with AssemblyAI
    console.log(`  Transcribing: ${record.value.title}...`);
    const transcript = await client.transcripts.transcribe({
      audio: mp3Path,
      speaker_labels: true,
      speech_models: ["universal-3-pro", "universal-2"],
    } as any);

    if (transcript.status === "error") {
      console.error(`  [error] ${record.value.title}: ${transcript.error}`);
      return;
    }

    // Save result
    const result = {
      uri: record.uri,
      cid: record.cid,
      title: record.value.title,
      creator: record.value.creator,
      duration: record.value.duration,
      createdAt: record.value.createdAt,
      transcription: {
        id: transcript.id,
        status: transcript.status,
        text: transcript.text,
        utterances: transcript.utterances,
        words: transcript.words,
        audio_duration: transcript.audio_duration,
      },
    };

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(
      `  [done] ${record.value.title} (${transcript.audio_duration}s)`,
    );
  } finally {
    // Clean up mp3
    if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
  }
}

async function processBatch(
  client: AssemblyAI,
  records: VideoRecord[],
): Promise<void> {
  await Promise.all(records.map((r) => transcribeTalk(client, r)));
}

async function main() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    console.error("ASSEMBLYAI_API_KEY not set");
    process.exit(1);
  }

  const client = new AssemblyAI({ apiKey });

  // Ensure output directory exists
  fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });

  // Fetch all video records
  console.log("Fetching video records...");
  const allRecords = await fetchAllVideoRecords();
  console.log(`Found ${allRecords.length} total video records`);

  // Filter to individual talk VODs
  const talks = allRecords.filter(isIndividualTalkVOD);
  console.log(`Filtered to ${talks.length} individual talk VODs`);
  console.log(
    `Skipped ${allRecords.length - talks.length} full-day room streams`,
  );

  // Check which ones are already done
  const remaining = talks.filter((t) => {
    const rkey = getRkey(t.uri);
    return !fs.existsSync(path.join(TRANSCRIPT_DIR, `${rkey}.json`));
  });
  console.log(
    `${talks.length - remaining.length} already transcribed, ${remaining.length} remaining\n`,
  );

  // Process in batches of BATCH_SIZE
  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch = remaining.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(remaining.length / BATCH_SIZE);
    console.log(
      `\n=== Batch ${batchNum}/${totalBatches} (${batch.length} talks) ===`,
    );
    batch.forEach((r) => console.log(`  - ${r.value.title}`));
    console.log();

    await processBatch(client, batch);
  }

  console.log("\nDone! All talks transcribed.");
}

main().catch(console.error);
