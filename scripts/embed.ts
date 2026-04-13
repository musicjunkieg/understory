import "dotenv/config";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { TalkEntry } from "@/lib/types";
import type {
  EmbeddingFile,
  VoyageEmbedRequest,
  VoyageEmbedResponse,
} from "./lib/embedding-types";

export const MODEL = "voyage-3.5-lite";
export const DIMENSIONS = 1024;
export const SAFE_CHAR_LIMIT = 120_000;

export type WorkDecision =
  | { action: "skip" }
  | { action: "noText" }
  | {
      action: "queue";
      text: string;
      transcriptHash: string;
      truncated: boolean;
    };

interface DecideWorkInput {
  rkey: string;
  transcriptText: string;
  existing: EmbeddingFile | null;
}

/**
 * Decide whether to embed a talk, skip it, or note that it has no usable
 * transcript text. Pure function — no I/O — so it's trivially unit-testable
 * without mocks beyond the input shape itself.
 *
 * Hashing rules:
 * - Hash is always computed over the bytes that will be sent to Voyage,
 *   which means the post-truncation text. Hashing the raw pre-truncation
 *   text would leave us re-embedding forever after a truncation.
 * - Hash format is `sha256-<hex>`.
 *
 * Skip rules:
 * - Skip if existing.transcriptHash, existing.model, AND existing.dimensions
 *   all match the current configuration.
 * - Anything else (file missing, hash mismatch, model upgrade, dimension
 *   change) → queue. The dimensions check is defensive against model
 *   variants that allow reduced output dimensions under the same model
 *   name (voyage's `output_dimension` parameter, for example).
 */
export function decideWork(input: DecideWorkInput): WorkDecision {
  const trimmed = input.transcriptText.trim();
  if (trimmed.length === 0) {
    return { action: "noText" };
  }

  const truncated = input.transcriptText.length > SAFE_CHAR_LIMIT;
  const text = truncated
    ? input.transcriptText.slice(0, SAFE_CHAR_LIMIT)
    : input.transcriptText;
  const transcriptHash =
    "sha256-" + createHash("sha256").update(text).digest("hex");

  if (
    input.existing &&
    input.existing.transcriptHash === transcriptHash &&
    input.existing.model === MODEL &&
    input.existing.dimensions === DIMENSIONS
  ) {
    return { action: "skip" };
  }

  return { action: "queue", text, transcriptHash, truncated };
}

/**
 * Defensive validation of a Voyage batch response before any results
 * touch disk. All four checks must pass or we throw — partial writes
 * from a malformed batch would leave the on-disk state confused, and
 * idempotency relies on knowing the file always represents a complete
 * Voyage round-trip.
 *
 * - data is a non-null array with the expected length
 * - every index is in [0, expected) and the set covers exactly that range
 * - every vector has exactly DIMENSIONS elements
 * - every element is a finite number (no NaN, no Infinity)
 */
export function validateBatchResponse(
  response: VoyageEmbedResponse,
  expectedBatchSize: number,
): void {
  if (!response || !Array.isArray(response.data)) {
    throw new Error(
      "Voyage response: missing or non-array `data` field",
    );
  }
  if (response.data.length !== expectedBatchSize) {
    throw new Error(
      `Voyage response: length mismatch — expected ${expectedBatchSize}, got ${response.data.length}`,
    );
  }
  const seenIndices = new Set<number>();
  for (const item of response.data) {
    if (item === null || typeof item !== "object") {
      throw new Error(
        `Voyage response: non-object item in data array (got ${item === null ? "null" : typeof item})`,
      );
    }
    if (
      !Number.isInteger(item.index) ||
      item.index < 0 ||
      item.index >= expectedBatchSize
    ) {
      throw new Error(
        `Voyage response: index ${item.index} out of range [0, ${expectedBatchSize})`,
      );
    }
    if (seenIndices.has(item.index)) {
      throw new Error(
        `Voyage response: duplicate index ${item.index}`,
      );
    }
    seenIndices.add(item.index);
    if (!Array.isArray(item.embedding) || item.embedding.length !== DIMENSIONS) {
      throw new Error(
        `Voyage response: wrong dimension count for index ${item.index} — expected ${DIMENSIONS}, got ${item.embedding?.length ?? "missing"}`,
      );
    }
    for (const v of item.embedding) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error(
          `Voyage response: non-finite number in vector at index ${item.index}`,
        );
      }
    }
  }
}

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const BATCH_SIZE = 32;
const EMBEDDINGS_DIR = path.resolve(__dirname, "../data/embeddings");
const TRANSCRIPTS_DIR = path.resolve(__dirname, "../data/transcripts");
const TALKS_PATH = path.resolve(__dirname, "../data/talks.json");

interface QueuedTalk {
  rkey: string;
  text: string;
  transcriptHash: string;
  truncated: boolean;
  title: string;
}

function loadTalks(): TalkEntry[] {
  const raw = fs.readFileSync(TALKS_PATH, "utf-8");
  return JSON.parse(raw) as TalkEntry[];
}

function readTranscriptText(rkey: string): string | null {
  const transcriptPath = path.join(TRANSCRIPTS_DIR, `${rkey}.json`);
  if (!fs.existsSync(transcriptPath)) return null;
  const raw = JSON.parse(fs.readFileSync(transcriptPath, "utf-8"));
  return raw?.transcription?.text ?? null;
}

function loadExistingEmbedding(rkey: string): EmbeddingFile | null {
  const embeddingPath = path.join(EMBEDDINGS_DIR, `${rkey}.json`);
  if (!fs.existsSync(embeddingPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(embeddingPath, "utf-8")) as EmbeddingFile;
  } catch {
    // Corrupt file — treat as missing so it gets regenerated.
    return null;
  }
}

function writeEmbeddingFile(file: EmbeddingFile): void {
  const embeddingPath = path.join(EMBEDDINGS_DIR, `${file.rkey}.json`);
  fs.writeFileSync(embeddingPath, JSON.stringify(file, null, 2));
}

async function embedBatch(
  apiKey: string,
  batch: QueuedTalk[],
): Promise<void> {
  const body: VoyageEmbedRequest = {
    input: batch.map((t) => t.text),
    model: MODEL,
    input_type: "document",
  };

  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `Voyage API ${res.status} ${res.statusText}: ${errorBody.slice(0, 500)}`,
    );
  }

  const response = (await res.json()) as VoyageEmbedResponse;
  validateBatchResponse(response, batch.length);

  for (const item of response.data) {
    const queued = batch[item.index];
    const file: EmbeddingFile = {
      rkey: queued.rkey,
      model: MODEL,
      dimensions: DIMENSIONS,
      vector: item.embedding,
      transcriptHash: queued.transcriptHash,
      truncated: queued.truncated,
      generatedAt: new Date().toISOString(),
    };
    writeEmbeddingFile(file);
    console.log(`  [done] "${queued.title}"`);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.error("VOYAGE_API_KEY not set");
    process.exit(1);
  }

  fs.mkdirSync(EMBEDDINGS_DIR, { recursive: true });

  const talks = loadTalks();
  const withTranscripts = talks.filter((t) => t.transcriptFile);
  console.log(`Found ${withTranscripts.length} talks with transcripts`);

  const queue: QueuedTalk[] = [];
  let skipped = 0;
  let noText = 0;
  let queuedMissing = 0;
  let queuedStale = 0;

  for (const talk of withTranscripts) {
    const text = readTranscriptText(talk.rkey);
    if (text == null) {
      console.warn(`  [warn] no transcript file for ${talk.rkey}`);
      noText++;
      continue;
    }

    const existing = loadExistingEmbedding(talk.rkey);
    const decision = decideWork({
      rkey: talk.rkey,
      transcriptText: text,
      existing,
    });

    if (decision.action === "skip") {
      skipped++;
    } else if (decision.action === "noText") {
      console.warn(`  [warn] empty transcript for ${talk.rkey}`);
      noText++;
    } else {
      if (existing == null) queuedMissing++;
      else queuedStale++;
      queue.push({
        rkey: talk.rkey,
        text: decision.text,
        transcriptHash: decision.transcriptHash,
        truncated: decision.truncated,
        title: talk.title,
      });
    }
  }

  console.log(`Loaded ${skipped} existing embeddings`);
  console.log(
    `${queue.length} talks queued for embedding (${queuedMissing} missing, ${queuedStale} stale hash)`,
  );
  console.log(`${noText} skipped with empty/missing transcripts\n`);

  let truncatedCount = 0;
  let failedBatches = 0;
  let failedTalks = 0;
  let embeddedCount = 0;

  const totalBatches = Math.ceil(queue.length / BATCH_SIZE);
  for (let i = 0; i < queue.length; i += BATCH_SIZE) {
    const batch = queue.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`Embedding batch ${batchNum} of ${totalBatches} (${batch.length} talks)...`);

    try {
      await embedBatch(apiKey, batch);
      embeddedCount += batch.length;
      truncatedCount += batch.filter((b) => b.truncated).length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [batch failed] ${msg}`);
      console.error(`  rkeys: ${batch.map((b) => b.rkey).join(", ")}`);
      failedBatches++;
      failedTalks += batch.length;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Skipped: ${skipped} (hash matched)`);
  console.log(`Embedded: ${embeddedCount}`);
  console.log(`Skipped: ${noText} (empty transcripts)`);
  console.log(`Failed: ${failedBatches} batches (${failedTalks} talks)`);
  console.log(`Truncated: ${truncatedCount}`);

  process.exit(failedBatches === 0 ? 0 : 1);
}

// Only invoke main() when executed directly, not when imported by tests.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
