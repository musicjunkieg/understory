import type { TalkMention } from "@/lib/crawl/types";
import type { Layer1Result } from "./types";

/**
 * Compute the Layer 1 (network attention, inverted) score for a single talk.
 *
 * Returns the fraction of the user's follows who engaged with the talk
 * (`reachRatio`) and its inverse (`attentionInverse`), where 1.0 means
 * "nobody in your network engaged" and 0.0 means "every single one of your
 * follows engaged."
 *
 * We use `mention.follows.length` rather than `mention.count` so the algorithm
 * is robust to a future crawler change that decouples the two. Today the
 * crawler enforces `count === follows.length`.
 */
export function computeLayer1(
  mention: TalkMention | undefined,
  followCount: number,
): Layer1Result {
  const uniqueFollows = mention?.follows.length ?? 0;
  // Clamp to [0, 1]: uniqueFollows can theoretically exceed followCount if a
  // CrawlResult is reused after the user's follow list changes (someone
  // unfollowed but still appears in cached mentions). The clamp prevents
  // attentionInverse from going negative in that edge case.
  const reachRatio =
    followCount > 0 ? Math.min(1, uniqueFollows / followCount) : 0;
  const attentionInverse = 1 - reachRatio;
  return {
    uniqueFollows,
    totalFollows: followCount,
    reachRatio,
    attentionInverse,
  };
}
