# Cosine Similarity Matching Design Spec

**Date:** 2026-04-13
**Issue:** Chainlink #24 (Cosine similarity matching)
**Status:** Approved (pending review)
**Depends on:**
- #21 — talk embeddings at `data/embeddings/{rkey}.json` and `cosineSimilarity` helper at `src/lib/scoring/cosine.ts`
- #23 — user `interestVector` flowing through `/api/crawl` and `useCrawlData`
**Unblocks:** Layer 2 of the three-layer scoring engine goes live. User-visible behavior changes for the first time since the layer-1-only ship.

---

## 1. Goal

Replace `computeInterestStub` with a real `computeLayer2` function that computes cosine similarity between the user's interest vector (from #23) and every talk's persisted embedding (from #21), normalizes the result into `[0, 1]`, and contributes it to the existing `combineLayers` pipeline. After this work lands, **layer 2 of the three-layer scoring engine is live** and the grid ranking visibly reflects interest similarity on top of inverted network attention.

No new data is generated. No external APIs are called at request time. The pipeline is pure composition: #21 produced the corpus vectors, #23 produced the user vectors, #24 wires them together with the cosine helper that also shipped in #21.

---

## 2. Background

Understory's three-layer scoring engine in `src/lib/scoring/` combines three per-talk signals:

1. **Layer 1 — Network attention (inverted).** Live today. `computeLayer1` scores talks by how *few* of the user's follows discussed them, producing a `[0, 1]` signal where 1 = nobody in the network mentioned it ("your timeline missed this").
2. **Layer 2 — Interest similarity.** Currently a stub (`computeInterestStub` returns `{interestScore: 0}`). **This spec makes it real.**
3. **Layer 3 — Friend recommendations.** Still a stub (`computeFriendStub`). Blocked on #22 lexicon publishing. Stays dark in this spec.

`combineLayers` in `src/lib/scoring/combine.ts:66` is already designed for this transition: it reads an `ActiveLayers` flag set and rescales the design weights (`0.5 / 0.3 / 0.2`) over whichever layers are currently live. Flipping `active.layer2: true` is half the change; the other half is making `computeInterestStub` actually compute something.

The existing stub path means no data-flow work is needed inside `combineLayers` or `rankTalks`'s aggregation pass. We swap one function for another, thread two new inputs through `ScoringInputs`, and flip one boolean at the call site.

The `cosineSimilarity` helper at `src/lib/scoring/cosine.ts` already exists from #21, accepts `ArrayLike<number>` (so `number[]` from JSON works directly), returns 0 on zero-magnitude vectors (no NaN propagation), and throws with a pinned error message on length mismatch. It is a tested, ready-to-consume primitive.

The user interest vector is already served through `/api/crawl`'s `CrawlResult.interestVector: number[] | null` field (from #23), and `useCrawlData` already surfaces it to the client (`CrawlData.interestVector: number[] | null`). All we need is the **talk** side of the comparison delivered to the browser.

---

## 3. Decisions and Rationale

### 3.1 Talk embeddings delivered via a dedicated `/api/embeddings` endpoint

The 108 `data/embeddings/{rkey}.json` files are already bundled into the Next.js standalone output (via `outputFileTracingIncludes: { "/*": ["./data/**/*"] }` from the Railway deploy spec), but the browser can't `fs.readFileSync` them. Four delivery options were considered:

1. **Ship embeddings in every `/api/crawl` response** — bloats every 30-second crawl response by ~400 KB gzipped, mostly redundant across users
2. **Server-side scoring** — breaks the client-side-math design principle and makes the slider UI (#20) a server round-trip
3. **Separate `/api/embeddings` endpoint with immutable caching** — one-time cost per user per release, then cached by the browser's HTTP cache
4. **Bundle into the RSC payload of the `/talks` page** — bloats every initial HTML payload, not cacheable cross-session

**Chose option 3.** A new `/api/embeddings` route returns the aggregated `Record<string, number[]>` of all 108 talk embeddings with `Cache-Control: public, max-age=31536000, immutable`. First page load pays the ~400 KB gzipped cost once; subsequent loads hit the browser's HTTP cache instantly. The data only changes when `data/embeddings/` changes, which happens offline via `npm run embed`, so `immutable` caching is semantically correct — a new release with new embeddings gets a fresh bundle hash if needed.

**Keeps `/api/crawl` small.** The crawl response is still a 30-second-budget critical path. Adding 400 KB to every call even if it gzips well is wasteful when the data is static corpus content.

**Preserves client-side scoring.** The slider UI (#20) will re-weight layers at runtime, which needs raw per-talk scores in the browser. Any server-side design would require a round-trip per slider drag. Option 3 keeps layer 2 raw scores in the browser alongside layer 1.

**Rejected alternatives:** option 1 adds 400 KB to every user-critical crawl response for no cache benefit. Option 2 breaks the original architectural principle in `docs/understory-design.md`. Option 4 adds the same bloat to the initial HTML payload with weaker caching semantics than a dedicated JSON endpoint.

### 3.2 Normalization: shift-and-scale `(cosine + 1) / 2`

Cosine similarity returns `[-1, 1]`. `combineLayers` expects `[0, 1]`. Three normalization options were considered:

1. **Shift-and-scale `(cos + 1) / 2`** — chosen. Simple, lossless, every talk gets a score.
2. **Clamp-at-zero `max(0, cos)`** — aggressive contrast but Voyage query-document cosines are almost always positive in practice, so the normalization gives effectively the same compressed band.
3. **Rank-then-spread across the corpus** — maximum visual contrast but rank-based scoring doesn't compose cleanly with layer 1's absolute ratio.

**Chose shift-and-scale.** The typical Voyage cosine spread for conference-query vs. talk-document lands in `0.2–0.7`, which shift-and-scale maps to `0.6–0.85`. That's a narrow band, but it's OK because `combineLayers` handles the relative weighting: layer 2's contribution is `interestScore × (1 - surpriseSlider) × 0.375` (weight `0.3 / 0.8` after rescale without layer 3). A typical 0.75 interestScore contributes ~0.28 to the final intensity, which is a meaningful but not dominant lift on top of layer 1.

If post-launch data shows layer 2 is too compressed to differentiate talks, **rank-then-spread (option 3) is a drop-in replacement** — it requires no schema change, only a tuning swap inside `computeLayer2`. Deferring that decision until we have real user behavior.

### 3.3 Zero cases: three explicit defensive paths

Layer 2 returns `{interestScore: 0}` in three cases, each for a different reason:

1. **User's `interestVector` is null** — the profile build in #23 returned `"no-posts"` or `"error"`. Layer 2 contributes 0 for all talks. `combineLayers` still runs layer 1 unaffected.
2. **Talk has no embedding file on disk** — data drift: `data/embeddings/` doesn't cover this rkey yet (e.g., a talk was added to `talks.json` after the last `npm run embed` run). Layer 2 contributes 0 for that specific talk. Other talks with embeddings score normally.
3. **Dimension mismatch between user vector and talk vector** — hard error. This should be impossible in practice because both vectors are produced by `voyage-3.5-lite` at 1024 dimensions, and both sides validate model + dimensions at write time. A mismatch would indicate a bug or corrupt data, not normal operation. `cosineSimilarity` already throws with a clear message on length mismatch (contract pinned in #21's tests); `computeLayer2` lets that throw propagate rather than silently returning 0.

Cases 1 and 2 are recoverable — missing data, layer 2 is just 0. Case 3 is a bug. Swallowing it silently would hide a real problem.

### 3.4 Scoring pipeline: extend `ScoringInputs`, no module state

`computeLayer2` needs two inputs the existing stub signature doesn't have: the user's `interestVector` and a lookup from `rkey → talkVector`. Three options for plumbing:

1. **Pass both through `ScoringInputs`** — chosen.
2. **Closure-captured embeddings** — function-valued inputs, harder to test, adds "when is the closure rebuilt?" questions.
3. **Module-level singleton embedding store** — hidden mutable state, doesn't compose with pure functions.

**Chose option 1.** `ScoringInputs` is already the bag of everything the pipeline needs. Adding `interestVector: number[] | null` and `embeddings: Record<string, number[]>` fits the existing pattern. Testing is trivial — unit tests construct their own `ScoringInputs` with hand-crafted vectors. `rankTalks → scoreTalk → computeLayer2` stays a chain of pure functions.

**Pass-through at every level.** `ScoringInputs` → `rankTalks` → `scoreTalk` (via new parameters) → `computeLayer2`. Three signature changes but zero new indirection.

### 3.5 `Record<string, number[]>`, not `Map<string, Float32Array>`

The embeddings arrive as JSON (`number[]` per talk). `cosineSimilarity` accepts `ArrayLike<number>`, which includes both `number[]` and `Float32Array`. Converting to `Map<string, Float32Array>` would allocate at load time and do nothing useful — the cosine math accepts the `number[]` directly and Float32 doesn't help precision here (voyage vectors are float32 upstream anyway).

`Record<string, number[]>` is the raw JSON shape with zero conversion cost and zero indirection. Use it directly.

### 3.6 New `useTalkEmbeddings` hook, symmetric with `useCrawlData`

Three options for client-side delivery:

1. **New hook** — chosen.
2. **Extend `useCrawlData`** — conflates two independent cache lifetimes (crawl = 30-minute TTL, embeddings = forever).
3. **Server-component prop from `/talks` page** — bloats the initial HTML payload, rejected in §3.1.

**Chose option 1.** `useTalkEmbeddings` mirrors `useCrawlData`'s shape (`{embeddings, loading, error}`), fetches `/api/embeddings` once on mount, caches in React state, and returns to the consumer. `ScoredTalksGrid` calls both hooks and blocks the grid render behind a single combined loader gate (`if (loading || embeddingsLoading) → <CrawlLoadingState />`).

**Caches are different.** `useCrawlData` refetches on every mount against a 30-minute server cache. `useTalkEmbeddings` refetches once per browser session — the `immutable` HTTP cache header means the second mount is a browser-level hit.

**Name stays honest.** Extending `useCrawlData` would make the hook's name lie. Separate hook, separate concern.

### 3.7 Delete `computeInterestStub`, don't keep as a fallback

Tempting to keep the stub around as a conditional fallback ("use real layer 2 when embeddings are loaded, stub otherwise") but it's the wrong tradeoff:

- `combineLayers` already handles the "layer 2 isn't live yet" case via the `active.layer2` flag. Rescaling handles partial deployment.
- Keeping a stub path as a fallback doubles the code paths in `scoreTalk` for a failure mode that shouldn't happen at runtime (embeddings missing = a bug we want loud).
- The combined loader gate in `ScoredTalksGrid` already blocks the grid until both hooks resolve. There's no "rendering with partial data" state to stub over.

**Delete `src/lib/scoring/interestStub.ts`.** Replace with `src/lib/scoring/interest.ts` that exports `computeLayer2`. `src/lib/scoring/index.ts` drops the stub re-export. One code path, loud failures, no shadow state.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  SERVER                                                             │
│                                                                     │
│  /api/embeddings — NEW route                                        │
│    Reads data/embeddings/*.json at first request into a module      │
│    cache, returns { [rkey]: number[] } with immutable cache         │
│    headers. ~50ms file read, ~400 KB gzipped response body.         │
│                                                                     │
│  /api/crawl — UNCHANGED (from #23)                                  │
│    Still returns { talkMentions, interestVector, ... }              │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  CLIENT                                                             │
│                                                                     │
│  ScoredTalksGrid                                                    │
│    │                                                                │
│    ├─ useCrawlData()                                                │
│    │     → { mentions, followCount, interestVector, loading, ... } │
│    │                                                                │
│    ├─ useTalkEmbeddings()   ← NEW                                  │
│    │     → { embeddings: Record<rkey, number[]>,                    │
│    │         loading, error }                                       │
│    │                                                                │
│    ├─ if (loading || embeddingsLoading) → <CrawlLoadingState/>     │
│    │                                                                │
│    ├─ rankTalks({                                                   │
│    │     talks, mentions, followCount,                              │
│    │     interestVector,       ← new                                │
│    │     embeddings,           ← new                                │
│    │     weights,                                                   │
│    │     active: { layer2: true, layer3: false }   ← flipped       │
│    │   })                                                           │
│    │                                                                │
│    └─ render cards, intensity now blends layer 1 + layer 2          │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  SCORING ENGINE (src/lib/scoring/)                                  │
│                                                                     │
│  rankTalks(inputs)                                                  │
│    │                                                                │
│    └─ scoreTalk(talk, mentions, followCount,                        │
│                 interestVector, embeddings, weights, active)        │
│         │                                                           │
│         ├─ computeLayer1(mention, followCount)    (existing)        │
│         │                                                           │
│         ├─ computeLayer2(talk, interestVector, embeddings) ← NEW    │
│         │     if (interestVector == null)                           │
│         │        return { interestScore: 0 }                        │
│         │     const talkVec = embeddings[talk.rkey]                 │
│         │     if (!talkVec)                                         │
│         │        return { interestScore: 0 }                        │
│         │     // cosineSimilarity throws on length mismatch —       │
│         │     // we let that propagate as a loud error.             │
│         │     const sim = cosineSimilarity(interestVector, talkVec) │
│         │     return { interestScore: (sim + 1) / 2 }               │
│         │                                                           │
│         ├─ computeFriendStub(talk)                 (still a stub)   │
│         │                                                           │
│         └─ combineLayers(l1, l2, l3, weights,                       │
│                          active = { layer2: true, layer3: false }) │
│            Existing rescale math from combine.ts:66 kicks in:       │
│              w1 = 0.5 / 0.8 = 0.625                                 │
│              w2 = 0.3 / 0.8 = 0.375                                 │
│            intensity = clamp(                                       │
│              l1 * 0.625 + l2 * (1 - surprise) * 0.375,              │
│              0, 1                                                    │
│            )                                                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Three invariants worth pinning:**

1. **`computeInterestStub` is deleted, not kept.** `src/lib/scoring/interestStub.ts` is replaced by `src/lib/scoring/interest.ts`. `rank.ts` imports and calls `computeLayer2` directly.
2. **`computeFriendStub` stays untouched.** Layer 3 remains dark. `active.layer3: false`.
3. **The `no-embedding-for-this-talk` defensive path is not decorative.** It catches data drift gracefully — a talk added to `talks.json` after the last `npm run embed` run gets `layer2 = 0` for that one talk, not a thrown error.

---

## 5. File map

### 5.1 New files

**`src/app/api/embeddings/route.ts`** — Next.js route handler. Reads `data/embeddings/*.json` into a module-level cache on first request; subsequent requests hit the cache with no I/O. Returns `Record<rkey, number[]>` with `Cache-Control: public, max-age=31536000, immutable`. ~50 lines.

**`src/hooks/useTalkEmbeddings.ts`** — Client hook mirroring `useCrawlData`. Fetches `/api/embeddings` once on mount via `useEffect`, caches the result in `useState`, returns `{embeddings: Record<string, number[]> | null, loading: boolean, error: string | null}`. Uses the same cancellation pattern as `useCrawlData` to handle unmount during fetch. ~60 lines.

**`src/lib/scoring/interest.ts`** — Replaces `interestStub.ts`. Exports `computeLayer2(talk, interestVector, embeddings)` returning `{interestScore: number}`. Pure function. Implements the three zero-cases (null user vector, missing talk embedding, dimension mismatch-throws-through) plus shift-and-scale normalization. ~30 lines.

**`src/lib/scoring/interest.test.ts`** — 7 unit tests for `computeLayer2`: happy path, orthogonal, opposite, null user vector, missing talk embedding, dimension mismatch throws, zero-magnitude talk vector.

**`src/app/api/embeddings/route.test.ts`** — 1 unit test for the route handler. Mocks `fs.readdirSync` + `fs.readFileSync`, asserts response shape + status + cache header.

### 5.2 Modified files

**`src/lib/scoring/types.ts`** — Extend `ScoringInputs` with two new fields. Both required (not optional) so callers can't accidentally drop them:

```ts
export interface ScoringInputs {
  talks: TalkEntry[];
  mentions: TalkMentions | null;
  followCount: number;
  /** User interest vector from /api/crawl (#23). Null when the profile
   *  build returned "no-posts" or "error" — computeLayer2 will return
   *  interestScore: 0 for every talk in that case. */
  interestVector: number[] | null;
  /** Talk embeddings from /api/embeddings (#24). Keyed by rkey. Talks
   *  not present in this record fall back to interestScore: 0 — a
   *  data-drift hedge for rkeys added after the last npm run embed. */
  embeddings: Record<string, number[]>;
  weights?: ScoringWeights;
  active?: ActiveLayers;
}
```

The `Layer2Result` type (currently `InterestStubResult`) stays `{interestScore: number}` but gets renamed for honesty. `combine.ts` imports it from the new location.

**`src/lib/scoring/rank.ts`** — `scoreTalk`'s signature gains two parameters (or destructures them from inputs). The `computeInterestStub(talk)` call becomes `computeLayer2(talk, interestVector, embeddings)`. `rankTalks` threads the new fields from `inputs` into each `scoreTalk` call. The normalization pass at the bottom (lines 131–161) also threads them through when it recomputes intensity via `combineLayers`.

**`src/lib/scoring/combine.ts`** — **No code changes.** The rescale math already handles any combination of active layers. Update the type import from `InterestStubResult` to `Layer2Result` (both in the import and in the function signature).

**`src/lib/scoring/index.ts`** — Barrel exports. Remove `computeInterestStub` / `InterestStubResult` re-exports, add `computeLayer2` / `Layer2Result`.

**`src/components/scored-talks-grid.tsx`** — The consumer change:

1. Add `useTalkEmbeddings` hook call alongside `useCrawlData`.
2. Update the loader gate: `if (loading || embeddingsLoading) return <CrawlLoadingState />`.
3. Update the `rankTalks` call: pass `interestVector` from `useCrawlData`, `embeddings` from `useTalkEmbeddings`, set `active: { layer2: true, layer3: false }`.

### 5.3 Deleted files

**`src/lib/scoring/interestStub.ts`** — Replaced by `interest.ts`. If a corresponding `interestStub.test.ts` exists (verify during implementation), delete it too — `interest.test.ts` replaces it.

### 5.4 Unchanged files worth noting

- `src/lib/scoring/cosine.ts` and `cosine.test.ts` — shipped in #21, consumed here.
- `src/lib/crawl/interest-profile.ts` — shipped in #23, produces the `interestVector`.
- `src/lib/crawl/crawler.ts` — shipped in #23, passes `interestVector` through.
- `src/hooks/useCrawlData.ts` — shipped in #23, surfaces `interestVector` to the client.
- `data/embeddings/*.json` — shipped in #21, read at request time by the new route.
- `scripts/embed.ts`, `scripts/embed-smoke.ts` — offline pipeline unchanged.

---

## 6. `computeLayer2` specification

### 6.1 Signature

```ts
import type { TalkEntry } from "@/lib/types";

export interface Layer2Result {
  /** Similarity score in [0, 1]. 0 when the user vector is null,
   *  when the talk has no embedding, or when cosine is -1. 0.5 when
   *  the vectors are orthogonal. 1.0 when they are identical. */
  interestScore: number;
}

export function computeLayer2(
  talk: TalkEntry,
  interestVector: number[] | null,
  embeddings: Record<string, number[]>,
): Layer2Result;
```

### 6.2 Flow

```ts
export function computeLayer2(
  talk: TalkEntry,
  interestVector: number[] | null,
  embeddings: Record<string, number[]>,
): Layer2Result {
  // Zero-case 1: user has no profile vector (no-posts / error from #23).
  if (interestVector === null) {
    return { interestScore: 0 };
  }

  // Zero-case 2: this specific talk has no embedding on disk.
  // Data-drift hedge — a talk added after the last `npm run embed`
  // should get interestScore: 0 for layer-2, not crash the whole ranker.
  const talkVector = embeddings[talk.rkey];
  if (!talkVector) {
    return { interestScore: 0 };
  }

  // Dimension mismatch is a loud error — cosineSimilarity throws with
  // the exact message contract pinned in #21's tests. We let that
  // propagate rather than silently returning 0, because a mismatch
  // means either a bug or corrupt data, not normal operation.
  const cosine = cosineSimilarity(interestVector, talkVector);

  // Shift-and-scale into [0, 1]. Cosine is [-1, 1]; the naive remap
  // preserves every talk's relative position and composes cleanly
  // with combineLayers' linear weighting.
  return { interestScore: (cosine + 1) / 2 };
}
```

### 6.3 Error handling contract

- **Never returns NaN or Infinity.** `cosineSimilarity` already returns 0 on zero-magnitude inputs (no NaN propagation — contract tested in #21's `cosine.test.ts`).
- **Never silently swallows a dimension mismatch.** `cosineSimilarity` throws on length mismatch. `computeLayer2` does not try/catch that — it propagates up through `scoreTalk` → `rankTalks` and should crash the scoring pass. The three known user-facing zero-cases above (null vector, missing talk embedding) are handled explicitly; everything else is a bug.
- **Pure function.** No I/O, no closures, no state. Deterministic on its three inputs.

---

## 7. Testing strategy

### 7.1 Unit tests — `src/lib/scoring/interest.test.ts`

Seven tests covering the `computeLayer2` contract. All use hand-crafted `TalkEntry` fixtures and synthetic vectors — no network, no fs, no mocks beyond a trivial `Record` literal.

| # | Test | Input | Expected |
|---|---|---|---|
| 1 | Happy path (identical vectors) | `interestVector = [1,0,0]`, `embeddings = {abc: [1,0,0]}`, talk rkey `abc` | `{interestScore: 1.0}` |
| 2 | Orthogonal vectors | `[1,0,0]` vs `[0,1,0]` | `{interestScore: 0.5}` |
| 3 | Opposite vectors | `[1,0,0]` vs `[-1,0,0]` | `{interestScore: 0.0}` |
| 4 | Null user vector | `interestVector = null` | `{interestScore: 0}`, no cosine call (verify via side-effect-free math) |
| 5 | Missing talk embedding | `embeddings = {}` (rkey not present) | `{interestScore: 0}` |
| 6 | Dimension mismatch throws | `interestVector = [1,0,0]`, `embeddings = {abc: [1,0]}` | Throws with `/cosine: length mismatch/` |
| 7 | Zero-magnitude talk vector | `embeddings = {abc: [0,0,0]}`, `interestVector = [1,2,3]` | `{interestScore: 0.5}` (cosine returns 0, shift-and-scale = 0.5) |

### 7.2 Unit test — `src/app/api/embeddings/route.test.ts`

One test mocking `fs.readdirSync` + `fs.readFileSync` to return two synthetic embedding files. Hits the route (via Next.js's `Response` pattern), asserts:
- Status 200
- Response body is `Record<rkey, number[]>` shape with two entries
- `Cache-Control` header contains both `max-age=31536000` and `immutable`

### 7.3 Integration test — updated `src/lib/scoring/rank.test.ts`

The existing rank tests continue to pass. One new test verifies the end-to-end integration:

```ts
it("blends layer 2 into the final intensity when active.layer2 is true", () => {
  const talks: TalkEntry[] = [ /* two talks with known rkeys */ ];
  const result = rankTalks({
    talks,
    mentions: { /* layer-1 fixture */ },
    followCount: 10,
    interestVector: [1, 0, 0],
    embeddings: {
      "talk-a": [1, 0, 0],     // perfect match
      "talk-b": [-1, 0, 0],    // opposite
    },
    active: { layer2: true, layer3: false },
  });
  // talk-a should score higher than talk-b even if their layer-1
  // scores are identical, because layer 2 now contributes.
  expect(result[0].rkey).toBe("talk-a");
});
```

### 7.4 Not tested

- **Live `/api/embeddings` request.** The route test mocks fs; live smoke happens on staging. First page load fetches the 400 KB file, second load is an HTTP cache hit (verified via devtools network panel).
- **`useTalkEmbeddings` in a React tree.** It's a thin wrapper around `fetch` + `useState` + `useEffect`, identical in shape to `useCrawlData` which has no unit test. Spot-check via staging.
- **Embedding quality on real user posts.** Subjective; verify by logging in as yourself on staging and eyeballing whether the ranked grid "feels right" — talks you'd expect to be topically aligned should rise.

### 7.5 Test count progression

- Before #24: 79 tests (from #23 final state)
- After #24: 86 tests — 7 new interest tests + 1 route test + 1 rank integration test − 1 stub test (`interestStub.test.ts` if it exists today; verified during implementation)

---

## 8. Cost and operational notes

| Concern | Number |
|---|---|
| Voyage API calls at request time | 0 (all embedding data is pre-computed from #21) |
| `/api/embeddings` response body size | ~850 KB uncompressed, ~400 KB gzipped |
| `/api/embeddings` first-load latency | ~50ms fs read + HTTP transfer |
| `/api/embeddings` cached latency | browser HTTP cache hit (~1ms) |
| Client-side scoring cost per talk | ~1024 float multiplications + 1 sqrt (microseconds) |
| Total scoring cost for 108 talks | sub-millisecond for the full grid render |
| `useCrawlData` behavior change | none — it already surfaces `interestVector` |
| New module-level cache memory | ~400 KB per server worker (one-shot warmup) |

Layer 2 adds zero request-time API cost. The only new network traffic is the one-time `/api/embeddings` fetch per user per release.

---

## 9. Scope boundary

### 9.1 What #24 produces

- New route: `src/app/api/embeddings/route.ts` + 1 test
- New hook: `src/hooks/useTalkEmbeddings.ts`
- New helper: `src/lib/scoring/interest.ts` + 7 tests (replaces `interestStub.ts`)
- Modified: `src/lib/scoring/types.ts` (extended `ScoringInputs`)
- Modified: `src/lib/scoring/rank.ts` (two new parameters, calls `computeLayer2`)
- Modified: `src/lib/scoring/combine.ts` (one type-import rename, no logic change)
- Modified: `src/lib/scoring/index.ts` (barrel rename)
- Modified: `src/components/scored-talks-grid.tsx` (loader gate + rankTalks call site)
- Modified: `src/lib/scoring/rank.test.ts` (one new integration test)
- Deleted: `src/lib/scoring/interestStub.ts` (+ test if present)

### 9.2 What #24 does NOT do

- ❌ Layer 3 (friend recommendations) — still stubbed, `active.layer3: false`. Blocked on #22 lexicon publishing.
- ❌ The `surpriseSlider` UI (#20). The slider variable already flows through `combineLayers` with a stubbed value — #24 just flips layer 2 from 0 to real, and the slider lift gets applied automatically. The slider *UI* stays in #20.
- ❌ Re-tune the design weights (50/30/20). These are the canonical values from the design doc; tuning is a post-launch decision with real data.
- ❌ Server-side scoring. The scoring engine stays in the browser per the original three-layer design principle.
- ❌ Post-ship telemetry. If layer 2's normalization turns out to be too compressed, the follow-up swap to rank-then-spread (§3.2) is a one-line change inside `computeLayer2`.
- ❌ Mobile-specific performance optimizations. 108 vectors × 1024 floats is sub-millisecond on any phone from the last five years. No virtualization or precomputation needed.

### 9.3 Post-merge user-visible changes

After #24 lands on staging:

- Cards ranked by `rankTalks` now reflect interest similarity in addition to network attention.
- Talks topically aligned with the user's recent posts visibly rise in position.
- The coverage badge stays the same (it reflects layer-1 normalizedCoverage, not layer 2).
- The glow intensity changes (layer-2 contributes to `intensity`, which drives the CSS `--glow` variable).
- Users with `interestProfileStatus === "no-posts"` or `"error"` from #23 see **no change** from current behavior — layer 2 contributes 0 for them and layer 1 is still the only signal. The feature degrades gracefully.

---

## 10. Open questions

None at time of writing. All architectural decisions are listed in §3 with rationale.
