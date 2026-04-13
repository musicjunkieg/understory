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
import { computeLayer2 } from "./interest";
import { computeFriendStub } from "./friendStub";
import {
  type ActiveLayers,
  DEFAULT_ACTIVE_LAYERS,
  combineLayers,
} from "./combine";

function unknownScore(rkey: string, followCount: number): TalkScore {
  // Sanitize: if followCount is non-finite or negative (e.g., from a corrupted
  // cache or a slider-derived value that wasn't validated upstream), don't
  // propagate the bad number into the result. Stash 0 so JSON serialization,
  // React rendering, and downstream consumers see a stable shape.
  const safeTotalFollows =
    Number.isFinite(followCount) && followCount > 0 ? followCount : 0;
  return {
    rkey,
    intensity: 0,
    state: "unknown",
    normalizedCoverage: null,
    layer1: {
      uniqueFollows: 0,
      totalFollows: safeTotalFollows,
      reachRatio: 0,
      attentionInverse: 0,
    },
    layer2: { interestScore: 0 },
  };
}

/**
 * Score a single talk. Pass the full `mentions` map (or null if no crawl
 * has run yet) — the function looks up the talk's mention internally so
 * callers don't have to encode "do we have crawl data" as a separate flag.
 *
 * Returns `unknown` state when:
 *   - mentions is null (crawl hasn't run)
 *   - followCount is non-finite or ≤ 0 (user has no follows OR a corrupted
 *     value snuck through — reach is undefined either way)
 *   - mention is absent (talk is out of crawl scope, e.g. no eventUri)
 *
 * Otherwise runs Layer 1 + computeLayer2 + the friend stub through
 * `combineLayers` with the given weights and active layer flags.
 */
export function scoreTalk(
  talk: TalkEntry,
  mentions: TalkMentions | null,
  followCount: number,
  interestVector: number[] | null,
  embeddings: Record<string, number[]>,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  active: ActiveLayers = DEFAULT_ACTIVE_LAYERS,
): TalkScore {
  if (mentions === null || !Number.isFinite(followCount) || followCount <= 0) {
    return unknownScore(talk.rkey, followCount);
  }
  const mention = mentions[talk.rkey];
  if (!mention) {
    return unknownScore(talk.rkey, followCount);
  }

  const layer1 = computeLayer1(mention, followCount);
  const layer2 = computeLayer2(talk, interestVector, embeddings);
  const layer3 = computeFriendStub(talk);
  const intensity = combineLayers(layer1, layer2, layer3, weights, active);

  const state: TalkScoreState =
    layer1.uniqueFollows === 0 ? "missed" : "engaged";

  return {
    rkey: talk.rkey,
    intensity,
    state,
    layer1,
    layer2,
    normalizedCoverage: null,
  };
}

const STATE_ORDER: Record<TalkScoreState, number> = {
  missed: 0,
  engaged: 1,
  unknown: 2,
};

function compareTalkScores(a: TalkScore, b: TalkScore): number {
  const stateDelta = STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (stateDelta !== 0) return stateDelta;
  const intensityDelta = b.intensity - a.intensity;
  if (intensityDelta !== 0) return intensityDelta;
  return a.rkey.localeCompare(b.rkey);
}

/**
 * Count the unique follows who engaged with *any* talk. Used as the
 * denominator for normalized intensity so the glow spread reflects the
 * actual conference-engaged subset of the user's network, not the full
 * follow list (which dilutes differences to near-zero).
 */
function engagedFollowCount(mentions: TalkMentions | null): number {
  if (!mentions) return 0;
  const seen = new Set<string>();
  for (const rkey in mentions) {
    for (const did of mentions[rkey].follows) {
      seen.add(did);
    }
  }
  return seen.size;
}

export function rankTalks(inputs: ScoringInputs): TalkScore[] {
  const {
    talks,
    mentions,
    followCount,
    interestVector = null,
    embeddings = {},
    weights = DEFAULT_WEIGHTS,
    active = DEFAULT_ACTIVE_LAYERS,
  } = inputs;

  const scores = talks.map((talk) =>
    scoreTalk(
      talk,
      mentions,
      followCount,
      interestVector,
      embeddings,
      weights,
      active,
    ),
  );

  // Normalize intensity: use "follows who discussed any talk" as the
  // denominator instead of total follows. This spreads glow across the
  // actual data range rather than clustering everything near 1.0.
  // Raw layer1 values are preserved for the UI detail strip; only
  // intensity (used for glow + sort) is recomputed via combineLayers.
  //
  // The stashed score.layer2 is reused here to avoid computing the same
  // cosine twice per talk (once above, once in this normalization pass).
  const engaged = engagedFollowCount(mentions);
  if (engaged > 0) {
    for (const score of scores) {
      if (score.state === "unknown") continue;
      const normalizedReach = Math.min(
        1,
        score.layer1.uniqueFollows / engaged,
      );
      const normalizedLayer1 = {
        ...score.layer1,
        reachRatio: normalizedReach,
        attentionInverse: 1 - normalizedReach,
        totalFollows: engaged,
      };
      score.normalizedCoverage = normalizedReach;
      score.intensity = combineLayers(
        normalizedLayer1,
        score.layer2,
        // TODO(#59): when #18 lands the real friendStub, swap this
        // cast for a stashed score.layer3 on TalkScore, mirroring the
        // layer2 stash pattern above. The cast works today only
        // because the stub does `void talk;` and never reads any
        // TalkEntry field — a real implementation would crash on the
        // undefined fields.
        computeFriendStub({ rkey: score.rkey } as TalkEntry),
        weights,
        active,
      );
    }
  }

  return scores.sort(compareTalkScores);
}
