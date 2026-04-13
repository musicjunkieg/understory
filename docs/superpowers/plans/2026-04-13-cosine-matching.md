# Cosine Similarity Matching Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the talk-side embedding corpus from #21 and the user-side interest vector from #23 via cosine similarity, normalize into `[0, 1]`, and flip `active.layer2` to true so the existing `combineLayers` rescale math lights up layer 2 of the three-layer scoring engine for the first time.

**Architecture:** New pure `computeLayer2` helper under `src/lib/scoring/interest.ts` (replaces `interestStub.ts`), new `/api/embeddings` server-side route serving the aggregated talk corpus with immutable HTTP caching, new `useTalkEmbeddings` client hook mirroring `useCrawlData`, and surgical updates to `rank.ts` / `combine.ts` / `scored-talks-grid.tsx` to thread the two new fields through `ScoringInputs` and the ranking pipeline. Two cosine passes get collapsed to one via a stashed `TalkScore.layer2` field.

**Tech Stack:** Next.js 16 / React 19 / TypeScript 5 / vitest. No new dependencies. Consumes the `cosineSimilarity` helper from `src/lib/scoring/cosine.ts` (shipped in #21). Reads `data/embeddings/{rkey}.json` files already on disk from #21's offline pipeline run.

**Spec:** `docs/superpowers/specs/2026-04-13-cosine-matching-design.md`

---

## File Map

**New files:**

| Path | Responsibility |
|---|---|
| `src/lib/scoring/interest.ts` | `computeLayer2(talk, interestVector, embeddings)` pure function + `Layer2Result` type. Replaces `interestStub.ts`. Three zero cases + shift-and-scale. ~30 lines. |
| `src/lib/scoring/interest.test.ts` | 7 vitest tests for `computeLayer2`. |
| `src/app/api/embeddings/route.ts` | Next.js App Router GET handler. Reads `data/embeddings/*.json` into a module-level cache, projects each file down to `.vector`, returns `Record<rkey, number[]>`. `export const dynamic = 'force-static'` + `new Response(JSON.stringify(body), { headers })` so `Cache-Control: immutable` actually reaches the browser. ~60 lines. |
| `src/app/api/embeddings/route.test.ts` | 1 vitest test. Mocks `fs.readdirSync` + `fs.readFileSync`, asserts response shape + status + cache header. |
| `src/hooks/useTalkEmbeddings.ts` | Client hook. `useState` + `useEffect` + `fetch('/api/embeddings')` on mount, cancellation-safe, returns `{embeddings, loading, error}`. Mirrors `useCrawlData` shape exactly. ~60 lines. |

**Modified files:**

| Path | Change |
|---|---|
| `src/lib/scoring/types.ts` | Add `interestVector?: number[] \| null` and `embeddings?: Record<string, number[]>` to `ScoringInputs` (optional initially — tightened to required in Task 10 to preserve TDD green state). Change `TalkScore.layer2?` to required `layer2: Layer2Result` and add the import. |
| `src/lib/scoring/rank.ts` | Replace `computeInterestStub` import with `computeLayer2`. Extend `scoreTalk` signature to take `interestVector` and `embeddings`. Populate `layer2` on every `TalkScore` return (including `unknownScore`). Normalization pass at lines 131–161 reuses the stashed `score.layer2` instead of re-computing. `rankTalks` threads the new fields from `inputs` into each `scoreTalk` call. |
| `src/lib/scoring/combine.ts` | One-line type import rename: `InterestStubResult` from `./interestStub` → `Layer2Result` from `./interest`. Parameter rename in `combineLayers` signature. No logic change. |
| `src/lib/scoring/index.ts` | Export `Layer2Result` type and optionally `computeLayer2` function. |
| `src/lib/scoring/rank.test.ts` | Update existing `rankTalks` call fixtures to pass explicit `interestVector: null` and `embeddings: {}` (Task 10). Add one new integration test in Task 10 for the blended-intensity path. |
| `src/components/scored-talks-grid.tsx` | Add `useTalkEmbeddings` hook call. Update loader gate to `if (loading \|\| embeddingsLoading)`. Update `rankTalks` call site to pass the two new fields and `active: { layer2: true, layer3: false }`. |

**Deleted files:**

| Path | Reason |
|---|---|
| `src/lib/scoring/interestStub.ts` | Replaced by `interest.ts`. No `interestStub.test.ts` exists today (verified via `find src/lib/scoring -name '*.test.ts'`). |

**Unchanged and worth noting:**
- `src/lib/scoring/cosine.ts` and `cosine.test.ts` — shipped in #21, consumed here.
- `src/lib/scoring/friendStub.ts` — layer 3 stays dark, unchanged.
- `src/lib/scoring/combine.test.ts` — does not import `InterestStubResult` (uses inline `{interestScore: N}` literals), so no update needed.
- `src/lib/scoring/networkAttention.test.ts` — tests `computeLayer1` in isolation, not affected.
- `src/lib/crawl/interest-profile.ts` — #23's user-vector builder, unchanged.
- `src/hooks/useCrawlData.ts` — already surfaces `interestVector`, unchanged.
- `data/embeddings/*.json` — unchanged, read by the new route.

**Test count progression:** 79 → 88 (7 new in `interest.test.ts` + 1 in `route.test.ts` + 1 in `rank.test.ts`). No stub tests to subtract.

---

## Chunk 1: Pure helper (`computeLayer2`)

### Task 1: Failing tests for `computeLayer2`

**Files:**
- Create: `src/lib/scoring/interest.test.ts`

**Skills:** Follow superpowers:test-driven-development.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/scoring/interest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeLayer2 } from "./interest";
import type { TalkEntry } from "@/lib/types";

function makeTalk(rkey: string): TalkEntry {
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
  };
}

const RKEY = "3mi54oonum62b";

describe("computeLayer2", () => {
  it("returns interestScore 1.0 for identical vectors", () => {
    const talk = makeTalk(RKEY);
    const result = computeLayer2(talk, [1, 0, 0], { [RKEY]: [1, 0, 0] });
    expect(result.interestScore).toBeCloseTo(1.0, 10);
  });

  it("returns interestScore 0.5 for orthogonal vectors", () => {
    const talk = makeTalk(RKEY);
    const result = computeLayer2(talk, [1, 0, 0], { [RKEY]: [0, 1, 0] });
    expect(result.interestScore).toBeCloseTo(0.5, 10);
  });

  it("returns interestScore 0 for opposite vectors", () => {
    const talk = makeTalk(RKEY);
    const result = computeLayer2(talk, [1, 0, 0], { [RKEY]: [-1, 0, 0] });
    expect(result.interestScore).toBeCloseTo(0, 10);
  });

  it("returns interestScore 0 when the user vector is null", () => {
    const talk = makeTalk(RKEY);
    const result = computeLayer2(talk, null, { [RKEY]: [1, 0, 0] });
    expect(result.interestScore).toBe(0);
  });

  it("returns interestScore 0 when the talk has no embedding on disk", () => {
    const talk = makeTalk(RKEY);
    const result = computeLayer2(talk, [1, 0, 0], {});
    expect(result.interestScore).toBe(0);
  });

  it("returns interestScore 0.5 when the talk vector has zero magnitude", () => {
    // cosineSimilarity returns 0 on zero-magnitude inputs (contract from #21),
    // so shift-and-scale gives us 0.5 (neutral). Not a special case — just
    // the math falling through naturally.
    const talk = makeTalk(RKEY);
    const result = computeLayer2(talk, [1, 2, 3], { [RKEY]: [0, 0, 0] });
    expect(result.interestScore).toBeCloseTo(0.5, 10);
  });

  it("throws with the cosine length-mismatch message on dimension mismatch", () => {
    // cosineSimilarity throws "cosine: length mismatch A vs B" (contract
    // pinned in #21's cosine.test.ts). computeLayer2 must NOT catch — a
    // dimension mismatch is a real bug, not a recoverable runtime state.
    const talk = makeTalk(RKEY);
    expect(() =>
      computeLayer2(talk, [1, 0, 0], { [RKEY]: [1, 0] }),
    ).toThrow("cosine: length mismatch 3 vs 2");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/scoring/interest.test.ts`

Expected: all 7 tests fail with `Failed to resolve import "./interest"` — the implementation file does not exist yet.

- [ ] **Step 3: No commit yet**

Task 2 implements the function. Wait until green before committing.

---

### Task 2: Implement `computeLayer2`

**Files:**
- Create: `src/lib/scoring/interest.ts`

- [ ] **Step 1: Write the implementation**

Create `src/lib/scoring/interest.ts`:

```ts
import type { TalkEntry } from "@/lib/types";
import { cosineSimilarity } from "./cosine";

/**
 * Result shape for layer 2 scoring. Identical to the old InterestStubResult
 * so combineLayers can consume it without a signature change.
 */
export interface Layer2Result {
  /** Similarity score in [0, 1]. 0 when the user vector is null, when the
   *  talk has no embedding, or when cosine is -1. 0.5 when the vectors are
   *  orthogonal (or when the talk vector has zero magnitude). 1.0 when
   *  they're identical. */
  interestScore: number;
}

/**
 * Compute the layer-2 interest similarity between a user's interest vector
 * (from #23 via /api/crawl) and a talk's pre-computed embedding (from #21
 * via /api/embeddings).
 *
 * Three explicit zero cases before the cosine math:
 *   1. User has no profile vector (null) — #23's "no-posts" or "error" path
 *   2. Talk has no embedding file on disk — data drift hedge for rkeys
 *      added after the last `npm run embed` run
 *   3. Dimension mismatch — thrown loudly by cosineSimilarity, NOT caught
 *      here because it indicates a bug, not normal runtime behavior
 *
 * Shift-and-scale normalization maps cosine [-1, 1] → interestScore [0, 1]
 * via (cos + 1) / 2.
 */
export function computeLayer2(
  talk: TalkEntry,
  interestVector: number[] | null,
  embeddings: Record<string, number[]>,
): Layer2Result {
  if (interestVector === null) {
    return { interestScore: 0 };
  }

  const talkVector = embeddings[talk.rkey];
  if (!talkVector) {
    return { interestScore: 0 };
  }

  // cosineSimilarity throws on length mismatch; we let that propagate.
  const cosine = cosineSimilarity(interestVector, talkVector);
  return { interestScore: (cosine + 1) / 2 };
}
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `npm test -- src/lib/scoring/interest.test.ts`

Expected: 7 tests pass.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: 86 tests pass (79 baseline + 7 new).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`

Expected: zero output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoring/interest.ts src/lib/scoring/interest.test.ts
git commit -m "feat(scoring): add computeLayer2 helper with cosine matching (#24)

Pure helper that connects the talk-side embeddings from #21 and the
user-side interest vector from #23. Three zero cases (null user
vector, missing talk embedding, dimension mismatch throws) plus
shift-and-scale normalization from cosine [-1, 1] to interestScore
[0, 1].

Replaces computeInterestStub (which still exists; Task 4 deletes it).
combineLayers is not touched yet — it still imports InterestStubResult
from the stub. Tasks 3-5 migrate the type + call sites.

7 unit tests pin the contract: identical / orthogonal / opposite
vectors, null user vector, missing embedding, zero-magnitude talk
vector, dimension mismatch throws with the exact message from #21's
cosine.test.ts."
```

---

## Chunk 2: Wire `computeLayer2` into the scoring pipeline

This chunk migrates `rank.ts`, `combine.ts`, and `index.ts` off the stub. After Chunk 2 completes, `interestStub.ts` is gone and the scoring engine is calling `computeLayer2` end-to-end — but with no user vector or embeddings flowing yet, so `computeLayer2` always returns `{interestScore: 0}` and behavior is unchanged from the stub era.

### Task 3: Extend `ScoringInputs` and `TalkScore`, migrate `rank.ts`

**Files:**
- Modify: `src/lib/scoring/types.ts`
- Modify: `src/lib/scoring/rank.ts`

This task is the biggest single-commit change in the plan. It must atomically:
1. Extend `ScoringInputs` with two new optional fields
2. Change `TalkScore.layer2` from optional to required
3. Update `unknownScore` to populate `layer2`
4. Update `scoreTalk` to accept the new fields and call `computeLayer2`
5. Update `rankTalks` to thread the fields into `scoreTalk` AND reuse the stashed `layer2` in the normalization pass

All of these are tightly coupled through the TypeScript types — half-measures would leave the tree in a broken state. The existing rank.test.ts keeps passing because the new fields are optional with safe defaults (`interestVector ?? null`, `embeddings ?? {}`), which cause `computeLayer2` to return `{interestScore: 0}` — exactly what `computeInterestStub` was returning.

- [ ] **Step 1: Read the current rank.ts and types.ts to confirm the existing shape**

Use the Read tool on `src/lib/scoring/rank.ts` and `src/lib/scoring/types.ts`. Confirm:
- `rank.ts:11` imports `computeInterestStub` from `"./interestStub"`.
- `rank.ts:74` calls `computeInterestStub(talk)`.
- `rank.ts:81` returns `TalkScore` without a `layer2` field (because it's optional today).
- `rank.ts:155` calls `computeInterestStub(talk)` AGAIN inside the normalization pass — this is the double-compute we need to eliminate.
- `types.ts:30` declares `layer2?: { interestScore: number }` (optional).
- `types.ts:47-53` declares `ScoringInputs` with no `interestVector` / `embeddings`.

- [ ] **Step 2: Update types.ts**

Make these three edits to `src/lib/scoring/types.ts`:

**(a) Import `Layer2Result`** at the top of the file (right below the existing imports):

```ts
import type { Layer2Result } from "./interest";
```

**(b) Change `TalkScore.layer2` from optional to required.** Find this block around line 30:

```ts
  layer2?: { interestScore: number };
```

Replace with:

```ts
  layer2: Layer2Result;
```

**(c) Extend `ScoringInputs` with two new optional fields.** Find the `ScoringInputs` interface around lines 47–53 and add two fields after `followCount`:

```ts
export interface ScoringInputs {
  talks: TalkEntry[];
  mentions: TalkMentions | null;
  followCount: number;
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
  active?: ActiveLayers;
}
```

- [ ] **Step 3: Update rank.ts**

Three edits:

**(a) Swap the import.** Find the import block around lines 1–17. Replace:

```ts
import { computeInterestStub } from "./interestStub";
```

with:

```ts
import { computeLayer2 } from "./interest";
```

**(b) Update `unknownScore` to populate `layer2`.** Find the function around lines 19–38 and extend the returned object:

```ts
function unknownScore(rkey: string, followCount: number): TalkScore {
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
```

**(c) Extend `scoreTalk` to accept the new inputs, stash `layer2`, and eliminate the double-compute in `rankTalks`.** The entire region from `export function scoreTalk` through the end of `rankTalks` is rewritten. Replace lines 54–164 (everything from `export function scoreTalk` to the end of `rankTalks`) with:

```ts
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
        computeFriendStub({ rkey: score.rkey } as TalkEntry),
        weights,
        active,
      );
    }
  }

  return scores.sort(compareTalkScores);
}
```

Note the two important changes in `rankTalks`:

1. **`computeInterestStub` is gone** — we reuse `score.layer2` which was stashed during the first pass.
2. **`computeFriendStub` still runs in the normalization pass**, because layer 3 is still a stub. It's cheap (returns a constant) so we don't bother stashing it too. When #22 lands, a future task can stash layer 3 the same way layer 2 is stashed here.

The `computeFriendStub({ rkey: score.rkey } as TalkEntry)` cast is intentional: the stub currently only reads `.rkey` and ignores everything else, and the `talksByRkey` lookup from the original code is no longer needed now that we're not computing layer 2 again. The `as TalkEntry` cast is safe because the stub's contract is already "ignores its argument" — verify by reading `src/lib/scoring/friendStub.ts` during implementation.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`

Expected: zero output. The compiler will verify that every `TalkScore` return populates the now-required `layer2` field and that the new `scoreTalk` signature is self-consistent.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`

Expected: 86 tests pass (79 baseline + 7 from Task 2). The existing `rank.test.ts` tests still pass because:
- They call `scoreTalk(talk, mentions, followCount, weights, active)` — wait, this is now a compile error because the signature changed.

**STOP.** Read `rank.test.ts` and check which signature the tests use. If they use `scoreTalk(...)` directly with positional args, Task 3 needs to either (a) update those test call sites or (b) keep `scoreTalk`'s new parameters at the end with defaults. Let me provide guidance:

- If `rank.test.ts` calls `scoreTalk(talk, mentions, followCount, weights, active)`, update each call site to `scoreTalk(talk, mentions, followCount, null, {}, weights, active)`. Do this in **the same commit** as the Task 3 changes.
- If `rank.test.ts` only calls `rankTalks(inputs)`, no test updates are needed — the inputs object's new optional fields default to safe values.

Use grep: `grep -n "scoreTalk(" src/lib/scoring/rank.test.ts`

If grep finds calls, add test updates to this task. If it only finds the import line, skip ahead.

- [ ] **Step 6: Run the full test suite (after any test fixture updates)**

Run: `npm test`

Expected: 86 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/scoring/types.ts src/lib/scoring/rank.ts src/lib/scoring/rank.test.ts
git commit -m "refactor(scoring): migrate rank.ts to computeLayer2, stash on TalkScore (#24)

Swaps computeInterestStub for computeLayer2 in both call sites in
rank.ts (scoreTalk's first pass and rankTalks' normalization pass),
eliminating the double-cosine-compute that the spec review caught.

- types.ts: extend ScoringInputs with optional interestVector and
  embeddings fields (tightened to required in Task 10). Change
  TalkScore.layer2 from optional to required.
- rank.ts: scoreTalk now takes interestVector + embeddings,
  computes layer2 once, stashes on TalkScore. rankTalks reuses
  score.layer2 in the normalization pass. unknownScore populates
  layer2: {interestScore: 0}.
- rank.test.ts: update scoreTalk call sites if needed (depends on
  whether tests call scoreTalk directly or only via rankTalks).

Behavior unchanged for existing callers: optional interestVector
defaults to null and embeddings defaults to {}, so computeLayer2
returns {interestScore: 0} — identical to what computeInterestStub
was returning. combineLayers still has active.layer2: false by
default, so the stubbed value is multiplied by zero weight anyway.

interestStub.ts still exists — combine.ts still imports it. Task 4
removes both."
```

---

### Task 4: Update `combine.ts` import + delete `interestStub.ts`

**Files:**
- Modify: `src/lib/scoring/combine.ts`
- Delete: `src/lib/scoring/interestStub.ts`

Tasks 4 and 5 are small enough to commit independently. Task 4 removes the last reference to the stub.

- [ ] **Step 1: Update combine.ts**

Open `src/lib/scoring/combine.ts` and make two edits:

**(a) Replace the type import line** (currently line 2):

```ts
// Before:
import type { InterestStubResult } from "./interestStub";
// After:
import type { Layer2Result } from "./interest";
```

**(b) Update the `combineLayers` parameter type** (find the function signature, parameter `layer2`):

```ts
// Before:
layer2: InterestStubResult,
// After:
layer2: Layer2Result,
```

These are the only changes to `combine.ts` — no logic modifications.

- [ ] **Step 2: Delete `interestStub.ts`**

Run: `rm src/lib/scoring/interestStub.ts`

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

Expected: zero output. `Layer2Result` has the identical structural shape as `InterestStubResult` (`{interestScore: number}`), so the type rename is a no-op at the shape level.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`

Expected: 86 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoring/combine.ts
git rm src/lib/scoring/interestStub.ts
git commit -m "refactor(scoring): delete interestStub, rename type in combine.ts (#24)

With rank.ts migrated to computeLayer2 in the previous commit, the
only remaining consumer of interestStub was combine.ts's type
import. Swap that to Layer2Result from ./interest and delete the
stub file. Structural shape is identical ({interestScore: number})
so this is a pure rename with no behavior change.

combineLayers' rescale math is unchanged. active.layer2 is still
false by default; flipping it to true happens in Task 9 when
ScoredTalksGrid wires up useTalkEmbeddings."
```

---

### Task 5: Export `Layer2Result` and `computeLayer2` from `index.ts`

**Files:**
- Modify: `src/lib/scoring/index.ts`

- [ ] **Step 1: Update the barrel**

Open `src/lib/scoring/index.ts`. The current file exports `TalkScore`, `scoreTalk`, `rankTalks`, etc. from `./types` and `./rank`. Add exports for the new helper:

At the end of the file, add:

```ts
export type { Layer2Result } from "./interest";
export { computeLayer2 } from "./interest";
```

Also check whether `TalkScore` in the type re-export block around line 5 needs any update — it shouldn't, because `TalkScore` is still exported the same way, just with a more restrictive `layer2` field internally.

- [ ] **Step 2: Typecheck + tests**

Run: `npx tsc --noEmit && npm test`

Expected: zero tsc output, 86 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/scoring/index.ts
git commit -m "refactor(scoring): export Layer2Result and computeLayer2 from barrel (#24)

Adds the two new symbols to the scoring module's public surface so
consumers can `import { computeLayer2, Layer2Result } from '@/lib/scoring'`
instead of reaching into ./interest directly. Matches the existing
pattern for every other public symbol in the module."
```

---

## Chunk 3: Server-side `/api/embeddings` route

### Task 6: Failing test for the route

**Files:**
- Create: `src/app/api/embeddings/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/embeddings/route.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";

// Sample files the mocked fs should return.
const SAMPLE_FILES = [
  "3mi54oonum62b.json",
  "3mi56m3hnrq2z.json",
];

const SAMPLE_CONTENTS: Record<string, unknown> = {
  "3mi54oonum62b.json": {
    rkey: "3mi54oonum62b",
    model: "voyage-3.5-lite",
    dimensions: 1024,
    vector: new Array(1024).fill(0.1),
    transcriptHash: "sha256-abc",
    truncated: false,
    generatedAt: "2026-04-13T00:00:00.000Z",
  },
  "3mi56m3hnrq2z.json": {
    rkey: "3mi56m3hnrq2z",
    model: "voyage-3.5-lite",
    dimensions: 1024,
    vector: new Array(1024).fill(0.2),
    transcriptHash: "sha256-def",
    truncated: false,
    generatedAt: "2026-04-13T00:00:00.000Z",
  },
};

describe("GET /api/embeddings", () => {
  beforeEach(() => {
    vi.spyOn(fs, "readdirSync").mockReturnValue(
      SAMPLE_FILES as unknown as fs.Dirent[],
    );
    vi.spyOn(fs, "readFileSync").mockImplementation((path) => {
      const filename = String(path).split("/").pop()!;
      return JSON.stringify(SAMPLE_CONTENTS[filename]);
    });
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an aggregated Record<rkey, number[]> with immutable cache headers", async () => {
    // Import inside the test so the module-level cache gets rebuilt fresh
    // per test run (vitest resets module graph between test files but not
    // within one file).
    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);

    const cacheControl = response.headers.get("Cache-Control");
    expect(cacheControl).toContain("max-age=31536000");
    expect(cacheControl).toContain("immutable");

    const body = (await response.json()) as Record<string, number[]>;
    expect(Object.keys(body)).toEqual([
      "3mi54oonum62b",
      "3mi56m3hnrq2z",
    ]);
    expect(body["3mi54oonum62b"]).toHaveLength(1024);
    expect(body["3mi54oonum62b"][0]).toBeCloseTo(0.1, 10);
    expect(body["3mi56m3hnrq2z"][0]).toBeCloseTo(0.2, 10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/app/api/embeddings/route.test.ts`

Expected: test fails with `Failed to resolve import "./route"` — the route file does not exist yet.

- [ ] **Step 3: No commit yet**

Task 7 implements the route.

---

### Task 7: Implement the `/api/embeddings` route

**Files:**
- Create: `src/app/api/embeddings/route.ts`

- [ ] **Step 1: Write the route handler**

Create `src/app/api/embeddings/route.ts`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Tell Next.js this route is static: we read from the filesystem but the
 * data never changes at request time (it's baked into the standalone
 * build via outputFileTracingIncludes in next.config.ts). Without this,
 * App Router classifies the route as dynamic and may override our
 * Cache-Control header with its default no-store.
 */
export const dynamic = "force-static";

const EMBEDDINGS_DIR = path.resolve(process.cwd(), "data/embeddings");

/**
 * On-disk shape of data/embeddings/{rkey}.json, from #21's offline pipeline.
 * Only the `.rkey` and `.vector` fields are needed at runtime; the other
 * fields (model, dimensions, transcriptHash, truncated, generatedAt) are
 * persistence-layer metadata.
 */
interface EmbeddingFile {
  rkey: string;
  model: string;
  dimensions: number;
  vector: number[];
  transcriptHash: string;
  truncated: boolean;
  generatedAt: string;
}

/**
 * Module-level cache. Populated on first GET request, reused forever.
 * Per-worker memory cost: ~400 KB for 108 vectors × 1024 floats.
 */
let cache: Record<string, number[]> | null = null;

function loadEmbeddings(): Record<string, number[]> {
  if (cache !== null) return cache;

  const files = fs.readdirSync(EMBEDDINGS_DIR);
  const result: Record<string, number[]> = {};

  for (const filename of files) {
    if (!filename.endsWith(".json")) continue;
    const fullPath = path.join(EMBEDDINGS_DIR, filename);
    const raw = fs.readFileSync(fullPath, "utf-8");
    const parsed = JSON.parse(raw) as EmbeddingFile;
    result[parsed.rkey] = parsed.vector;
  }

  cache = result;
  return cache;
}

export async function GET(): Promise<Response> {
  const body = loadEmbeddings();

  // Use explicit `new Response(...)` rather than `Response.json()` so the
  // framework preserves our Cache-Control header verbatim. Next.js's
  // Response.json() helper can let default headers intercede.
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Corpus only changes when data/embeddings/ changes (offline, via
      // `npm run embed`). Immutable is semantically correct for this
      // endpoint — a new release with new embeddings should invalidate
      // via a fresh bundle, not a stale cache.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm test -- src/app/api/embeddings/route.test.ts`

Expected: 1 test passes.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: 87 tests pass (86 + 1 new).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`

Expected: zero output.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/embeddings/route.ts src/app/api/embeddings/route.test.ts
git commit -m "feat(api): add /api/embeddings route with immutable cache headers (#24)

Serves the aggregated talk embedding corpus as Record<rkey, number[]>
with Cache-Control: public, max-age=31536000, immutable. Module-level
cache populated on first request, reused forever per worker (~400 KB).

Two belt-and-braces decisions to make Next.js App Router actually send
the cache header through:

1. export const dynamic = 'force-static' — App Router classifies
   fs-reading routes as dynamic by default and may override
   Cache-Control with no-store. force-static opts us out.
2. Explicit `new Response(JSON.stringify(body), { headers })`
   rather than Response.json(). The helper can let framework default
   headers intercede; the explicit constructor preserves our headers
   verbatim.

Without both fixes, useTalkEmbeddings would refetch 400 KB on every
mount instead of hitting the browser HTTP cache.

1 unit test mocks fs.readdirSync + fs.readFileSync, asserts response
shape, status 200, and that Cache-Control contains both max-age and
immutable."
```

---

## Chunk 4: Client hook and consumer wiring

### Task 8: Implement `useTalkEmbeddings` hook

**Files:**
- Create: `src/hooks/useTalkEmbeddings.ts`

No tests for this hook — it mirrors `useCrawlData` exactly and `useCrawlData` has no unit test either. Coverage is the shape of the hook return type plus runtime verification on staging.

- [ ] **Step 1: Read `useCrawlData` as the reference pattern**

Use the Read tool on `src/hooks/useCrawlData.ts`. The new hook should mirror its structure exactly:
- `"use client"` directive
- React imports: `useState`, `useEffect`
- Exported interface shape with `loading`, `error`, and the data field
- Initial state via `useState`
- `useEffect` with a `cancelled` flag for unmount-safety
- Fetch logic with HTTP error handling
- `try/catch` wrapping

- [ ] **Step 2: Create the hook**

Create `src/hooks/useTalkEmbeddings.ts`:

```ts
"use client";

import { useState, useEffect } from "react";

export interface TalkEmbeddingsData {
  /** Talk embeddings keyed by rkey. Null until the fetch resolves (or if
   *  the fetch failed). #24's computeLayer2 consumer falls back to
   *  interestScore: 0 when a talk's rkey is not present. */
  embeddings: Record<string, number[]> | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the talk embedding corpus from /api/embeddings on mount.
 *
 * The endpoint sets Cache-Control: public, max-age=31536000, immutable,
 * so the browser's HTTP cache handles cross-session persistence for free
 * — the first mount pays the ~400 KB gzipped cost once, and every
 * subsequent mount in the same session (or across sessions, within the
 * immutable window) is a cache hit.
 *
 * Mirrors useCrawlData's structure exactly, including the cancellation
 * pattern for unmount during fetch.
 */
export function useTalkEmbeddings(): TalkEmbeddingsData {
  const [data, setData] = useState<TalkEmbeddingsData>({
    embeddings: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchEmbeddings() {
      try {
        const res = await fetch("/api/embeddings");
        if (!res.ok) {
          if (!cancelled) {
            setData({
              embeddings: null,
              loading: false,
              error: `Embeddings fetch failed: ${res.status} ${res.statusText}`,
            });
          }
          return;
        }
        const json = (await res.json()) as Record<string, number[]>;
        if (!cancelled) {
          setData({
            embeddings: json,
            loading: false,
            error: null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setData({
            embeddings: null,
            loading: false,
            error:
              err instanceof Error ? err.message : "Embeddings fetch failed",
          });
        }
      }
    }

    fetchEmbeddings();
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: zero output.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: 87 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useTalkEmbeddings.ts
git commit -m "feat(hooks): add useTalkEmbeddings client hook (#24)

Mirrors useCrawlData's structure exactly: useState + useEffect +
cancellation flag + try/catch + HTTP error mapping. Fetches
/api/embeddings once on mount and caches in component state.

The endpoint's immutable Cache-Control header means the browser's
HTTP cache handles cross-session persistence for free — every mount
after the first is a sub-millisecond browser cache hit.

No unit test — the hook is a thin wrapper around fetch + useState +
useEffect, identical in shape to useCrawlData which also has no test.
Runtime verification happens on staging via the devtools network
panel (first load: 400 KB from network, second load: 'from disk
cache')."
```

---

### Task 9: Wire `useTalkEmbeddings` into `ScoredTalksGrid` (layer 2 goes live)

**Files:**
- Modify: `src/components/scored-talks-grid.tsx`

**This is the task that flips layer 2 from dark to live.** After this commit:
- Users with a populated `interestVector` see talks ranked by a blend of inverted network attention AND interest similarity.
- Users with `interestProfileStatus === "no-posts"` / `"error"` see no change (computeLayer2 returns {interestScore: 0}).
- Talks without an embedding get layer 2 = 0 (graceful data-drift handling).

- [ ] **Step 1: Read the current `scored-talks-grid.tsx`**

Use the Read tool. Identify:
- The import block (for the new hook import)
- The hook call at the top of `ScoredTalksGrid` (where `useCrawlData()` is called)
- The loader gate (`if (loading) return <CrawlLoadingState />` or similar)
- The `rankTalks` call site

- [ ] **Step 2: Add the hook import**

At the top of `src/components/scored-talks-grid.tsx`, add alongside the existing `useCrawlData` import:

```ts
import { useTalkEmbeddings } from "@/hooks/useTalkEmbeddings";
```

- [ ] **Step 3: Add the hook call**

Inside `ScoredTalksGrid`, right after the existing `useCrawlData()` destructuring, add:

```ts
const {
  embeddings,
  loading: embeddingsLoading,
  error: embeddingsError,
} = useTalkEmbeddings();
```

Rename the existing `loading`/`error` destructured variables if there's a name collision. If the existing code destructures as `const { mentions, followCount, interestVector, loading, error } = useCrawlData()`, rename to `crawlLoading` and `crawlError`:

```ts
const {
  mentions,
  followCount,
  interestVector,
  loading: crawlLoading,
  error: crawlError,
} = useCrawlData();
```

- [ ] **Step 4: Update the loader gate**

Find the existing loader gate (probably `if (loading) return <CrawlLoadingState />` or similar). Update to:

```ts
if (crawlLoading || embeddingsLoading) {
  return <CrawlLoadingState />;
}
```

If the existing code has an error gate that shows a `CrawlErrorState`, extend it to include `embeddingsError`:

```ts
if (crawlError || embeddingsError) {
  return <CrawlErrorState error={crawlError ?? embeddingsError ?? "unknown"} />;
}
```

Check what the existing pattern looks like and mirror it. The goal is "block the grid until both hooks succeed, show error if either fails."

- [ ] **Step 5: Update the `rankTalks` call site**

Find the existing `rankTalks(...)` call. Extend it with the two new fields and flip `active.layer2`:

```ts
const scores = rankTalks({
  talks,
  mentions,
  followCount,
  interestVector,
  embeddings: embeddings ?? {},
  active: { layer2: true, layer3: false },
});
```

The `embeddings ?? {}` fallback handles the edge case where the loader gate hasn't fired yet (defensive — should never happen because we gate on `embeddingsLoading` above, but TypeScript's control flow can't prove it).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`

Expected: zero output.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`

Expected: 87 tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/scored-talks-grid.tsx
git commit -m "feat(ui): wire useTalkEmbeddings into ScoredTalksGrid, flip layer 2 live (#24)

This is the commit that flips layer 2 from dark to live. After this
lands:

- Users with a populated interestVector (from #23) see ranking that
  blends inverted network attention (layer 1) with interest similarity
  (layer 2), weighted per the design doc's rescale math (0.625 / 0.375
  with layer 3 still off).
- Users with interestProfileStatus 'no-posts' or 'error' see no
  change — computeLayer2 returns {interestScore: 0} and combineLayers
  degrades to layer-1-only scoring.
- Talks without an embedding in data/embeddings/ (data drift from
  talks.json growing without a new npm run embed) get layer 2 = 0 for
  that specific talk. Other talks score normally.

Changes:
- Add useTalkEmbeddings hook call alongside useCrawlData
- Rename crawl hook's loading/error to crawlLoading/crawlError to
  avoid collision with the new embeddings hook
- Extend the loader gate to wait on both hooks
- Pass interestVector + embeddings into rankTalks with active.layer2:
  true

No server-side changes. The talk-side vectors from #21 and the
user-side vectors from #23 were already available; this task is the
pure client wiring that connects them."
```

---

## Chunk 5: Tighten types and add integration test

### Task 10: Tighten `ScoringInputs` fields to required + add integration test

**Files:**
- Modify: `src/lib/scoring/types.ts`
- Modify: `src/lib/scoring/rank.test.ts`

Task 10 closes the TDD loop: now that all call sites pass the new fields, we can tighten `ScoringInputs.interestVector` and `.embeddings` from optional to required. The compiler will verify that nothing was missed.

- [ ] **Step 1: Tighten `ScoringInputs`**

Open `src/lib/scoring/types.ts`. Find the `ScoringInputs` interface (modified in Task 3). Remove the `?` from the two new fields and update the JSDoc:

```ts
export interface ScoringInputs {
  talks: TalkEntry[];
  mentions: TalkMentions | null;
  followCount: number;
  /** User interest vector from /api/crawl (#23). Null when the profile
   *  build returned "no-posts" or "error" — computeLayer2 returns
   *  interestScore: 0 for every talk in that case. Required so callers
   *  can't accidentally drop it; pass `null` explicitly if unavailable. */
  interestVector: number[] | null;
  /** Talk embeddings from /api/embeddings (#24). Keyed by rkey. Talks
   *  not present in this record fall back to interestScore: 0 — a
   *  data-drift hedge for rkeys added after the last npm run embed.
   *  Required so callers can't accidentally drop it; pass `{}` explicitly
   *  if unavailable (e.g., in tests that only exercise layer 1). */
  embeddings: Record<string, number[]>;
  weights?: ScoringWeights;
  active?: ActiveLayers;
}
```

- [ ] **Step 2: Update `rank.ts`'s `rankTalks` destructuring**

In `rank.ts`, find the `rankTalks` function signature where the new fields are destructured with defaults (from Task 3):

```ts
const {
  talks,
  mentions,
  followCount,
  interestVector = null,
  embeddings = {},
  ...
} = inputs;
```

Remove the defaults (they're now required so TypeScript guarantees they're passed):

```ts
const {
  talks,
  mentions,
  followCount,
  interestVector,
  embeddings,
  ...
} = inputs;
```

- [ ] **Step 3: Typecheck to find any forgotten callers**

Run: `npx tsc --noEmit`

Expected output: compile errors in `src/lib/scoring/rank.test.ts` because existing `rankTalks({ talks, mentions, followCount })` call sites are now missing the two required fields. This is the whole point of the type tightening.

- [ ] **Step 4: Update `rank.test.ts` fixtures**

Open `src/lib/scoring/rank.test.ts`. Find every `rankTalks(...)` and `scoreTalk(...)` call that's missing `interestVector` and `embeddings`. Add both:

```ts
// Before:
const scores = rankTalks({ talks, mentions, followCount });

// After:
const scores = rankTalks({
  talks,
  mentions,
  followCount,
  interestVector: null,
  embeddings: {},
});
```

Pass `null` and `{}` to preserve existing layer-1-only behavior. The tests should pass unchanged.

If the test file calls `scoreTalk(...)` directly with positional args, update those call sites too to pass `null` and `{}` in the new slots.

- [ ] **Step 5: Add one new integration test**

Append to `rank.test.ts` (inside an existing `describe` block or a new one, your call):

```ts
describe("rankTalks — layer 2 integration", () => {
  const RKEY_A = "3mi54oonum62b";
  const RKEY_B = "3mi56m3hnrq2z";

  it("blends layer 2 into the final intensity when active.layer2 is true", () => {
    const talks = [makeTalk(RKEY_A), makeTalk(RKEY_B)];

    // Both talks have identical layer-1 data: 5 follows mentioned each.
    const mentions: TalkMentions = {
      [RKEY_A]: {
        count: 5,
        follows: ["did:plc:a", "did:plc:b", "did:plc:c", "did:plc:d", "did:plc:e"],
        posts: [],
        rsvps: [],
      },
      [RKEY_B]: {
        count: 5,
        follows: ["did:plc:a", "did:plc:b", "did:plc:c", "did:plc:d", "did:plc:e"],
        posts: [],
        rsvps: [],
      },
    };

    // Layer 2 differentiator: RKEY_A is a perfect match for the user's
    // interest vector, RKEY_B is the opposite.
    const result = rankTalks({
      talks,
      mentions,
      followCount: 10,
      interestVector: [1, 0, 0],
      embeddings: {
        [RKEY_A]: [1, 0, 0], // perfect match → interestScore 1.0
        [RKEY_B]: [-1, 0, 0], // opposite → interestScore 0.0
      },
      active: { layer2: true, layer3: false },
    });

    // RKEY_A should rank first because layer 2 lifts it above RKEY_B
    // even though their layer-1 scores are identical.
    expect(result[0].rkey).toBe(RKEY_A);
    expect(result[1].rkey).toBe(RKEY_B);

    // Sanity: layer 2 results are stashed on TalkScore.
    const scoreA = result.find((s) => s.rkey === RKEY_A)!;
    const scoreB = result.find((s) => s.rkey === RKEY_B)!;
    expect(scoreA.layer2.interestScore).toBeCloseTo(1.0, 10);
    expect(scoreB.layer2.interestScore).toBeCloseTo(0.0, 10);
  });
});
```

- [ ] **Step 6: Typecheck + tests**

Run: `npx tsc --noEmit && npm test`

Expected: zero tsc output, 88 tests pass (87 + 1 new integration test).

- [ ] **Step 7: Commit**

```bash
git add src/lib/scoring/types.ts src/lib/scoring/rank.ts src/lib/scoring/rank.test.ts
git commit -m "refactor(scoring): tighten ScoringInputs to required fields (#24)

Closes the TDD loop on #24. interestVector and embeddings were
introduced as optional fields in Task 3 to preserve the TDD green
state while migrating the pipeline. Now that all call sites pass
them explicitly (scored-talks-grid.tsx in Task 9, rank.test.ts
fixtures in this commit), tighten them to required so the compiler
catches any future caller that forgets.

Also adds one integration test to rank.test.ts that verifies the
full layer-2 blend: two talks with identical layer-1 data but
opposite-direction embeddings, with active.layer2 true, should
sort with the perfect-match talk first. Pins the stashed
TalkScore.layer2 field contract end-to-end."
```

---

## Final Validation

After all 10 tasks commit:

- [ ] **Full test suite**: `npm test` — expect **88 tests pass** (6 test files from #23 baseline + new `interest.test.ts` + new `route.test.ts` = same file count minus deleted files, but test counts go 79 → 88).
- [ ] **Typecheck**: `npx tsc --noEmit` — zero output.
- [ ] **Lint**: `npx eslint src/lib/scoring src/app/api/embeddings src/hooks/useTalkEmbeddings.ts src/components/scored-talks-grid.tsx` — zero errors.
- [ ] **Build**: `npm run build` — should complete without errors. The `/api/embeddings` route should show up in the route manifest as a static route (due to `export const dynamic = 'force-static'`).
- [ ] **Smoke check on staging**: after deploy, log in, open devtools → Network. Expect:
  - `/api/embeddings` returns 200 with `Cache-Control: public, max-age=31536000, immutable`
  - Response body is ~400 KB gzipped
  - `/talks` grid renders talks ranked by a blend of layer 1 + layer 2
  - Second mount (e.g., refresh the page): `/api/embeddings` shows "from disk cache" in devtools (immutable cache hit)
  - A user logged in with `interestProfileStatus === "no-posts"` (verify via `/api/crawl` response) sees the same ranking as before layer 2 shipped — graceful degradation

---

## Known Follow-Ups (out of scope)

- **Post-launch tuning**: if real user data shows layer 2's cosine distribution is too compressed (band around 0.6–0.85 too narrow to meaningfully differentiate), the follow-up is a drop-in swap of `computeLayer2`'s normalization from shift-and-scale to rank-then-spread. Zero schema change.
- **Layer 3 (friend recommendations)**: still blocked on #22 lexicon publishing.
- **Slider UI (#20)**: the `surpriseSlider` variable already flows through `combineLayers` with a default of 0.5. #20 adds the UI control; no scoring engine change needed.
- **Rebuild talk embeddings cadence**: currently manual (`npm run embed` before each release). If talks get added between releases, those talks will score layer 2 = 0 until the next embed run. Acceptable for now; a future automation task could hook embedding generation to data sync.
