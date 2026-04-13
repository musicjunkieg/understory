import { createHash } from "node:crypto";
import type { EmbeddingFile, VoyageEmbedResponse } from "./lib/embedding-types";

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
 * - Skip if existing.transcriptHash matches AND existing.model matches.
 * - Anything else (file missing, hash mismatch, model upgrade) → queue.
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
    input.existing.model === MODEL
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
