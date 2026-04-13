/**
 * Shared type contracts for the offline embedding pipeline.
 * Used by both `scripts/embed.ts` (writer) and `scripts/embed-smoke.ts`
 * (reader). Promoted to `src/lib/scoring/` if and when the runtime
 * scoring engine starts importing them directly (see #24).
 */

/** On-disk shape of `data/embeddings/{rkey}.json`. */
export interface EmbeddingFile {
  /** Talk record key — matches the transcript filename stem. */
  rkey: string;
  /** Voyage model identifier. Mismatch invalidates the file on re-run. */
  model: string;
  /** Vector dimension count. Must equal `vector.length`. */
  dimensions: number;
  /** The embedding itself, stored as plain JSON numbers for diff-readability. */
  vector: number[];
  /** SHA-256 of the bytes actually sent to Voyage (post-truncation). */
  transcriptHash: string;
  /** True only if the source transcript exceeded SAFE_CHAR_LIMIT and was truncated. */
  truncated: boolean;
  /** ISO 8601 timestamp. Diagnostic only — not used for idempotency. */
  generatedAt: string;
}

/** POST body shape for Voyage's /v1/embeddings endpoint. */
export interface VoyageEmbedRequest {
  input: string[];
  model: string;
  input_type: "document" | "query";
}

/** Response shape from Voyage's /v1/embeddings endpoint. */
export interface VoyageEmbedResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}
