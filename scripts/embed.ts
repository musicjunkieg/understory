import { createHash } from "node:crypto";
import type { EmbeddingFile } from "./lib/embedding-types";

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
