// Public surface for the scoring module. Consumers should import from
// `@/lib/scoring`, not from individual files, so refactors inside the module
// don't break call sites.

export type {
  TalkScore,
  TalkScoreState,
  Layer1Result,
  ScoringWeights,
  ScoringInputs,
  TalkMention,
  TalkMentions,
} from "./types";

export { DEFAULT_WEIGHTS } from "./types";

export type { ActiveLayers } from "./combine";
export { DEFAULT_ACTIVE_LAYERS, combineLayers } from "./combine";

export { computeLayer1 } from "./networkAttention";
export { scoreTalk, rankTalks } from "./rank";
