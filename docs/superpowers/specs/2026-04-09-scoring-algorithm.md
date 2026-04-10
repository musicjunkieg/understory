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

export type TalkScoreState = "engaged" | "missed" | "unknown";

export interface Layer1Result {
  uniqueFollows: number;
  totalFollows: number;
  reachRatio: number;        // uniqueFollows / totalFollows, 0–1
  attentionInverse: number;  // 1 - reachRatio, 0–1
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
  const reachRatio = followCount > 0 ? uniqueFollows / followCount : 0;
  const attentionInverse = 1 - reachRatio;
  return {
    uniqueFollows,
    totalFollows: followCount,
    reachRatio,
    attentionInverse,
  };
}
```

---

## 6. State derivation

The three-state classifier separates "missed" from "unknown" so the UI can render them distinctly. The mapping is:

| Condition                          | State     | Notes                                    |
|------------------------------------|-----------|------------------------------------------|
| `mentions` is `null`               | `unknown` | Crawl has not yet run                    |
| `mention === undefined`            | `unknown` | Talk not in crawl scope (e.g. no eventUri) |
| `followCount === 0`                | `unknown` | User has zero follows; reach undefined   |
| `uniqueFollows === 0`              | `missed`  | Network missed it — full glow            |
| `uniqueFollows > 0`                | `engaged` | Network engaged with it — fade           |

Conflating "unknown" with "missed" would either light up false positives (a talk the crawler couldn't see glows as if missed) or hide talks (filtering unknowns drops talks the user might still want). Three-state preserves honesty.

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

```ts
// src/lib/scoring/combine.ts
import type { Layer1Result, ScoringWeights } from "./types";
import type { InterestStubResult } from "./interestStub";
import type { FriendStubResult } from "./friendStub";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Combine the three layers into a 0–1 intensity score.
 *
 * Per the design doc:
 *   final = (attention_inverse * 0.5)
 *         + (interest_score * (1 - surprise_slider) * 0.3)
 *         + (friend_boost * friends_slider * 0.2)
 *
 * While layers 2 and 3 are stubs (returning 0), the only contributing term
 * is layer 1, so we renormalize: layer 1 takes 100% of intensity. This keeps
 * a fully-missed talk at intensity 1.0 (full glow) instead of being capped
 * at 0.5. When layers 2 or 3 come online, the design-doc weights kick in
 * automatically — no caller changes required.
 */
export function combineLayers(
  layer1: Layer1Result,
  layer2: InterestStubResult,
  layer3: FriendStubResult,
  weights: ScoringWeights,
): number {
  const layer2Active = layer2.interestScore > 0;
  const layer3Active = layer3.friendBoost > 0;

  if (!layer2Active && !layer3Active) {
    // Layer 1 only — already 0–1, no further normalization needed.
    return clamp(layer1.attentionInverse, 0, 1);
  }

  return clamp(
    layer1.attentionInverse * 0.5 +
      layer2.interestScore * (1 - weights.surpriseSlider) * 0.3 +
      layer3.friendBoost * weights.friendsSlider * 0.2,
    0,
    1,
  );
}
```

The renormalization branch is the key bit. It is intentionally a runtime check on `> 0` rather than a compile-time flag because:

- Layers 2 and 3 may come online independently (different PRs, different issues)
- A user who has no friend recommendations should still get the design-doc weights applied to their interest similarity, even though layer 3 contributes 0 in their case
- Centralizing the check here means individual scoring sites don't need to know which layers are "live"

Once both real layers are implemented, the `> 0` check naturally becomes a non-event (real implementations will return positive values for relevant talks), and the design-doc formula takes over.

---

## 9. Public API

```ts
// src/lib/scoring/rank.ts
import type { TalkEntry } from "@/lib/types";
import type { TalkMention } from "@/lib/crawl/types";
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
import { combineLayers } from "./combine";

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

export function scoreTalk(
  talk: TalkEntry,
  mention: TalkMention | undefined,
  followCount: number,
  mentionsAvailable: boolean,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): TalkScore {
  if (!mentionsAvailable || followCount === 0) {
    return unknownScore(talk.rkey, followCount);
  }
  if (!mention) {
    // Talk is not in crawl scope (e.g. no eventUri so the crawler skipped it)
    return unknownScore(talk.rkey, followCount);
  }

  const layer1 = computeLayer1(mention, followCount);
  const layer2 = computeInterestStub(talk);
  const layer3 = computeFriendStub(talk);
  const intensity = combineLayers(layer1, layer2, layer3, weights);

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
  // Tertiary: rkey ascending — stable, deterministic tiebreak
  return a.rkey.localeCompare(b.rkey);
}

export function rankTalks(inputs: ScoringInputs): TalkScore[] {
  const { talks, mentions, followCount, weights = DEFAULT_WEIGHTS } = inputs;
  const mentionsAvailable = mentions !== null;
  return talks
    .map((talk) =>
      scoreTalk(
        talk,
        mentions?.[talk.rkey],
        followCount,
        mentionsAvailable,
        weights,
      ),
    )
    .sort(compareTalkScores);
}
```

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

- Add `vitest` and `@vitest/ui` (optional) as devDependencies
- Add a `test` script to `package.json`: `"test": "vitest run"` (and `"test:watch": "vitest"`)
- Add a minimal `vitest.config.ts` with TypeScript path aliases matching `tsconfig.json`
- Tests live next to source files: `src/lib/scoring/*.test.ts`

### 11.2 Test cases

| Module | Cases |
|---|---|
| `computeLayer1` | zero follows; partial engagement; full engagement; followCount=0 (divide-by-zero guard) |
| `combineLayers` | both stubs zero → returns layer1.attentionInverse exactly; layer 2 active → applies design weights; layer 3 active → applies design weights; both active → applies full formula; result clamps to [0, 1] |
| `scoreTalk` state derivation | unknown when mentions=null; unknown when mention undefined; unknown when followCount=0; missed when uniqueFollows=0; engaged when uniqueFollows>0 |
| `scoreTalk` defaults | omitted weights default to `DEFAULT_WEIGHTS` |
| `rankTalks` sort order | mixed states sort missed→engaged→unknown; intensity descending within each state; rkey tiebreak is stable |
| `rankTalks` empty inputs | empty talks array → empty result; null mentions → all unknown; zero followCount → all unknown |

All tests are pure: no mocks, no fixtures from disk, no network. Inputs are constructed inline.

---

## 12. Edge cases

- **Empty crawl** — followCount > 0 but no talks have any follows engaged. All talks classified `missed`, sorted by `rkey`. The user sees a fully-glowing feed, which is the correct outcome ("your whole network missed all of these").
- **Zero follows** — `followCount === 0`. All talks `unknown`. UI should show a banner via the future hook ("connect your account to crawl your network"); the scoring module itself is silent.
- **Crawl partial failure** — `mentions` is non-null but some talks have no entry. Per the crawler implementation, every talk in scope is initialized with empty mention. Talks NOT in scope (no `eventUri`) are absent → fall through to `unknown`. Acceptable.
- **Slider out of range** — caller passes `surpriseSlider: 1.5`. Combine logic clamps the final intensity to `[0, 1]`. We do not validate sliders themselves; that's the caller's responsibility.
- **NaN or negative inputs** — caller passes garbage. We don't defensively validate; TypeScript types should prevent it. If garbage gets through, behavior is undefined and the test suite will catch regressions in pure-input cases.

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
- [ ] All public exports are typed and documented
- [ ] `computeLayer1`, `combineLayers`, `scoreTalk`, `rankTalks` implemented per this spec
- [ ] Layer 2 and Layer 3 stubs return zero, with TODO-style JSDoc pointing at the unblocking issues
- [ ] Vitest installed and `npm test` runs the suite
- [ ] All test cases from §11.2 pass
- [ ] `npx tsc --noEmit` clean
- [ ] `npx eslint src/` clean
- [ ] `npm run build` succeeds; no new bundle warnings
