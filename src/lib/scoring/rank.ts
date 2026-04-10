import type { TalkEntry } from "@/lib/types";
import type { TalkMentions } from "@/lib/crawl/types";
import {
  type TalkScore,
  type TalkScoreState,
  type ScoringInputs,
  type ScoringWeights,
  DEFAULT_WEIGHTS,
} from "./types";
import { computeLayer1 } from "./networkAttention";
import { computeInterestStub } from "./interestStub";
import { computeFriendStub } from "./friendStub";
import {
  type ActiveLayers,
  DEFAULT_ACTIVE_LAYERS,
  combineLayers,
} from "./combine";

function unknownScore(rkey: string, followCount: number): TalkScore {
  return {
    rkey,
    intensity: 0,
    state: "unknown",
    layer1: {
      uniqueFollows: 0,
      totalFollows: followCount,
      reachRatio: 0,
      attentionInverse: 0,
    },
  };
}

/**
 * Score a single talk. Pass the full `mentions` map (or null if no crawl
 * has run yet) — the function looks up the talk's mention internally so
 * callers don't have to encode "do we have crawl data" as a separate flag.
 *
 * Returns `unknown` state when:
 *   - mentions is null (crawl hasn't run)
 *   - followCount is 0 (user has no follows; reach is undefined)
 *   - mention is absent (talk is out of crawl scope, e.g. no eventUri)
 *
 * Otherwise runs Layer 1 + the two stubs through `combineLayers` with the
 * given weights and active layer flags.
 */
export function scoreTalk(
  talk: TalkEntry,
  mentions: TalkMentions | null,
  followCount: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  active: ActiveLayers = DEFAULT_ACTIVE_LAYERS,
): TalkScore {
  if (mentions === null || followCount === 0) {
    return unknownScore(talk.rkey, followCount);
  }
  const mention = mentions[talk.rkey];
  if (!mention) {
    // Talk is not in crawl scope (e.g. no eventUri so the crawler skipped it).
    return unknownScore(talk.rkey, followCount);
  }

  const layer1 = computeLayer1(mention, followCount);
  const layer2 = computeInterestStub(talk);
  const layer3 = computeFriendStub(talk);
  const intensity = combineLayers(layer1, layer2, layer3, weights, active);

  const state: TalkScoreState =
    layer1.uniqueFollows === 0 ? "missed" : "engaged";

  return { rkey: talk.rkey, intensity, state, layer1 };
}

const STATE_ORDER: Record<TalkScoreState, number> = {
  missed: 0,
  engaged: 1,
  unknown: 2,
};

function compareTalkScores(a: TalkScore, b: TalkScore): number {
  // Primary: state group (missed first, then engaged, then unknown)
  const stateDelta = STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (stateDelta !== 0) return stateDelta;
  // Secondary: intensity descending (highest glow first within each state)
  const intensityDelta = b.intensity - a.intensity;
  if (intensityDelta !== 0) return intensityDelta;
  // Tertiary: rkey ascending — deterministic tiebreak so the order is stable
  // across renders (matters for React reconciliation).
  return a.rkey.localeCompare(b.rkey);
}

export function rankTalks(inputs: ScoringInputs): TalkScore[] {
  const {
    talks,
    mentions,
    followCount,
    weights = DEFAULT_WEIGHTS,
    active = DEFAULT_ACTIVE_LAYERS,
  } = inputs;
  return talks
    .map((talk) => scoreTalk(talk, mentions, followCount, weights, active))
    .sort(compareTalkScores);
}
