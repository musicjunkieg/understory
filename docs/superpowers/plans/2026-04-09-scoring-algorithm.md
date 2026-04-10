# Layer 1 Scoring Algorithm Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Layer 1 (network attention, inverted) scoring layer of Understory's three-layer scoring engine, with Vitest unit tests, stub interfaces for Layers 2 and 3, and a deployment-level `ActiveLayers` flag that rescales weights for partial layer rollouts.

**Architecture:** Pure-function TypeScript module under `src/lib/scoring/`. No React, no fetch, no globals. Consumes the existing `TalkMentions` shape from `src/lib/crawl/types.ts` and `TalkEntry` from `src/lib/types.ts`. Test-driven throughout — every function is written test-first with the precise numeric assertions from the spec.

**Tech Stack:** TypeScript 5, Vitest, vite-tsconfig-paths. Project is Next.js 16 / React 19 but the scoring module itself is framework-agnostic.

**Spec:** `docs/superpowers/specs/2026-04-09-scoring-algorithm.md`

**Chainlink Issue:** #19

**Branch convention:** Work on `feat/scoring-algorithm` branched from `main`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Add `vitest`, `vite-tsconfig-paths` devDeps; add `test` and `test:watch` scripts |
| `vitest.config.ts` | Create | Vitest config with path-alias plugin |
| `src/lib/scoring/types.ts` | Create | `TalkScore`, `TalkScoreState`, `Layer1Result`, `ScoringWeights`, `ScoringInputs`, `DEFAULT_WEIGHTS`, re-export `ActiveLayers` |
| `src/lib/scoring/networkAttention.ts` | Create | Layer 1 — `computeLayer1` |
| `src/lib/scoring/networkAttention.test.ts` | Create | Unit tests for `computeLayer1` |
| `src/lib/scoring/interestStub.ts` | Create | Layer 2 stub — `computeInterestStub` |
| `src/lib/scoring/friendStub.ts` | Create | Layer 3 stub — `computeFriendStub` |
| `src/lib/scoring/combine.ts` | Create | `combineLayers`, `ActiveLayers`, `DEFAULT_ACTIVE_LAYERS`, `safe`, `clamp` |
| `src/lib/scoring/combine.test.ts` | Create | Unit tests for `combineLayers` including the per-talk discontinuity regression test |
| `src/lib/scoring/rank.ts` | Create | `scoreTalk`, `rankTalks`, `unknownScore`, `compareTalkScores` |
| `src/lib/scoring/rank.test.ts` | Create | Unit tests for `scoreTalk` and `rankTalks` |
| `src/lib/scoring/index.ts` | Create | Re-exports for the public surface |

---

## Chunk 1: Test infrastructure + types

### Task 1: Add Vitest and vite-tsconfig-paths to the project

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/scoring-algorithm
```

- [ ] **Step 2: Install dev dependencies**

Run: `npm install --save-dev vitest vite-tsconfig-paths`

Expected: `package.json` and `package-lock.json` updated. New `node_modules/vitest` and `node_modules/vite-tsconfig-paths` directories.

- [ ] **Step 3: Add test scripts to package.json**

Use npm's tooling to insert the scripts non-destructively (preserves any other scripts that might have been added since this plan was written):

```bash
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
```

Verify with: `cat package.json | grep -A 10 '"scripts"'` — should show `test` and `test:watch` alongside the existing `dev`, `build`, `start`, `lint`, `transcribe`, `build-talk-index` scripts.

- [ ] **Step 4: Create `vitest.config.ts` at the repo root**

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 5: Verify Vitest finds zero tests cleanly**

Run: `npm test`
Expected: Exits 0 with output like "No test files found" — proves Vitest is wired up correctly even though we have nothing to test yet.

- [ ] **Step 6: Verify tsc and eslint still pass**

Run in parallel:
- `npx tsc --noEmit` — Expected: clean
- `npx eslint src/` — Expected: clean

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest + vite-tsconfig-paths for unit testing"
```

---

### Task 2: Create the types module

**Files:**
- Create: `src/lib/scoring/types.ts`

- [ ] **Step 1: Create the directory**

Run: `mkdir -p src/lib/scoring`

- [ ] **Step 2: Write the types module**

Create `src/lib/scoring/types.ts`:

```ts
import type { TalkEntry } from "@/lib/types";
import type { TalkMention, TalkMentions } from "@/lib/crawl/types";
// Local-import-then-re-export so we get a usable local binding for ScoringInputs
// AND re-export the type so callers can `import { ActiveLayers } from "@/lib/scoring/types"`
// without needing to know combine.ts owns it. combine.ts doesn't exist yet
// — this import will resolve once Task 6 lands.
import type { ActiveLayers } from "./combine";
export type { ActiveLayers };

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
  layer2?: { interestScore: number };
  layer3?: { friendBoost: number; recommenders: string[] };
}

export interface ScoringWeights {
  surpriseSlider: number;    // 0–1; controls Layer 2 contribution (high = serendipity)
  friendsSlider: number;     // 0–1; controls Layer 3 contribution (high = friends override)
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  surpriseSlider: 0.5,
  friendsSlider: 0.5,
};

export interface ScoringInputs {
  talks: TalkEntry[];
  mentions: TalkMentions | null;  // null = crawl not yet completed
  followCount: number;            // from CrawlResult.followCount
  weights?: ScoringWeights;
  active?: ActiveLayers;          // omitted = layer 1 only (today's deployment)
}

// Re-export TalkMention for downstream consumers that import only from
// scoring/types — saves them having to know about the crawl module.
export type { TalkMention, TalkMentions };
```

- [ ] **Step 3: Confirm it does NOT compile yet**

Run: `npx tsc --noEmit`
Expected: TypeScript errors about `./combine` not existing. This is correct — we'll fix it in Task 7. Note the exact error so you can verify it disappears later.

> **Note:** We are intentionally writing types.ts before combine.ts. The forward reference is normal for TypeScript projects with cyclic type-only dependencies. Do NOT commit this file standalone — it will land together with combine.ts in a single commit at the end of Chunk 2.

---

## Chunk 2: Layer 1 + stubs + combine (the math)

### Task 3: Layer 1 — `computeLayer1` (test first)

**Files:**
- Create: `src/lib/scoring/networkAttention.test.ts`
- Create: `src/lib/scoring/networkAttention.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/scoring/networkAttention.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeLayer1 } from "./networkAttention";
import type { TalkMention } from "@/lib/crawl/types";

// Build a TalkMention with `n` distinct follow DIDs.
// Note: this is "follows engaged with this talk", NOT the user's total
// follow count — that's passed separately as the second arg to computeLayer1.
function makeMention(n: number): TalkMention {
  const follows = Array.from({ length: n }, (_, i) => `did:plc:f${i}`);
  return {
    count: n,
    follows,
    posts: [],
    rsvps: [],
  };
}

describe("computeLayer1", () => {
  it("returns attentionInverse 1.0 when zero follows engaged", () => {
    const result = computeLayer1(makeMention(0), 100);
    expect(result.uniqueFollows).toBe(0);
    expect(result.totalFollows).toBe(100);
    expect(result.reachRatio).toBeCloseTo(0, 6);
    expect(result.attentionInverse).toBeCloseTo(1.0, 6);
  });

  it("returns attentionInverse 0.5 when half engaged", () => {
    const result = computeLayer1(makeMention(50), 100);
    expect(result.reachRatio).toBeCloseTo(0.5, 6);
    expect(result.attentionInverse).toBeCloseTo(0.5, 6);
  });

  it("returns attentionInverse 0.0 when fully engaged", () => {
    const result = computeLayer1(makeMention(100), 100);
    expect(result.reachRatio).toBeCloseTo(1.0, 6);
    expect(result.attentionInverse).toBeCloseTo(0.0, 6);
  });

  it("returns attentionInverse 1.0 when followCount is 0 (divide-by-zero guard)", () => {
    const result = computeLayer1(makeMention(3), 0);
    expect(result.reachRatio).toBeCloseTo(0, 6);
    expect(result.attentionInverse).toBeCloseTo(1.0, 6);
  });

  it("clamps reachRatio to 1 when stale data has more follows than followCount", () => {
    const result = computeLayer1(makeMention(110), 100);
    expect(result.reachRatio).toBeCloseTo(1.0, 6);
    expect(result.attentionInverse).toBeCloseTo(0.0, 6);
  });

  it("treats undefined mention as zero engagement", () => {
    const result = computeLayer1(undefined, 100);
    expect(result.uniqueFollows).toBe(0);
    expect(result.attentionInverse).toBeCloseTo(1.0, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- networkAttention`
Expected: FAIL — "Cannot find module './networkAttention'" or similar import error.

- [ ] **Step 3: Implement `computeLayer1`**

Create `src/lib/scoring/networkAttention.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- networkAttention`
Expected: PASS — 6 tests passing in `networkAttention.test.ts`.

> **Note:** This works because Vitest/esbuild elides the `import type ... from "./combine"` and `export type { ActiveLayers }` lines in `types.ts` at transpile time (they're type-only constructs, erased before runtime resolution). If the test run instead fails with `Cannot find module './combine'`, that means esbuild is *not* erasing the type re-export. Workaround: temporarily comment out both the `import type { ActiveLayers } from "./combine";` and `export type { ActiveLayers };` lines in `types.ts`, plus change `active?: ActiveLayers;` to `active?: unknown;` in `ScoringInputs`. Re-run the test, then restore all three before Task 6 commits.

> **Do NOT commit yet.** This file imports from `./types`, which itself imports from `./combine`. Both will land together at the end of Chunk 2 once `combine.ts` exists.

---

### Task 4: Layer 2 stub — `computeInterestStub`

**Files:**
- Create: `src/lib/scoring/interestStub.ts`

- [ ] **Step 1: Write the stub**

Create `src/lib/scoring/interestStub.ts`:

```ts
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
export function computeInterestStub(_talk: TalkEntry): InterestStubResult {
  return { interestScore: 0 };
}
```

- [ ] **Step 2: Verify ESLint accepts the `_talk` parameter convention**

Run: `npx eslint src/lib/scoring/interestStub.ts`
Expected: clean. If ESLint emits `@typescript-eslint/no-unused-vars` for `_talk`, the project's Next.js preset isn't configuring `argsIgnorePattern: "^_"`. Two recovery options:
1. Rewrite the body to consume the param: change to `export function computeInterestStub(talk: TalkEntry): InterestStubResult { void talk; return { interestScore: 0 }; }`
2. Add the rule override to `eslint.config.mjs`.

> **No test file.** A stub that returns a literal constant doesn't need its own test — its behavior is exercised end-to-end by the `combineLayers` and `scoreTalk` tests in later tasks.

---

### Task 5: Layer 3 stub — `computeFriendStub`

**Files:**
- Create: `src/lib/scoring/friendStub.ts`

- [ ] **Step 1: Write the stub**

Create `src/lib/scoring/friendStub.ts`:

```ts
import type { TalkEntry } from "@/lib/types";

export interface FriendStubResult {
  friendBoost: number;
  recommenders: string[];
}

/**
 * Layer 3 stub. Returns 0 until the following issues land:
 *   - #18: friend recommendation reader
 *   - #5:  publish lexicons
 *
 * When implemented, this should return the normalized sum of friend
 * recommendation intensities (1–3 each, capped at a sensible max) and the
 * DIDs of the recommending follows.
 */
export function computeFriendStub(_talk: TalkEntry): FriendStubResult {
  return { friendBoost: 0, recommenders: [] };
}
```

---

### Task 6: Combine logic — `combineLayers` (test first)

**Files:**
- Create: `src/lib/scoring/combine.test.ts`
- Create: `src/lib/scoring/combine.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/scoring/combine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- combine`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `combineLayers`**

Create `src/lib/scoring/combine.ts`:

```ts
import type { Layer1Result, ScoringWeights } from "./types";
import type { InterestStubResult } from "./interestStub";
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
  layer2: boolean;
  layer3: boolean;
}

export const DEFAULT_ACTIVE_LAYERS: ActiveLayers = {
  layer2: false,
  layer3: false,
};

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
  layer2: InterestStubResult,
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- combine`
Expected: PASS — all combine tests green, including the regression test.

- [ ] **Step 5: Run the Layer 1 tests too — the type chain now resolves**

Run: `npm test -- networkAttention`
Expected: PASS — 6 tests in `networkAttention.test.ts`.

- [ ] **Step 6: Verify tsc and eslint are clean**

Run in parallel:
- `npx tsc --noEmit` — Expected: clean (the forward `./combine` reference from `types.ts` now resolves)
- `npx eslint src/` — Expected: clean

- [ ] **Step 7: Commit Chunk 2**

```bash
git add src/lib/scoring/types.ts \
        src/lib/scoring/networkAttention.ts \
        src/lib/scoring/networkAttention.test.ts \
        src/lib/scoring/interestStub.ts \
        src/lib/scoring/friendStub.ts \
        src/lib/scoring/combine.ts \
        src/lib/scoring/combine.test.ts
git commit -m "feat(scoring): add Layer 1, layer 2/3 stubs, combine logic with ActiveLayers

Includes the regression test for the per-talk discontinuity bug — see
docs/superpowers/specs/2026-04-09-scoring-algorithm.md §8.1."
```

---

## Chunk 3: Public API + index

### Task 7: `scoreTalk` and `rankTalks` (test first)

**Files:**
- Create: `src/lib/scoring/rank.test.ts`
- Create: `src/lib/scoring/rank.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/scoring/rank.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scoreTalk, rankTalks } from "./rank";
import type { TalkEntry } from "@/lib/types";
import type { TalkMention, TalkMentions } from "@/lib/crawl/types";
import type { ActiveLayers } from "./combine";

function makeTalk(rkey: string, overrides: Partial<TalkEntry> = {}): TalkEntry {
  return {
    rkey,
    title: `Talk ${rkey}`,
    vodUri: `at://example/${rkey}`,
    vodCid: "bafy",
    hlsUrl: "",
    durationMs: 0,
    createdAt: "",
    eventUri: `at://event/${rkey}`,
    description: null,
    speakers: [],
    room: null,
    talkType: null,
    category: null,
    startsAt: null,
    endsAt: null,
    transcriptFile: null,
    ...overrides,
  };
}

// Build a TalkMention with `n` distinct follow DIDs (engaged follows for
// this talk, NOT the user's total follow count — that's a separate arg).
function makeMention(n: number): TalkMention {
  const follows = Array.from({ length: n }, (_, i) => `did:plc:f${i}`);
  return {
    count: n,
    follows,
    posts: [],
    rsvps: [],
  };
}

describe("scoreTalk — state derivation", () => {
  const talk = makeTalk("a");

  it("returns unknown when mentions is null", () => {
    const score = scoreTalk(talk, null, 100);
    expect(score.state).toBe("unknown");
    expect(score.intensity).toBe(0);
  });

  it("returns unknown when followCount is 0", () => {
    const score = scoreTalk(talk, { a: makeMention(5) }, 0);
    expect(score.state).toBe("unknown");
  });

  it("returns unknown when the talk has no mention entry (out of crawl scope)", () => {
    const score = scoreTalk(talk, {}, 100);
    expect(score.state).toBe("unknown");
  });

  it("returns missed when uniqueFollows is 0 but talk is in scope", () => {
    const score = scoreTalk(talk, { a: makeMention(0) }, 100);
    expect(score.state).toBe("missed");
    expect(score.intensity).toBeCloseTo(1.0, 6);
  });

  it("returns engaged when at least one follow engaged", () => {
    const score = scoreTalk(talk, { a: makeMention(3) }, 100);
    expect(score.state).toBe("engaged");
    expect(score.intensity).toBeCloseTo(0.97, 6);
  });
});

describe("scoreTalk — defaults", () => {
  const talk = makeTalk("a");
  const mentions: TalkMentions = { a: makeMention(0) };

  it("uses both DEFAULT_WEIGHTS and DEFAULT_ACTIVE_LAYERS when both omitted", () => {
    const score = scoreTalk(talk, mentions, 100);
    expect(score.intensity).toBeCloseTo(1.0, 6);
  });

  it("uses DEFAULT_ACTIVE_LAYERS when active omitted but explicit weights supplied", () => {
    const score = scoreTalk(talk, mentions, 100, {
      surpriseSlider: 0.25,
      friendsSlider: 0.75,
    });
    // active defaults to both-off → L1-only branch → weights don't enter
    // the math at all → intensity == layer1.attentionInverse == 1.0
    expect(score.intensity).toBeCloseTo(1.0, 6);
  });

  it("uses DEFAULT_WEIGHTS when weights omitted but explicit active supplied", () => {
    const score = scoreTalk(talk, mentions, 100, undefined, {
      layer2: true,
      layer3: false,
    });
    // L1+L2 active, L2 stub returns 0, default surprise=0.5
    // (1.0*0.5 + 0*0.5*0.3) / 0.8 = 0.625
    expect(score.intensity).toBeCloseTo(0.625, 6);
  });
});

describe("rankTalks — sort order", () => {
  const A = makeTalk("aaa");
  const B = makeTalk("bbb");
  const C = makeTalk("ccc");
  const D = makeTalk("ddd");
  const E = makeTalk("eee");

  it("sorts missed first, then engaged (intensity desc), then unknown", () => {
    const mentions: TalkMentions = {
      aaa: makeMention(1),   // engaged, intensity 0.99
      bbb: makeMention(0),   // missed,  intensity 1.0
      ccc: makeMention(50),  // engaged, intensity 0.5
      // D, E: no mentions → unknown
    };
    const result = rankTalks({
      talks: [A, B, C, D, E],
      mentions,
      followCount: 100,
    });

    expect(result.map((s) => s.rkey)).toEqual(["bbb", "aaa", "ccc", "ddd", "eee"]);
  });

  it("uses rkey ascending as a deterministic tiebreak", () => {
    const Z = makeTalk("zzz");
    const A = makeTalk("aaa");
    const mentions: TalkMentions = {
      zzz: makeMention(0),
      aaa: makeMention(0),
    };
    const result = rankTalks({
      talks: [Z, A], // intentionally not in rkey order
      mentions,
      followCount: 100,
    });

    // Both missed with intensity 1.0; tiebreak puts "aaa" before "zzz"
    expect(result[0].rkey).toBe("aaa");
    expect(result[1].rkey).toBe("zzz");
  });

  it("threads weights and active flags through to combineLayers", () => {
    const active: ActiveLayers = { layer2: true, layer3: false };
    const mentions: TalkMentions = { aaa: makeMention(0) };
    const result = rankTalks({
      talks: [A],
      mentions,
      followCount: 100,
      active,
    });
    // L1 only contributes; L2 stub returns 0; rescale: 0.5/0.8 = 0.625
    expect(result[0].intensity).toBeCloseTo(0.625, 6);
  });
});

describe("rankTalks — empty / degenerate inputs", () => {
  it("returns [] for empty talks array", () => {
    const result = rankTalks({
      talks: [],
      mentions: {},
      followCount: 100,
    });
    expect(result).toEqual([]);
  });

  it("returns all unknown sorted by rkey when mentions is null", () => {
    const result = rankTalks({
      talks: [makeTalk("ccc"), makeTalk("aaa"), makeTalk("bbb")],
      mentions: null,
      followCount: 100,
    });
    expect(result.map((s) => s.state)).toEqual(["unknown", "unknown", "unknown"]);
    expect(result.map((s) => s.rkey)).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("returns all unknown when followCount is 0", () => {
    const result = rankTalks({
      talks: [makeTalk("aaa"), makeTalk("bbb"), makeTalk("ccc")],
      mentions: {
        aaa: makeMention(5),
        bbb: makeMention(10),
        ccc: makeMention(0),
      },
      followCount: 0,
    });
    expect(result.map((s) => s.state)).toEqual(["unknown", "unknown", "unknown"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- rank`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scoreTalk` and `rankTalks`**

Create `src/lib/scoring/rank.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- rank`
Expected: PASS — all rank tests green.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all scoring tests across networkAttention, combine, and rank.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scoring/rank.ts src/lib/scoring/rank.test.ts
git commit -m "feat(scoring): add scoreTalk + rankTalks public API"
```

---

### Task 8: Index re-exports

**Files:**
- Create: `src/lib/scoring/index.ts`

- [ ] **Step 1: Write the index file**

Create `src/lib/scoring/index.ts`:

```ts
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
```

- [ ] **Step 2: Verify tsc and eslint are clean**

Run in parallel:
- `npx tsc --noEmit` — Expected: clean. This compiles the whole project including `index.ts`, which type-checks every public re-export and would catch any name typos or missing exports.
- `npx eslint src/` — Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/scoring/index.ts
git commit -m "feat(scoring): add public index re-exports"
```

Note: the renumbering above is intentional — Step 3 is the commit because the smoke check that was previously here turned out to be unworkable in a sandboxed environment AND would have disabled `tsconfig.json` path-alias resolution if it had run. The Task 9 full-project `npx tsc --noEmit` already exercises every re-export through `index.ts`.

---

## Chunk 4: Final verification

### Task 9: Lint, type check, build, full test pass

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All scoring tests pass. Note the test count and timing for the PR description.

- [ ] **Step 2: Run the linter**

Run: `npx eslint src/`
Expected: clean. Fix any issues found.

- [ ] **Step 3: Run the type checker**

Run: `npx tsc --noEmit`
Expected: clean. Fix any errors.

- [ ] **Step 4: Run the production build**

Run: `npm run build`
Expected: build succeeds with no new bundle warnings. Confirm in the route listing that `/api/crawl` still appears with the dynamic route indicator (`ƒ`), not the static one (`○`). The set of listed routes should be unchanged from before this PR — if a previously dynamic route flipped to static (or vice versa), investigate before proceeding.

- [ ] **Step 5: Smoke check that scoring isn't accidentally imported by a server route**

The scoring module is intended for client-side use. Use the Grep tool (NOT raw `grep` and NOT `npx grep`, neither of which match this project's tooling conventions) to search for any imports of `@/lib/scoring` under `src/app/api/`:

- Pattern: `from ["']@/lib/scoring`
- Path: `src/app/api/`
- Expected: zero matches. If you find any, double-check whether the API route actually needs scoring (it shouldn't for this issue) — scoring is pure functions so it would technically work server-side, but no consumer in scope for #19 should import it.

- [ ] **Step 6: Commit any fixes from this task**

If any of the verification steps surfaced issues that needed fixing:

```bash
git add src/lib/scoring/...
git commit -m "fix(scoring): resolve issues from final verification"
```

If everything was already clean, no commit is needed for this task.

---

### Task 10: Wrap up

- [ ] **Step 1: Summary check**

Confirm all tasks 1–9 are checked off above. The final state of `src/lib/scoring/` should contain:

```
src/lib/scoring/
├── combine.ts
├── combine.test.ts
├── friendStub.ts
├── index.ts
├── interestStub.ts
├── networkAttention.ts
├── networkAttention.test.ts
├── rank.ts
├── rank.test.ts
└── types.ts
```

10 files total. 3 test files + 6 source files + 1 index.

- [ ] **Step 2: Use the finishing-a-development-branch skill**

Invoke `superpowers:finishing-a-development-branch` to verify tests, present merge options, and execute the chosen workflow.
