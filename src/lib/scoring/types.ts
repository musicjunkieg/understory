import type { TalkEntry } from "@/lib/types";
import type { TalkMention, TalkMentions } from "@/lib/crawl/types";
import type { Layer2Result } from "./interest";
// Local-import-then-re-export so `ScoringInputs` gets a usable local binding
// for `ActiveLayers` AND callers can `import { ActiveLayers } from "@/lib/scoring/types"`
// without needing to know `combine.ts` owns it.
import type { ActiveLayers } from "./combine";
export type { ActiveLayers };
// Runtime re-export of the default sentinel so callers importing from
// scoring/types get both the type and its default value in one place.
export { DEFAULT_ACTIVE_LAYERS } from "./combine";

export type TalkScoreState = "engaged" | "missed" | "unknown";

export interface Layer1Result {
  uniqueFollows: number;
  totalFollows: number;
  reachRatio: number;        // uniqueFollows / totalFollows, clamped to [0, 1]
  attentionInverse: number;  // 1 - reachRatio, clamped to [0, 1]
}

export interface TalkScore {
  rkey: string;
  intensity: number;         // 0–1; UI uses for glow + ordering
  state: TalkScoreState;
  layer1: Layer1Result;
  /** Normalized L1 coverage: fraction of conference-active follows who
   *  discussed this talk (0–1). Set by rankTalks; null before normalization
   *  or for unknown-state talks. Use for detail strip display. */
  normalizedCoverage: number | null;
  layer2: Layer2Result;
  layer3?: { friendBoost: number; recommenders: string[] };
}

export interface ScoringWeights {
  readonly surpriseSlider: number; // 0–1; controls Layer 2 contribution (high = serendipity)
  readonly friendsSlider: number;  // 0–1; controls Layer 3 contribution (high = friends override)
}

// Frozen so the exported sentinel can't be mutated by accident — it's used
// as a default parameter value in scoreTalk/rankTalks, so any mutation would
// corrupt every subsequent call that takes the default.
export const DEFAULT_WEIGHTS: Readonly<ScoringWeights> = Object.freeze({
  surpriseSlider: 0.5,
  friendsSlider: 0.5,
});

export interface ScoringInputs {
  talks: TalkEntry[];
  mentions: TalkMentions | null;  // null = crawl not yet completed
  followCount: number;            // from CrawlResult.followCount
  /** User interest vector from /api/crawl (#23). Null when the profile
   *  build returned "no-posts" or "error" — computeLayer2 returns
   *  interestScore: 0 for every talk in that case. Optional with null
   *  default so this task can land without breaking existing call sites;
   *  tightened to required in Task 10. */
  interestVector?: number[] | null;
  /** Talk embeddings from /api/embeddings (#24). Keyed by rkey. Talks
   *  not present in this record fall back to interestScore: 0 — a
   *  data-drift hedge for rkeys added after the last npm run embed.
   *  Optional default `{}` for the same TDD-green reason as interestVector. */
  embeddings?: Record<string, number[]>;
  weights?: ScoringWeights;
  active?: ActiveLayers;          // omitted = layer 1 only (today's deployment)
}

// Re-export TalkMention for downstream consumers that import only from
// scoring/types — saves them having to know about the crawl module.
export type { TalkMention, TalkMentions };
