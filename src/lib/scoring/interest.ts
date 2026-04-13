import type { TalkEntry } from "@/lib/types";
import { cosineSimilarity } from "./cosine";

/**
 * Result shape for layer 2 scoring. Identical to the old InterestStubResult
 * so combineLayers can consume it without a signature change.
 */
export interface Layer2Result {
  /** Similarity score in [0, 1]. 0 when the user vector is null, when the
   *  talk has no embedding, or when cosine is -1. 0.5 when the vectors are
   *  orthogonal (or when the talk vector has zero magnitude). 1.0 when
   *  they're identical. */
  interestScore: number;
}

/**
 * Compute the layer-2 interest similarity between a user's interest vector
 * (from #23 via /api/crawl) and a talk's pre-computed embedding (from #21
 * via /api/embeddings).
 *
 * Three explicit zero cases before the cosine math:
 *   1. User has no profile vector (null) — #23's "no-posts" or "error" path
 *   2. Talk has no embedding file on disk — data drift hedge for rkeys
 *      added after the last `npm run embed` run
 *   3. Dimension mismatch — thrown loudly by cosineSimilarity, NOT caught
 *      here because it indicates a bug, not normal runtime behavior
 *
 * Shift-and-scale normalization maps cosine [-1, 1] → interestScore [0, 1]
 * via (cos + 1) / 2.
 */
export function computeLayer2(
  talk: TalkEntry,
  interestVector: number[] | null,
  embeddings: Record<string, number[]>,
): Layer2Result {
  if (interestVector === null) {
    return { interestScore: 0 };
  }

  const talkVector = embeddings[talk.rkey];
  if (!talkVector) {
    return { interestScore: 0 };
  }

  // cosineSimilarity throws on length mismatch; we let that propagate.
  const cosine = cosineSimilarity(interestVector, talkVector);
  return { interestScore: (cosine + 1) / 2 };
}
