# User Interest Profiling Design Spec

**Date:** 2026-04-13
**Issue:** Chainlink #23 (User interest profiling)
**Status:** Approved (pending review)
**Depends on:** #21 (transcript embeddings) — the talk side of layer-2 similarity. The cosine helper at `src/lib/scoring/cosine.ts` is also from #21 and will be consumed by #24.
**Unblocks:** #24 (Cosine similarity matching), which wires this spec's output into `combineLayers` to light up layer 2 of the scoring engine.

---

## 1. Goal

Produce a single 1024-dimension "interest profile" vector per logged-in user, derived from their recent Bluesky posts, and expose it through `/api/crawl` so the in-browser scoring engine can later compute cosine similarity against every talk's embedding. The profile is the **user side** of layer 2; the talk side landed in #21.

After this work lands, every authenticated user's `/api/crawl` response carries either a valid interest vector (built from their recent posts) or an explicit null with a status code explaining why. **Layer 2 of the scoring engine stays off** — `computeInterestStub` still returns `{interestScore: 0}` — until #24 wires the cosine math into `combineLayers`.

---

## 2. Background

Understory's three-layer client-side scoring engine needs two vectors at runtime for layer 2 to compute a real interest-similarity score:

1. **Talk embedding** — one 1024-dim `voyage-3.5-lite` vector per transcript, already persisted to `data/embeddings/{rkey}.json` by #21.
2. **User interest vector** — one 1024-dim `voyage-3.5-lite` vector derived from the user's own Bluesky posts. *This spec.*

Then `cosineSimilarity(userVector, talkVector)` produces a score in `[-1, 1]` that layer 2 contributes to the talk's overall intensity. #24 handles the cosine math and `combineLayers` integration.

The profile is a **per-session snapshot**, not a long-lived record. It rebuilds whenever the 30-minute `/api/crawl` cache expires or a force-refresh is triggered. No persistence, no publishing to AT Protocol, no user-visible surface.

---

## 3. Decisions and Rationale

### 3.1 Post scope: 100 recent originals, capped at 90 days

The profile is built from the user's **original posts** (exclude reposts, exclude replies to other handles, **keep self-replies** because threads are often topical and represent the user's own voice). Selection rules:

- Up to **100 posts** (hard cap for cost predictability)
- All within the last **90 days** (bounded staleness so quiet users still get fresh signal and chatty users don't bury their current interests under old ones)
- Whichever limit hits first determines the final count

**Why not just "last N posts" or "last N days" alone**: last-N-posts gives inconsistent recency across users (a chatty user's 100 most recent posts may span a week while a quiet user's may span years); last-N-days gives inconsistent cost (a high-volume user could produce 500 posts a week, blowing the Voyage token budget). The intersection gives bounded cost AND bounded staleness.

**Why 100/90**: 100 posts at ~30 tokens average = ~3k tokens per profile build, comfortably inside Voyage's 32k input limit. 90 days is long enough that even low-post-volume users usually have something to embed, but short enough that the profile reflects current interests rather than ancient ones.

**Why exclude reposts and other-user replies but keep self-replies**: reposts are the other author's voice; replies to other handles are context-dependent and often short / non-topical; self-replies (threads) are the user continuing their own idea and do represent their voice.

### 3.2 Aggregation: batched per-post embedding + mean-pool

Each of the up-to-100 posts gets embedded separately in a single Voyage batch API call with `input_type: "query"`, then the N returned vectors are **element-wise averaged** into one 1024-dim profile vector. Each post contributes equally.

**Why not concatenate all posts into one Voyage document**: Voyage would return one vector regardless, but the model's internal attention would pool over the concatenation in ways that are hard to reason about and potentially biased toward whatever tokens dominate the input. Mean-pooling N per-post query vectors is the standard retrieval-literature approach for "build a query vector from many short user texts," and it's the usage Voyage's `input_type: "query"` is trained for.

**Why not weighted aggregation (recency/engagement/length)**: YAGNI. Mean-pool gives clean semantics (each post = one equal vote, matching user intuition that "my posts represent my interests"). If real users show unweighted mean-pool underperforming, recency weighting is the obvious first tuning knob — deferrable.

**Batching is effectively free**: Voyage supports up to 1000 inputs per request. A single batched call for 100 posts costs the same as one call for 1 post, and it's one API round-trip regardless. No extra round-trips, no per-post rate limiting.

### 3.3 Computation location: extend `/api/crawl` (best-effort)

The profile build lives inside the existing `/api/crawl` handler, alongside the Layer 1 work (follow crawl, RSVPs, conference post search). Reasons:

- Same OAuth session, same user DID, same 30-minute cache lifetime — natural coupling
- `/api/crawl` already has concurrent-request coalescing, session handling, and error paths wired up
- Layer 1 and Layer 2 inputs arrive atomically in a single response — the scoring engine doesn't need to juggle two separate loading states
- The added Voyage call costs ~300–500ms, comfortably inside the existing 30s crawl budget

**Best-effort contract**: the profile build is wrapped in `try/catch`. On any failure (no posts, Voyage error, token limit exceeded), the function returns `{vector: null, postCount: N, status: "..."}` — it does **not** abort the crawl. Layer 1 still works. The crawl response carries an explicit `interestVector: null` plus an `interestProfileStatus` diagnostic, and the client gracefully degrades to Layer 1 + Layer 3 scoring (since `computeInterestStub` already returns 0 for missing data).

**Rejected alternative — separate `/api/profile` endpoint**: tempting for failure isolation, but splits the OAuth session setup, doubles the HTTP round-trips on login, duplicates cache/coalescing infrastructure, and forces the client to juggle two loading states for data that should always arrive together. The failure-isolation argument is weak because Layer 2 is additive — if the profile build fails, the scoring engine just weights Layers 1 + 3, which is the current shipping behavior anyway.

### 3.4 Retry/notification: explicitly deferred

The spec **does not** build a background retry mechanism, a notification channel, or a "profile is ready, refresh to see it" UX. Reasoning:

1. The most common failure mode is **category 2** (user has 0 usable posts — new account, pure reposter, all replies). A retry won't fix this until the user posts something new.
2. **Category 1** (transient Voyage/network errors) is handled for free by the existing 30-minute `/api/crawl` cache — any SPA navigation past that window triggers a new crawl attempt.
3. **Category 3** (policy rejection, account deleted) can't be retried.
4. Building a job queue (BullMQ/Redis/Railway cron) + a notification channel (SSE/WebSockets/polling) is heavyweight infrastructure for a feature that should rarely trigger and is already gracefully degraded.

**What we do instead in this spec:**

- **Log the failure category** in server logs so we get telemetry on whether transient failures actually happen in the wild. `console.error("[interest-profile] transient: ${err}")` for network/API errors; `console.warn("[interest-profile] no-posts: user has 0 usable posts")` for the empty case.
- **Expose `interestProfileStatus: "ok" | "no-posts" | "error"`** in the `CrawlResult` so the client can show differentiated UI per failure mode if/when UI for Layer 2 gets added.
- **Nothing else.** If staging logs later show transient failures are common, the cheapest next step is client-side auto-retry (one fetch after 30s when `status === "error"`), not backend job queues.

### 3.5 Module boundary: `src/lib/crawl/` not `src/lib/scoring/`

`buildInterestVector` lives in `src/lib/crawl/interest-profile.ts` because it's a **crawl concern** — it runs inside the `/api/crawl` server handler, uses the OAuth'd AT Protocol agent, fetches posts via `getAuthorFeed`, and hits the Voyage API with a server-held API key. The `src/lib/scoring/` directory stays pure, client-safe math (`cosineSimilarity`, `combineLayers`, the stubs).

When #24 consumes the profile vector client-side, it reads from the `CrawlResult` response shape, not from a direct import. This keeps the browser bundle free of any Voyage-calling code and preserves the "scoring is pure math in the browser" design principle from the original three-layer architecture spec.

### 3.6 Response shape: `number[]`, not packed bytes

The profile vector flows through the `/api/crawl` JSON response as `number[]`, matching #21's on-disk pattern for `data/embeddings/{rkey}.json`. The cosine helper at `src/lib/scoring/cosine.ts` already accepts `ArrayLike<number>`, so #24 can pass the `number[]` directly into `cosineSimilarity` without any conversion step.

Payload size: 1024 × ~8 chars per JSON float ≈ 8 KB uncompressed, ~4 KB after HTTP gzip. Completely negligible for the `/api/crawl` response. `null` + 16 bytes when the profile is unavailable.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  POST /api/crawl — existing handler, extended                       │
│                                                                     │
│  1. getSession()              (existing)                            │
│  2. fetchFollows(agent, did)  (existing)                            │
│                                                                     │
│  3. Promise.all([                                                   │
│       fetchRsvps(talks, signal),              (existing)            │
│       searchConferencePosts(agent, signal),   (existing)            │
│       buildInterestVector(agent, did, signal), (NEW — Layer 2 data) │
│     ])                                                              │
│                                                                     │
│     buildInterestVector flow:                                       │
│       ├─ agent.getAuthorFeed({actor: did,                           │
│       │                       filter: "posts_and_author_threads",   │
│       │                       limit: 100}) — paginate on            │
│       │    post-filter count, stop at 100 OR 90-day cutoff          │
│       ├─ filter: keep originals + self-replies,                     │
│       │          drop reposts + replies to other handles            │
│       ├─ extract .text from each post                               │
│       ├─ if zero posts → return {vector: null, status: "no-posts"}  │
│       ├─ POST voyage /v1/embeddings {                               │
│       │    input: [text1, text2, ...],                              │
│       │    model: "voyage-3.5-lite",                                │
│       │    input_type: "query"                                      │
│       │  }                                                          │
│       ├─ validate response shape (length, index coverage, dims,     │
│       │                          finite numbers)                    │
│       ├─ mean-pool the N vectors element-wise → Float32Array(1024)  │
│       └─ return {vector: Array.from(mean), postCount: N,            │
│                  status: "ok"}                                      │
│                                                                     │
│     Any thrown error above is caught, logged with category, and     │
│     returns {vector: null, postCount: 0, status: "error"}.          │
│                                                                     │
│  4. CrawlResult now includes:                                       │
│     - talkMentions            (existing)                            │
│     - followCount             (existing)                            │
│     - postsScanned            (existing)                            │
│     - crawledAt               (existing)                            │
│     - interestVector: number[] | null        ← NEW                  │
│     - interestProfileStatus: "ok" | "no-posts" | "error"  ← NEW     │
│                                                                     │
│  5. useCrawlData delivers all of it to ScoredTalksGrid              │
│     alongside mentions. Scoring engine reads both halves from       │
│     the same CrawlData object.                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

Runtime consumption — NOT in this spec (see #24):

  CrawlData.interestVector  ─→  cosineSimilarity(interestVector, talkEmbedding)
  data/embeddings/*.json    ─→  src/lib/scoring/embeddings.ts (loader, also #24)
                            ─→  src/lib/scoring/cosine.ts (math, already shipped #21)
                            ─→  replaces computeInterestStub in combineLayers
```

---

## 5. Code modules and file structure

### 5.1 New files

**`src/lib/crawl/interest-profile.ts`** — server-only module with the main `buildInterestVector(agent, did, signal)` export plus pure helpers for post filtering and mean-pool math. Has its own private constants for the 100-post cap, 90-day cutoff, Voyage API URL, model name, and dimension count.

**`src/lib/crawl/interest-profile.test.ts`** — vitest unit tests for the pure helpers (filter logic, window enforcement, mean-pool math) with mocked `fetch` and mocked `agent.getAuthorFeed`. Six tests total, all deterministic.

### 5.2 Modified files

**`src/lib/crawl/types.ts`** — **add two new fields to the existing `CrawlResult` interface**. This is an edit, not a replacement — the rest of the file (the `TalkMention` / `TalkMentions` / `CacheEntry` interfaces) must stay unchanged. Post-edit `CrawlResult` looks like this:

```ts
export interface CrawlResult {
  // Existing fields (unchanged):
  talkMentions: TalkMentions;
  followCount: number;
  postsScanned: number;
  crawledAt: number;
  // New fields (this spec):
  /** User interest profile vector (1024-dim voyage-3.5-lite query embedding,
   *  mean-pooled across recent original posts). Null when the profile build
   *  failed or the user has no usable posts. See interestProfileStatus for
   *  the reason. */
  interestVector: number[] | null;
  /** Diagnostic state for the profile build. "ok" when a vector was
   *  produced, "no-posts" when the user had zero usable posts after
   *  filtering, "error" when Voyage or the feed fetch threw. */
  interestProfileStatus: "ok" | "no-posts" | "error";
}
```

Both new fields are **required, not optional** — every `/api/crawl` response carries an explicit status so the client always knows why the profile is (or isn't) there.

**`src/lib/crawl/crawler.ts`** — inside the existing `Promise.all([fetchRsvps, searchConferencePosts])` block, add `buildInterestVector(agent, did, signal)` as a third parallel call. Wrap the `buildInterestVector` call in `.catch` that downgrades to `{vector: null, postCount: 0, status: "error"}` — best-effort, never aborts the rest of the crawl. The Layer 1 result shape is unchanged; Layer 2 is pure addition.

**`src/hooks/useCrawlData.ts`** — the hook's own `CrawlData` interface is **not** a structural copy of `CrawlResult` (it reshapes `talkMentions` into `mentions` and adds `loading` / `error` fields that don't exist on the server side). Two concrete edits here:

1. **Add two new fields to the `CrawlData` interface**, nullable both so they can be safely initialized to `null` in the loading and error code paths:

   ```ts
   export interface CrawlData {
     // Existing fields (unchanged):
     mentions: TalkMentions | null;
     followCount: number;
     loading: boolean;
     error: string | null;
     // New fields (this spec):
     interestVector: number[] | null;
     interestProfileStatus: "ok" | "no-posts" | "error" | null;
   }
   ```

   `interestProfileStatus` is nullable (not required `"ok" | "no-posts" | "error"` like on `CrawlResult`) so the initial useState default, the 401 path, the 504 path, and the fetch-error path can all set it to `null` without inventing a synthetic status. It is only non-null on the happy path when the server response actually populated it.

2. **Unpack both fields from the JSON response** in the happy path (currently around line 58–66), and set them to `null` in all four other `setData` calls (initial `useState`, 401/504 "no data" branch, other-error branch, catch-all `try/catch`). No behavior change for existing consumers of `mentions` or `followCount` — the new fields are purely additive.

The scoring engine consumers that will use the new fields (inside #24) simply have access to them when they need them. Until #24 ships, the two new fields flow through the hook unused.

### 5.3 Not touched in this spec

- `src/lib/scoring/rank.ts` — still calls `computeInterestStub`. Stays pointed at the stub until #24.
- `src/lib/scoring/interestStub.ts` — still returns `{interestScore: 0}`. #24 replaces it with real cosine matching against the vector that flows from this spec.
- `src/components/scored-talks-grid.tsx` — no user-visible UI changes. Layer 2 goes live when #24 wires it through.
- `data/embeddings/` — untouched. #21 owns the talk side.
- `scripts/embed.ts` and `scripts/embed-smoke.ts` — untouched. Those are offline pipeline scripts for the talk side.
- `src/lib/scoring/cosine.ts` — untouched. Already shipped in #21 and ready to be consumed by #24.

### 5.4 Module boundary

`buildInterestVector` is a **server-only** function. It's callable from `crawler.ts` (which runs inside the `/api/crawl` Next.js route handler) but must never be imported by any file under `src/components/` or `src/hooks/` or `src/app/**` that gets bundled into the browser. The Voyage API key is a server-only secret.

The communication path between the server and the browser is **exclusively** through the `CrawlResult` JSON serialized by `/api/crawl` and deserialized by `useCrawlData`. No direct imports cross the server/client boundary.

---

## 6. `buildInterestVector` specification

### 6.1 Signature

```ts
import type { Agent } from "@atproto/api";

export interface InterestProfileResult {
  /** Null on error or when no usable posts were found. */
  vector: number[] | null;
  /** Number of posts that made it past the filter AND into the Voyage call.
   *  Always 0 when vector is null. */
  postCount: number;
  /** Why vector is (not) present. */
  status: "ok" | "no-posts" | "error";
}

export async function buildInterestVector(
  agent: Agent,
  did: string,
  signal?: AbortSignal,
): Promise<InterestProfileResult>;
```

### 6.2 Flow

1. **Fetch posts.** Call `agent.getAuthorFeed({actor: did, filter: "posts_and_author_threads", limit: 100}, {signal})`. The `posts_and_author_threads` filter is an AT Protocol feature flag (see `app.bsky.feed.getAuthorFeed` lexicon `knownValues` — verified present in `@atproto/api`) that retains originals and self-reply threads while excluding replies to other users and pure reposts at the server level. It is the correct filter for preserving the user's own voice in threads — `posts_no_replies` is wrong because it would exclude self-replies too.

   **Pagination** is driven by the **post-filter** count, not the raw feed-item count. After each page, apply Step 2's filter to the current accumulation and check the **filtered** total. Stop fetching when any of the following holds:
   - We have **accumulated at least `MAX_POSTS` filtered posts**, OR
   - The **oldest item** in the current page is older than 90 days (nothing earlier in the feed can possibly contribute), OR
   - The feed response has no `cursor` (user has no more posts).

   This matters because `posts_and_author_threads` at the server level still returns plenty of items that our client-side filter may need to drop (e.g., edge cases around the author-reply detection), so a naive "did we get 100 raw items?" check could under-fetch. A user with mixed posting behavior might need to paginate past page 1 to reach 100 usable posts even though page 1 returned 100 raw items.

   **Hard cap** on pagination: at most 3 pages (300 raw items) regardless of filter outcome, so a pathological feed can't blow the 30s crawl budget. If we hit 3 pages without reaching `MAX_POSTS`, proceed with whatever we have.

2. **Filter.** For each feed item, retain it only if it is an **original post** or a **self-reply** (where the reply root or parent is by the same DID). Drop reposts (`$type === "app.bsky.feed.defs#reasonRepost"`) and drop replies to other users. Apply the **90-day cutoff** at this step: drop any post with `createdAt` older than `now - 90d`. This is belt-and-braces — the AT Protocol filter handles most of it, but our own guard catches edge cases and proves the invariant via unit tests.

3. **Check for empty.** If zero posts remain after filtering, log `[interest-profile] no-posts: user ${did}` and return `{vector: null, postCount: 0, status: "no-posts"}`. **Do not call Voyage.**

4. **Extract text.** For each remaining post, extract `.record.text` (the Bluesky post body). Skip any post where `.record.text` is empty or missing. If the skip leaves us with zero posts, fall through to the `no-posts` return above.

5. **Build Voyage request.** POST to `https://api.voyageai.com/v1/embeddings` with:
   ```json
   {
     "input": ["post text 1", "post text 2", "..."],
     "model": "voyage-3.5-lite",
     "input_type": "query"
   }
   ```
   Authenticated via `Authorization: Bearer ${process.env.VOYAGE_API_KEY}`.

6. **Validate response.** Check that `response.data.length === input.length`, every `data[i].index` is in range `[0, input.length)`, indices are unique, every `data[i].embedding` has exactly 1024 elements, and every element is finite. Reuse the defensive pattern from `scripts/embed.ts`'s `validateBatchResponse` — logic is similar enough that we could share code via a helper, but the scoring engine and the offline pipeline should stay independent, so we implement a local version here rather than cross-importing from `scripts/`. (See §5.4 — `scripts/` is offline pipeline, `src/lib/crawl/` is runtime server code; they don't share imports.)

7. **Mean-pool.** Given N validated embeddings, compute the element-wise mean: for each dimension `d`, `mean[d] = (vec1[d] + vec2[d] + ... + vecN[d]) / N`. Store as a `Float32Array(1024)` for the math, then convert to `number[]` via `Array.from(mean)` for the JSON response.

8. **Return.** `{vector: meanAsArray, postCount: N, status: "ok"}`.

### 6.3 Error handling

Each of the steps above can throw. The error handling contract matches the pattern established in `src/lib/crawl/crawler.ts` (around line 113) and `src/lib/crawl/search.ts` (around line 116), where the repo gates abort propagation on `signal?.aborted` rather than `instanceof DOMException` or error-name matching:

- **Abort propagation**: at each step that awaits something cancellable (agent feed calls, Voyage fetch, sleeps), wrap the await in `try { ... } catch (err) { if (signal?.aborted) throw err; /* fall through to structured-error return */ }`. This mirrors the existing repo pattern exactly and avoids the portability issues of error-type matching.
- **Everything else**: catch inside the top-level function body, log with a category (`[interest-profile] error: ${err.message}` for genuine failures, `[interest-profile] no-posts: user ${did}` for the empty-feed case), and return `{vector: null, postCount: 0, status: "error"}` (or `"no-posts"`). The main crawl continues with Layer 1 unaffected.
- **Caller contract**: `buildInterestVector` **never throws to its caller except on abort**. `crawler.ts` still wraps the call in `.catch` as an additional safety net, but under normal (non-abort) operation the catch should never fire because `buildInterestVector` already converts internal failures to structured returns.

All other failures become a structured `status: "error"` result. The crawl's 30s timeout is enforced upstream by `AbortSignal.timeout` in the existing `/api/crawl` route handler.

### 6.4 Configuration constants

```ts
const MAX_POSTS = 100;
const MAX_AGE_DAYS = 90;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3.5-lite";
const DIMENSIONS = 1024;
```

These live as top-of-file constants inside `interest-profile.ts`, not exported, not shared with `scripts/embed.ts`. The talk side and the user side happen to use the same model and dimensions today; if they diverge (e.g. future user vectors use a cheaper model), splitting the constants means a one-line change here without touching the offline pipeline.

---

## 7. Testing strategy

### 7.1 Unit tests — `src/lib/crawl/interest-profile.test.ts`

Six tests, all with mocked `fetch` and a mocked `agent` (in-file factory). No live Voyage calls, no real AT Protocol network access.

| # | Test | What it pins |
|---|---|---|
| 1 | **Original-posts filter** | Given a mixed feed (originals, reposts, replies to other handles, self-replies), the filter returns exactly the originals + self-replies and excludes the rest. |
| 2 | **Window enforcement** | Given 200 feed items spanning 180 days, selects at most 100 posts AND all within the last 90 days. Boundary cases: exactly 100 posts, exactly 90 days (≤ 90 kept, > 90 dropped). |
| 3 | **Mean-pool math** | Given three known input vectors (`[1,0,0]`, `[0,1,0]`, `[0,0,1]`), returns `[1/3, 1/3, 1/3]` within float epsilon. Pure function, no mocks. |
| 4 | **Empty-feed / no-posts path** | Given an empty author feed (new account) returns `{vector: null, postCount: 0, status: "no-posts"}`. **Asserts that `fetch` was never called** (no Voyage call on empty). |
| 5 | **Voyage failure path** | Mocked fetch returns HTTP 500. Returns `{vector: null, postCount: N, status: "error"}`. Does not throw. Logs "[interest-profile] error: ...". |
| 6 | **Voyage response shape validation** | Mocked fetch returns a payload with wrong dimension count (e.g., `embedding: [0.1, 0.2]` instead of 1024 elements). Returns `{vector: null, status: "error"}`. Does not throw. |

### 7.2 Not unit-tested

- **Live Voyage API integration**: the token-billing endpoint, flaky in CI, covered implicitly by the staging smoke test (log in, check `/api/crawl` response has `interestVector: number[]` and `interestProfileStatus: "ok"`).
- **`/api/crawl` end-to-end handler integration**: covered by the existing crawl path tests + manual staging verification.
- **The vector quality**: subjective; eyeballed on staging when #24 lands and the user can see whether their ranked talks reflect their interests.

### 7.3 Test count progression

- Before #23: 69 tests (from #21 final state)
- After #23: 75 tests (69 + 6 new in `interest-profile.test.ts`)

---

## 8. Cost and operational notes

| Concern | Number |
|---|---|
| Voyage calls per unique authenticated user per 30 minutes | 1 |
| Average input tokens per profile build (100 posts × ~30 tokens each) | ~3,000 |
| Voyage cost per profile build at voyage-3.5-lite rates | ~$0.00006 |
| Added latency to `/api/crawl` response (typical) | 300–500 ms |
| `/api/crawl` total budget | 30,000 ms (unchanged) |
| `/api/crawl` response payload growth | +4–8 KB (one 1024-dim float array as JSON) |
| Cost per 1000 unique user logins | ~$0.06 |

The profile build is cheap enough that cost concerns are not part of the decision criteria for this work. Staging can run it freely; production can run it freely; it can even be triggered on every page load if we ever decided to drop the cache.

---

## 9. Scope boundary

### 9.1 What this issue (#23) produces

- New: `src/lib/crawl/interest-profile.ts` with the `buildInterestVector` export + 6 unit tests
- Modified: `src/lib/crawl/types.ts` (`CrawlResult` extended)
- Modified: `src/lib/crawl/crawler.ts` (third parallel call in the existing `Promise.all`, best-effort catch)
- Modified: `src/hooks/useCrawlData.ts` (passes through the new fields)
- Server-side logging distinguishing `no-posts` from `error` for future retry/instrumentation decisions

### 9.2 What this issue does NOT do

- ❌ Compute any cosine similarity → **#24**
- ❌ Wire layer 2 into `combineLayers` / replace `computeInterestStub` → **#24**
- ❌ Any user-visible UI change — Layer 2 stays dark until #24
- ❌ Persist the profile vector anywhere — transient, rebuilt on every cache miss
- ❌ Publish to `watch.understory.topicIndex` or any other AT Protocol lexicon — that's the talk side, owned by #22
- ❌ Build any retry queue, notification channel, or background-rebuild infrastructure — explicitly deferred per §3.4
- ❌ Tune the post scope (100/90) or the aggregation weights based on real user data — that's future tuning if needed, not this spec

After #23 lands, **user-visible behavior is unchanged**. `computeInterestStub` still returns `{interestScore: 0}`, so the scoring engine behaves exactly as it does today. The interest vector just starts flowing through the pipeline, sitting in the crawl response, unused. Layer 2 goes live the moment #24 ships and consumes it.

---

## 10. Open questions

None at time of writing. All architectural decisions are listed in §3 with rationale.
