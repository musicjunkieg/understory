# Layer 1 Scoring Algorithm Spec

**Date:** 2026-04-09
**Issue:** Chainlink #19
**Status:** Approved (pending review)
**Depends on:** PR #5 (social graph crawler — merged)
**Unblocks:** #10 (network attention display), #12 (personalized feed page), #20 (slider UI)

---

## 1. Goal

Implement the Layer 1 (network attention, inverted) scoring layer of Understory's three-layer scoring engine, with stub interfaces for Layers 2 (interest similarity) and 3 (friend recommendations) so they can plug in later without touching the combine logic.

The output is a `TalkScore` per talk: a 0–1 intensity value that the UI uses for ranking and bioluminescent glow, plus a three-state classifier (`engaged | missed | unknown`) so the UI can distinguish "your network missed this" from "we don't know."

This is the keystone that turns the crawler's `TalkMentions` into something the UI can render. It is purely client-side TypeScript — no API routes, no fetches, no React coupling.

---

## 2. Background

The crawler in `src/lib/crawl/` returns a `TalkMentions` map per authenticated user, keyed by talk rkey:

```ts
interface TalkMention {
  count: number;        // unique follows engaged (RSVPs ∪ posters)
  follows: string[];    // DIDs of those follows
  posts: string[];      // URIs of every matching post (a single follow may post multiple)
  rsvps: string[];      // DIDs of follows who RSVPed (subset of follows)
}
```

The full scoring algorithm in `docs/understory-design.md` §"The Scoring Algorithm" describes a three-layer engine combining network attention (inverted), interest similarity (cosine of user/talk embeddings), and friend recommendation overrides:

```
final_score = (attention_inverse * 0.5)
            + (effective_interest * 0.3)
            + (friend_boost * friends_slider * 0.2)
```

Layers 2 and 3 require data from issues that don't exist yet:

- **Layer 2** needs `topicIndex` records: blocked on #21 (transcript embeddings), #22 (publish topicIndex), #23 (user interest profiling), #24 (cosine similarity matching).
- **Layer 3** needs friend recommendation reading: blocked on #18 (friend rec reader) and #5 (publish lexicons).

This spec implements Layer 1 fully and stubs the other two, with a renormalization rule so the score stays interpretable while only Layer 1 has real data.

---

## 3. Architecture

### 3.1 File layout

```
src/lib/scoring/
├── types.ts             Shared types (TalkScore, ScoringWeights, etc.)
├── networkAttention.ts  Layer 1 — pure functions
├── interestStub.ts      Layer 2 stub (returns 0)
├── friendStub.ts        Layer 3 stub (returns 0)
├── combine.ts           Weighted combine + renormalization
├── rank.ts              Public API: scoreTalk() and rankTalks()
└── index.ts             Re-exports
```

Pure functions throughout. No React, no fetch, no globals. The module is downstream of the crawler — it operates only on data already passed in. This makes it trivially testable, memo-friendly across slider changes, and SSR-safe.

A future React hook (`useTalkScores`, built in #12 or #20) will wrap these functions, fetch `/api/crawl`, and feed the result into `rankTalks`. That hook is **not** part of this spec.

### 3.2 Data flow

```
Server-side                         Client-side
─────────────                       ─────────────
data/talks.json   ──┐
                    ├──► /api/crawl ──► TalkMentions ──┐
session.agent     ──┘                                  │
                                                       ▼
                       talks (fetched alongside) + mentions + weights
                                                       │
                                                       ▼
                                                 rankTalks()
                                                       │
                                                       ▼
                                                  TalkScore[] (sorted)
                                                       │
                                                       ▼
                                            Feed page / glow / sliders
```

---

## 4. Types

```ts
// src/lib/scoring/types.ts
import type { TalkEntry } from "@/lib/types";
import type { TalkMention, TalkMentions } from "@/lib/crawl/types";
// `ActiveLayers` is declared in combine.ts (see §8) and re-exported here so
// call sites don't have to know its origin module.
export type { ActiveLayers } from "./combine";

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

export interface ScoringInputs {
  talks: TalkEntry[];
  mentions: TalkMentions | null;  // null = crawl not yet completed
  followCount: number;            // from CrawlResult.followCount
  weights?: ScoringWeights;
  active?: ActiveLayers;          // omitted = layer 1 only (today's deployment)
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  surpriseSlider: 0.5,
  friendsSlider: 0.5,
};
```

`mentions` may be `null` so the talk page can render before a crawl has completed (everything will be `unknown`). `weights` is optional with sensible defaults.

---

## 5. Layer 1 — Network Attention (inverted)

### 5.1 Raw signal

We count **unique follows** who engaged with a talk. A follow may have RSVPed via Constellation, posted about it via Bluesky search, or both — they still count as one. Multiple posts from the same follow do not stack.

> **Design principle:** Unique voices over engagement volume. One person posting the same thing repeatedly doesn't tell you anything new — it's noise, not signal. This is the inverse of algorithmic feed dynamics that reward the loudest voice in a room, which is exactly what Understory is built to invert.

The crawler already de-duplicates by follow in `TalkMention.follows`, so the raw signal is:

```ts
const uniqueFollows = mention.follows.length;
```

### 5.2 Normalization

The score is normalized as a **reach ratio** — the fraction of the user's follows who engaged with the talk. This is interpretable, comparable across users, and stable:

```ts
const reachRatio = followCount > 0 ? uniqueFollows / followCount : 0;
const attentionInverse = 1 - reachRatio;
```

> "0.95" literally means "95% of the people you follow didn't talk about this."

### 5.3 The function

```ts
// src/lib/scoring/networkAttention.ts
import type { TalkMention } from "@/lib/crawl/types";
import type { Layer1Result } from "./types";

export function computeLayer1(
  mention: TalkMention | undefined,
  followCount: number,
): Layer1Result {
  const uniqueFollows = mention?.follows.length ?? 0;
  // Clamp to [0, 1]: uniqueFollows can theoretically exceed followCount if a
  // CrawlResult is reused after the user's follow list changes (someone
  // unfollowed but still appears in the cached mentions). The clamp prevents
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

> **Implementation note:** We use `mention.follows.length` rather than `mention.count` so the algorithm is robust to a future crawler change that decouples the two (e.g., if `count` ever starts including non-follow signals). Today the crawler enforces `count === follows.length`.

---

## 6. State derivation

The three-state classifier separates "missed" from "unknown" so the UI can render them distinctly. The mapping is **evaluated in order; first match wins**:

| Order | Condition                | State     | Notes                                      |
|-------|--------------------------|-----------|--------------------------------------------|
| 1     | `mentions` is `null`     | `unknown` | Crawl has not yet run                      |
| 2     | `followCount === 0`      | `unknown` | User has zero follows; reach is undefined  |
| 3     | `mention === undefined`  | `unknown` | Talk not in crawl scope (e.g. no eventUri) |
| 4     | `uniqueFollows === 0`    | `missed`  | Network missed it — full glow              |
| 5     | `uniqueFollows > 0`      | `engaged` | Network engaged with it — fade             |

Order matters: rows 1 and 2 must come before row 4, otherwise a user with zero follows would have every in-scope talk classified as `missed` (since `uniqueFollows === 0` is trivially true), polluting the feed with bogus full-glow entries. Conflating "unknown" with "missed" would either light up false positives (a talk the crawler couldn't see glows as if missed) or hide talks entirely (filtering unknowns drops talks the user might still want). Three-state preserves honesty.

---

## 7. Layer 2 + Layer 3 stubs

Both stubs return zero contributions so they don't affect Layer 1's intensity. They exist to lock the public API shape and the combine math so layers 2 and 3 can be filled in later by their respective issues without changing call sites.

```ts
// src/lib/scoring/interestStub.ts
import type { TalkEntry } from "@/lib/types";

export interface InterestStubResult {
  interestScore: number;
}

/**
 * Layer 2 stub. Returns 0 until issues #21–24 land:
 * - #21: generate transcript embeddings
 * - #22: publish topicIndex records
 * - #23: user interest profiling
 * - #24: cosine similarity matching
 *
 * When implemented, this should return cosine similarity in [0, 1] between
 * the user's recent-post embedding and the talk's topicIndex embedding.
 */
export function computeInterestStub(_talk: TalkEntry): InterestStubResult {
  return { interestScore: 0 };
}
```

```ts
// src/lib/scoring/friendStub.ts
import type { TalkEntry } from "@/lib/types";

export interface FriendStubResult {
  friendBoost: number;
  recommenders: string[];
}

/**
 * Layer 3 stub. Returns 0 until issue #18 (friend recommendation reader)
 * and #5 (publish lexicons) land. When implemented, this should return the
 * normalized sum of friend recommendation intensities (1–3 each, capped at
 * a sensible max) and the DIDs of the recommending follows.
 */
export function computeFriendStub(_talk: TalkEntry): FriendStubResult {
  return { friendBoost: 0, recommenders: [] };
}
```

The leading underscore on `_talk` is the project convention for unused parameters; ESLint allows it.

---

## 8. Combine + intensity

The combine logic must handle three deployment stages: today (only Layer 1 has real data), the intermediate stage where one of Layers 2/3 has shipped but the other hasn't, and the final stage with all three layers live. We need two invariants across every stage:

1. **Maximum achievable intensity is always 1.0.** A "fully missed by everyone in your network" talk should glow at full strength regardless of which layers are deployed. Otherwise the bioluminescent UI visibly dims sitewide every time we ship a new layer.
2. **Within a single deployment stage, no per-talk discontinuities.** Two talks with identical Layer 1 scores must rank in the same order they would under any other interpretation of Layers 2/3 — e.g., a talk the user is interested in must never rank below an identical-Layer-1 talk the user *isn't* interested in just because Layer 2 happens to return 0 for one of them.

A naive runtime `> 0` check on stub outputs violates both invariants: per-talk branching corrupts ordering at the activation boundary, and the design-doc weights `(0.5, 0.3, 0.2)` only sum to 1.0 when all three layers contribute, so partial deployments cap intensity below 1.0.

The correct abstraction is a **deployment-level `ActiveLayers` flag** that selects which layers are live, with weights rescaled to sum to 1.0 over the active set. Stub outputs are still ignored (multiplied by zero weight) when their layer is inactive, but they no longer drive control flow.

```ts
// src/lib/scoring/combine.ts
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

  // Defensive: coerce non-finite slider/score values to 0 so a stray NaN
  // can't propagate into the sort key. Caller is still responsible for
  // sane slider input; this is a last-resort guard.
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

### 8.1 Why per-talk discontinuities are catastrophic

To make the trap concrete: with the per-talk `> 0` check, after Layer 2 ships, two talks with identical Layer 1 scores would rank as:

| Talk | layer1.attentionInverse | layer2.interestScore | branch | intensity |
|---|---|---|---|---|
| A | 0.95 | 0.0 | "stub-only" → returns layer 1 | **0.95** |
| B | 0.95 | 0.4 | "weighted"  → applies design weights | 0.95·0.5 + 0.4·0.5·0.3 ≈ **0.535** |

Talk B (the user *does* care about it per Layer 2) ranks below Talk A (the user doesn't), even though both have identical network coverage. The whole "missed by network *and* matches my interests" thesis inverts at the activation boundary.

The `ActiveLayers` flag fixes this because *every* talk in the same deployment stage runs through the same formula. Within a stage, ordering is consistent; across stages, the rescaling preserves the "fully missed = 1.0" invariant.

### 8.2 When do the active flags flip?

The `active` parameter is plumbed through `scoreTalk` and `rankTalks` with `DEFAULT_ACTIVE_LAYERS` (both false) so today's call sites need not change. The PR that ships the real Layer 2 implementation flips `layer2: true` either at the call site (e.g., the `useTalkScores` hook) or via a constant the hook reads. Same for Layer 3. The flags are deployment configuration, not per-request state.

---

## 9. Public API

```ts
// src/lib/scoring/rank.ts
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
 * Otherwise, runs Layer 1 + the two stubs through `combineLayers` with the
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
  // across renders (matters for React reconciliation and predictable UX).
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

Note: `ScoringInputs` (in §4) gains an optional `active?: ActiveLayers` field. See the updated type sketch in §4.

### 9.1 Sort order rationale

`missed` first encodes Understory's whole thesis: talks the user's network missed are the ones they came here to find. Within `missed`, higher intensity means a lower reach ratio — i.e., even fewer follows engaged — so those bubble to the top. `engaged` follows in descending intensity (least-engaged first, since high intensity within this group means closest-to-missed). `unknown` is last so it doesn't pollute the top of the list with talks the system can't actually rank.

The deterministic `rkey` tiebreak ensures stable order across renders, which matters for React reconciliation and predictable UX when sliders move.

---

## 10. UI requirements (handed off to #20 / #12)

This spec only ships the math; the slider UI lives in #20 and the feed page in #12. Those issues must honor the following requirements so the slider explanation isn't forgotten:

- Both sliders render fully live and accept user input (no disabled state).
- Slider state is passed into `rankTalks` so the API contract is exercised end-to-end, even though Layer 1 doesn't read it.
- Each slider has a label or `ⓘ` affordance communicating its inactive state, e.g.:
  - **"Surprise Me ↔ For Me"**: "Coming soon — interest matching unlocks once talk embeddings are live."
  - **"Algorithm ↔ Friends"**: "Coming soon — friend recommendations unlock once friend rec records are published."
- The exact wording is at the discretion of #20; this spec only requires the existence and intent of the affordance.

The point is that the UI we ship now is the UI we ship later. No throwaway "disabled" state to design twice; the data sources flip on later and the existing UI just starts moving.

---

## 11. Testing

The project does not currently have a test runner installed. Vitest will be added as part of this work because:

- Pure scoring functions with clear inputs/outputs are exactly the kind of code that benefits most from unit tests
- Setting up Vitest (~15 min of config) pays for itself the first time anyone touches the math
- Future scoring layers (#21–24, #18) will land safer with a test foundation already in place

### 11.1 Vitest setup

Add as devDependencies:

- `vitest` — the test runner
- `vite-tsconfig-paths` — so Vitest resolves the `@/*` alias from `tsconfig.json` without duplicating config

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Add `vitest.config.ts` at the repo root:

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

Tests live next to source files: `src/lib/scoring/*.test.ts`.

### 11.2 Test cases

All tests are pure: no mocks, no fixtures from disk, no network. Inputs are constructed inline. Numeric expected values below are pre-computed against the formulas in §5 and §8 — use `.toBeCloseTo(value, 6)` for floating-point assertions.

#### `computeLayer1`

| Case | Inputs | Expected `attentionInverse` |
|---|---|---|
| Zero follows engaged | `mention.follows = []`, `followCount = 100` | `1.0` |
| Half engaged | `mention.follows = [50 dids]`, `followCount = 100` | `0.5` |
| Fully engaged | `mention.follows = [100 dids]`, `followCount = 100` | `0.0` |
| Divide-by-zero | `mention.follows = [3 dids]`, `followCount = 0` | `1.0` (reachRatio is 0) |
| Stale data overflow | `mention.follows = [110 dids]`, `followCount = 100` | `0.0` (reachRatio clamped to 1) |
| Mention undefined | `mention = undefined`, `followCount = 100` | `1.0` (uniqueFollows defaults to 0) |

#### `combineLayers`

`weights = { surpriseSlider: 0.5, friendsSlider: 0.5 }` unless otherwise stated. Numbers chosen so the expected values are easy to verify by hand.

| Case | active | layer1 | layer2.interestScore | layer3.friendBoost | weights | Expected intensity |
|---|---|---|---|---|---|---|
| Layer 1 only — fully missed | `{l2:false, l3:false}` | `0.95` | `0` | `0` | default | `0.95` |
| Layer 1 only — partially engaged | `{l2:false, l3:false}` | `0.4` | `0` | `0` | default | `0.4` |
| L2 active, fully missed + perfect interest | `{l2:true,  l3:false}` | `1.0` | `1.0` | `0` | `surprise=0` | `(1.0·0.5 + 1.0·1·0.3) / 0.8 = 1.0` |
| L2 active, no interest score | `{l2:true,  l3:false}` | `1.0` | `0`   | `0` | default | `(1.0·0.5 + 0·0.5·0.3) / 0.8 = 0.625` |
| L3 active, friend boost only | `{l2:false, l3:true }` | `0.0` | `0`   | `1.0` | `friends=1` | `(0·0.5 + 1·1·0.2) / 0.7 ≈ 0.2857` |
| All three active, design-doc maximum | `{l2:true,  l3:true }` | `1.0` | `1.0` | `1.0` | `surprise=0, friends=1` | `0.5 + 0.3 + 0.2 = 1.0` |
| Slider drives raw above 1 → clamps | `{l2:true,  l3:false}` | `1.0` | `1.0` | `0` | `surprise=-2` | raw = `(1·0.5 + 1·3·0.3)/0.8 = 1.75`, clamped to `1.0` |
| NaN slider | `{l2:true,  l3:false}` | `1.0` | `1.0` | `0` | `surprise=NaN` | `safe(NaN)=0` → equivalent to `surprise=0` case = `1.0` |

**Regression test — the per-talk discontinuity bug.** This case exists specifically to lock in the correct behavior the renormalization fix introduced. If a future refactor reintroduces a per-talk `> 0` branch, this assertion will fail loudly:

```
active = { l2: true, l3: false }, weights = default

Talk A: layer1.attentionInverse = 0.95, layer2.interestScore = 0.0
Talk B: layer1.attentionInverse = 0.95, layer2.interestScore = 0.4

intensityA = (0.95·0.5 + 0.0·0.5·0.3) / 0.8 = 0.59375
intensityB = (0.95·0.5 + 0.4·0.5·0.3) / 0.8 = 0.66875

Assert: intensityB > intensityA  (talk the user actually cares about ranks higher)
```

#### `scoreTalk` state derivation

| Case | Expected `state` |
|---|---|
| `mentions = null`, `followCount = 100` | `unknown` |
| `mentions = {}`, `followCount = 0` | `unknown` |
| `mentions = {}` (talk has no entry), `followCount = 100` | `unknown` |
| `mentions = { rkey: { follows: [], ... } }`, `followCount = 100` | `missed` |
| `mentions = { rkey: { follows: [3 dids], ... } }`, `followCount = 100` | `engaged` |

#### `scoreTalk` defaults

| Case | Behavior |
|---|---|
| Omit `weights` | Uses `DEFAULT_WEIGHTS` (surprise=0.5, friends=0.5) |
| Omit `active` | Uses `DEFAULT_ACTIVE_LAYERS` (both false) |
| Omit both | Equivalent to today's deployment: Layer 1 only |

#### `rankTalks` sort order

Construct fixtures like:

```
talks = [A, B, C, D, E]   // each with distinct rkeys
mentions = {
  A: { follows: [1 did], count: 1, posts: [], rsvps: [] },     // engaged, intensity = 0.99
  B: { follows: [], count: 0, posts: [], rsvps: [] },          // missed, intensity = 1.0
  C: { follows: [50 dids], count: 50, posts: [], rsvps: [] },  // engaged, intensity = 0.5
  // D and E have no mention entries → unknown
}
followCount = 100
```

Assert order: `[B (missed, 1.0), A (engaged, 0.99), C (engaged, 0.5), D (unknown), E (unknown)]`.

**Deterministic tiebreak** (verified separately):

```
talks = [B1, B2]  with rkeys "zzz" and "aaa" respectively
both with follows = [], followCount = 100   // both missed, intensity 1.0

Assert: result[0].rkey === "aaa"  (rkey ascending)
Assert: result[1].rkey === "zzz"
```

#### `rankTalks` empty inputs

| Case | Expected |
|---|---|
| `talks = []` | `[]` |
| `mentions = null`, `talks = [3 entries]` | All three `unknown`, sorted by rkey |
| `followCount = 0`, `talks = [3 entries]` | All three `unknown`, sorted by rkey |

---

## 12. Edge cases

- **Empty crawl** — followCount > 0 but no talks have any follows engaged. All talks classified `missed`, sorted by `rkey`. The user sees a fully-glowing feed, which is the correct outcome ("your whole network missed all of these").
- **Zero follows** — `followCount === 0`. All talks `unknown`. UI should show a banner via the future hook ("connect your account to crawl your network"); the scoring module itself is silent.
- **Crawl partial failure** — `mentions` is non-null but some talks have no entry. Per the crawler implementation, every talk in scope is initialized with empty mention. Talks NOT in scope (no `eventUri`) are absent → fall through to `unknown`. Acceptable.
- **Slider out of range** — caller passes `surpriseSlider: 1.5` or `-0.3`. Combine logic clamps the final intensity to `[0, 1]`. We do not range-check sliders themselves; that's the caller's responsibility.
- **NaN inputs (sliders or stub scores)** — covered by `safe(n)` in `combineLayers` (§8). Any non-finite numeric input is coerced to 0 before arithmetic, preventing `NaN` from propagating into the sort key. This is a defense-in-depth guard for cases where uninitialized React state, JSON-parsed nulls, or future numeric inputs sneak past TypeScript types. Tests in §11.2 lock in the behavior.

---

## 13. Non-goals

- **Computing user embeddings.** Layer 2 stub returns 0; the real implementation belongs to issues #23/#24.
- **Reading friend recommendations.** Layer 3 stub returns 0; the real implementation belongs to #18.
- **Slider UI components.** Belongs to #20.
- **Feed page rendering.** Belongs to #12.
- **A React hook wrapping `rankTalks`.** Belongs to #20 or #12, whichever lands first.
- **Server-side scoring.** Out of scope. The design is client-side only because the user controls the weights live.
- **Caching scoring results.** The functions are cheap and deterministic; React `useMemo` in the future hook is sufficient.

---

## 14. Out-of-scope follow-ups (do not include in this PR)

- React hook (`useTalkScores`) — comes with #20 or #12.
- The actual `/feed` route and its UI — comes with #12.
- Slider components — comes with #20.
- Layer 2 and 3 real implementations — come with #18, #21–24.
- Wiring scoring into the existing `/talks` and `/talk/[rkey]` pages — separate UX work, possibly in #10 or a follow-up.

---

## 15. Acceptance criteria

- [ ] `src/lib/scoring/` module exists with all files listed in §3.1
- [ ] All public exports are typed and documented with JSDoc
- [ ] `computeLayer1`, `combineLayers` (with `ActiveLayers` parameter and rescaling), `scoreTalk`, `rankTalks` implemented per this spec
- [ ] `ActiveLayers` and `DEFAULT_ACTIVE_LAYERS` exported from `combine.ts`; re-exported from `types.ts`
- [ ] Layer 2 and Layer 3 stubs return zero, with JSDoc pointing at the unblocking issues (#21–24 for L2, #18 for L3)
- [ ] `safe()` NaN guard applied to all slider and stub-score inputs in `combineLayers`
- [ ] `reachRatio` clamped via `Math.min(1, ...)` in `computeLayer1`
- [ ] Vitest installed via `vitest` + `vite-tsconfig-paths`; `vitest.config.ts` matches §11.1
- [ ] `npm test` runs the suite and exits 0
- [ ] All test cases from §11.2 pass with the precise numeric assertions specified
- [ ] The §11.2 regression test (`intensityB > intensityA` for the per-talk discontinuity case) passes
- [ ] `npx tsc --noEmit` clean
- [ ] `npx eslint src/` clean
- [ ] `npm run build` succeeds; no new bundle warnings; `/api/crawl` still listed as a dynamic route (we shouldn't have touched it, but verify)
