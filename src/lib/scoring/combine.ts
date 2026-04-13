import type { Layer1Result, ScoringWeights } from "./types";
import type { Layer2Result } from "./interest";
import type { FriendStubResult } from "./friendStub";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Coerce non-finite numeric inputs (NaN, ±Infinity) to 0. Defense in depth
 * against uninitialized React state or JSON-parsed nulls slipping past
 * TypeScript types and propagating into the sort key.
 */
function safe(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/**
 * Which scoring layers have a live data source. Layer 1 is always live;
 * Layers 2 and 3 flip to true when their respective implementations land
 * (#21–24 for Layer 2, #18 for Layer 3). Today both are false.
 */
export interface ActiveLayers {
  readonly layer2: boolean;
  readonly layer3: boolean;
}

// Frozen so the exported sentinel can't be mutated by accident — it's used
// as a default parameter value in combineLayers/scoreTalk/rankTalks, so any
// mutation would corrupt every subsequent call that takes the default.
export const DEFAULT_ACTIVE_LAYERS: Readonly<ActiveLayers> = Object.freeze({
  layer2: false,
  layer3: false,
});

/**
 * Design-doc weights from `docs/understory-design.md` §"The Scoring Algorithm".
 * These values are the canonical contribution shares when all three layers
 * are live; they are rescaled in `combineLayers` for partial deployments.
 */
const DESIGN_WEIGHTS = {
  layer1: 0.5,
  layer2: 0.3,
  layer3: 0.2,
} as const;

/**
 * Combine the three layers into a 0–1 intensity score.
 *
 * Per the design doc:
 *   final = (attention_inverse * 0.5)
 *         + (interest_score * (1 - surprise_slider) * 0.3)
 *         + (friend_boost * friends_slider * 0.2)
 *
 * Weights are rescaled over the active layer set so the maximum achievable
 * intensity is always 1.0:
 *   - Today (layer 1 only): w1 = 0.5/0.5 = 1.0 → intensity == attentionInverse
 *   - Layer 1 + 2:          w1 = 0.5/0.8, w2 = 0.3/0.8 (sum = 1.0)
 *   - Layer 1 + 3:          w1 = 0.5/0.7, w3 = 0.2/0.7 (sum = 1.0)
 *   - All three:            w1 = 0.5, w2 = 0.3, w3 = 0.2 (already sum to 1.0)
 *
 * Stubs are still consulted when their layer is inactive, but their values
 * are multiplied by a zero weight — so swapping a stub for a real
 * implementation is purely a data change once the active flag flips.
 */
export function combineLayers(
  layer1: Layer1Result,
  layer2: Layer2Result,
  layer3: FriendStubResult,
  weights: ScoringWeights,
  active: ActiveLayers = DEFAULT_ACTIVE_LAYERS,
): number {
  const w1 = DESIGN_WEIGHTS.layer1;
  const w2 = active.layer2 ? DESIGN_WEIGHTS.layer2 : 0;
  const w3 = active.layer3 ? DESIGN_WEIGHTS.layer3 : 0;
  const total = w1 + w2 + w3; // always > 0 because layer 1 is always live

  const l1 = safe(layer1.attentionInverse);
  const l2 = active.layer2 ? safe(layer2.interestScore) : 0;
  const l3 = active.layer3 ? safe(layer3.friendBoost) : 0;
  const surprise = safe(weights.surpriseSlider);
  const friends = safe(weights.friendsSlider);

  const raw =
    l1 * w1 +
    l2 * (1 - surprise) * w2 +
    l3 * friends * w3;

  return clamp(raw / total, 0, 1);
}
