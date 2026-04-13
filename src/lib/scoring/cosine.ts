/**
 * Cosine similarity in [-1, 1] for two equal-length numeric vectors.
 * Returns 0 if either vector has zero magnitude (avoids NaN propagation).
 * Throws on length mismatch — defensive guard against a model upgrade
 * leaving stale embeddings on disk that don't match newer vectors.
 *
 * Accepts both `number[]` and `Float32Array` via `ArrayLike<number>` so
 * callers can pass either without converting at the call site.
 */
export function cosineSimilarity(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: length mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
