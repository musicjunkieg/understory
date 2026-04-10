import { describe, it, expect } from "vitest";
import {
  combineLayers,
  DEFAULT_ACTIVE_LAYERS,
  type ActiveLayers,
} from "./combine";
import type { Layer1Result, ScoringWeights } from "./types";

const DEFAULT_WEIGHTS: ScoringWeights = {
  surpriseSlider: 0.5,
  friendsSlider: 0.5,
};

function l1(attentionInverse: number): Layer1Result {
  return {
    uniqueFollows: 0,
    totalFollows: 0,
    reachRatio: 1 - attentionInverse,
    attentionInverse,
  };
}

describe("combineLayers — DEFAULT_ACTIVE_LAYERS sentinel", () => {
  it("has both layers off by default", () => {
    expect(DEFAULT_ACTIVE_LAYERS).toEqual({ layer2: false, layer3: false });
  });
});

describe("combineLayers — Layer 1 only (today's deployment)", () => {
  const active: ActiveLayers = { layer2: false, layer3: false };

  it("returns layer1.attentionInverse for fully missed talk", () => {
    const result = combineLayers(
      l1(0.95),
      { interestScore: 0 },
      { friendBoost: 0, recommenders: [] },
      DEFAULT_WEIGHTS,
      active,
    );
    expect(result).toBeCloseTo(0.95, 6);
  });

  it("returns layer1.attentionInverse for partially engaged talk", () => {
    const result = combineLayers(
      l1(0.4),
      { interestScore: 0 },
      { friendBoost: 0, recommenders: [] },
      DEFAULT_WEIGHTS,
      active,
    );
    expect(result).toBeCloseTo(0.4, 6);
  });

  it("uses DEFAULT_ACTIVE_LAYERS when active arg omitted", () => {
    const result = combineLayers(
      l1(0.7),
      { interestScore: 1.0 }, // ignored — layer 2 is inactive
      { friendBoost: 1.0, recommenders: ["did:plc:x"] }, // ignored
      DEFAULT_WEIGHTS,
    );
    expect(result).toBeCloseTo(0.7, 6);
  });
});

describe("combineLayers — Layer 1 + Layer 2 (future stage)", () => {
  const active: ActiveLayers = { layer2: true, layer3: false };

  it("rescales weights to [0.5/0.8, 0.3/0.8] and reaches 1.0 at maximum", () => {
    // (1.0 * 0.5 + 1.0 * (1 - 0) * 0.3) / 0.8 = 0.8 / 0.8 = 1.0
    const result = combineLayers(
      l1(1.0),
      { interestScore: 1.0 },
      { friendBoost: 0, recommenders: [] },
      { surpriseSlider: 0, friendsSlider: 0.5 },
      active,
    );
    expect(result).toBeCloseTo(1.0, 6);
  });

  it("returns 0.625 for fully missed talk with no interest score", () => {
    // (1.0 * 0.5 + 0 * 0.5 * 0.3) / 0.8 = 0.5 / 0.8 = 0.625
    const result = combineLayers(
      l1(1.0),
      { interestScore: 0 },
      { friendBoost: 0, recommenders: [] },
      DEFAULT_WEIGHTS,
      active,
    );
    expect(result).toBeCloseTo(0.625, 6);
  });
});

describe("combineLayers — Layer 1 + Layer 3 (future stage)", () => {
  const active: ActiveLayers = { layer2: false, layer3: true };

  it("rescales weights to [0.5/0.7, 0.2/0.7]", () => {
    // (0 * 0.5 + 1.0 * 1 * 0.2) / 0.7 = 0.2 / 0.7 ≈ 0.2857
    const result = combineLayers(
      l1(0.0),
      { interestScore: 0 },
      { friendBoost: 1.0, recommenders: ["did:plc:a"] },
      { surpriseSlider: 0.5, friendsSlider: 1 },
      active,
    );
    expect(result).toBeCloseTo(0.2 / 0.7, 6);
  });
});

describe("combineLayers — all three layers active (final stage)", () => {
  const active: ActiveLayers = { layer2: true, layer3: true };

  it("matches the design-doc formula exactly at maximum", () => {
    // 1.0 * 0.5 + 1.0 * 1 * 0.3 + 1.0 * 1 * 0.2 = 1.0
    const result = combineLayers(
      l1(1.0),
      { interestScore: 1.0 },
      { friendBoost: 1.0, recommenders: ["did:plc:a"] },
      { surpriseSlider: 0, friendsSlider: 1 },
      active,
    );
    expect(result).toBeCloseTo(1.0, 6);
  });
});

describe("combineLayers — clamping and NaN guards", () => {
  it("clamps result to [0, 1] when slider drives raw above 1", () => {
    // surprise = -2 → (1 - (-2)) = 3 multiplier on l2
    // (1.0 * 0.5 + 1.0 * 3 * 0.3) / 0.8 = 1.4 / 0.8 = 1.75 → clamped to 1.0
    const result = combineLayers(
      l1(1.0),
      { interestScore: 1.0 },
      { friendBoost: 0, recommenders: [] },
      { surpriseSlider: -2, friendsSlider: 0.5 },
      { layer2: true, layer3: false },
    );
    expect(result).toBeCloseTo(1.0, 6);
  });

  it("coerces NaN slider to 0 (equivalent to surprise=0)", () => {
    // surprise=NaN → safe(NaN)=0 → (1.0 * 0.5 + 1.0 * 1 * 0.3) / 0.8 = 1.0
    const result = combineLayers(
      l1(1.0),
      { interestScore: 1.0 },
      { friendBoost: 0, recommenders: [] },
      { surpriseSlider: Number.NaN, friendsSlider: 0.5 },
      { layer2: true, layer3: false },
    );
    expect(result).toBeCloseTo(1.0, 6);
  });

  it("coerces ±Infinity to 0", () => {
    const result = combineLayers(
      l1(1.0),
      { interestScore: Number.POSITIVE_INFINITY },
      { friendBoost: Number.NEGATIVE_INFINITY, recommenders: [] },
      DEFAULT_WEIGHTS,
      { layer2: true, layer3: true },
    );
    // All non-finite stub values become 0; only L1 contributes.
    // (1.0 * 0.5 + 0 + 0) / 1.0 = 0.5
    expect(result).toBeCloseTo(0.5, 6);
  });
});

describe("combineLayers — REGRESSION: per-talk discontinuity bug", () => {
  // This test specifically locks in the correct behavior the renormalization
  // fix introduced. If a future refactor reintroduces a per-talk `> 0` branch
  // on stub outputs, this assertion will fail loudly.
  //
  // The bug: with a per-talk `> 0` check, two talks with identical Layer 1
  // (0.95) but different Layer 2 (0 vs 0.4) would rank as:
  //   Talk A (interest=0):   takes "stub-only" branch  → 0.95
  //   Talk B (interest=0.4): takes "weighted" branch   → 0.535
  // Talk B (the one user cares about per L2) ranks BELOW Talk A.
  it("ranks talk with positive interest score above identical-L1 talk with zero interest", () => {
    const active: ActiveLayers = { layer2: true, layer3: false };

    const intensityA = combineLayers(
      l1(0.95),
      { interestScore: 0.0 },
      { friendBoost: 0, recommenders: [] },
      DEFAULT_WEIGHTS,
      active,
    );

    const intensityB = combineLayers(
      l1(0.95),
      { interestScore: 0.4 },
      { friendBoost: 0, recommenders: [] },
      DEFAULT_WEIGHTS,
      active,
    );

    // Pre-computed expected values from spec §11.2:
    //   intensityA = (0.95*0.5 + 0.0*0.5*0.3) / 0.8 = 0.59375
    //   intensityB = (0.95*0.5 + 0.4*0.5*0.3) / 0.8 = 0.66875
    expect(intensityA).toBeCloseTo(0.59375, 6);
    expect(intensityB).toBeCloseTo(0.66875, 6);
    expect(intensityB).toBeGreaterThan(intensityA);
  });
});
