import type { TalkEntry } from "@/lib/types";

export interface InterestStubResult {
  interestScore: number;
}

/**
 * Layer 2 stub. Returns 0 until the following issues land:
 *   - #21: generate transcript embeddings
 *   - #22: publish topicIndex records
 *   - #23: user interest profiling
 *   - #24: cosine similarity matching
 *
 * When implemented, this should return cosine similarity in [0, 1] between
 * the user's recent-post embedding and the talk's topicIndex embedding.
 *
 * The leading underscore on `_talk` follows the `@typescript-eslint/no-unused-vars`
 * `argsIgnorePattern: "^_"` convention configured by `eslint-config-next/typescript`.
 */
export function computeInterestStub(talk: TalkEntry): InterestStubResult {
  void talk;
  return { interestScore: 0 };
}
