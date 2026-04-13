# User Interest Profiling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a server-side `buildInterestVector(agent, did)` helper that fetches a logged-in user's recent Bluesky posts via `getAuthorFeed`, filters to original posts + self-reply threads within the last 90 days, batch-embeds them via Voyage `voyage-3.5-lite` with `input_type: "query"`, mean-pools the results into a single 1024-dim vector, and exposes it through `/api/crawl` as a new `interestVector` field on `CrawlResult`. This is the user side of layer-2 similarity; the talk side landed in #21. Layer 2 stays dark until #24 consumes the vector.

**Architecture:** New pure-ish helper under `src/lib/crawl/interest-profile.ts` (mocked-fetch-testable core + one server-only function). The existing `crawler.ts` calls it as a third parallel branch inside its existing `Promise.all` block, wrapped in `.catch` for best-effort semantics. `CrawlResult` grows two new fields (`interestVector: number[] | null`, `interestProfileStatus: "ok" | "no-posts" | "error"`). `useCrawlData` passes them through unchanged. No user-visible UI changes until #24.

**Tech Stack:** Node.js 20+ (Next.js route handler runtime), TypeScript 5, `@atproto/api` Agent, native `fetch`, vitest. Reuses the cosine helper and embedding contracts from #21.

**Spec:** `docs/superpowers/specs/2026-04-13-user-interest-profiling-design.md`

---

## File Map

**New files:**

| Path | Responsibility |
|---|---|
| `src/lib/crawl/interest-profile.ts` | `buildInterestVector(agent, did, signal)` + pure helper functions (`filterFeedItems`, `meanPool`, `validateVoyageResponse`). Server-only. Imports from `@atproto/api` and reads `process.env.VOYAGE_API_KEY`. |
| `src/lib/crawl/interest-profile.test.ts` | Vitest unit tests for the pure helpers plus `buildInterestVector`. Uses a hand-rolled mock `Agent` and mocks `globalThis.fetch`. Six tests total. |

**Modified files:**

| Path | Change |
|---|---|
| `src/lib/crawl/types.ts` | Add `interestVector` and `interestProfileStatus` fields to the existing `CrawlResult` interface. Leave `TalkMention`, `TalkMentions`, and `CacheEntry` untouched. |
| `src/lib/crawl/crawler.ts` | Call `buildInterestVector` as a third parallel branch inside the existing `Promise.all`. Wrap in `.catch` to downgrade failures. Extend the `buildResult` helper to include the two new fields. |
| `src/hooks/useCrawlData.ts` | Extend `CrawlData` interface with two new nullable fields. Pass them through in the happy-path `setData` call. Set them to `null` in all four non-happy-path `setData` calls (initial useState, 401/504 branch, other-error branch, catch-all). |

**Total scope:** 2 new files, 3 modified files, 8 new tests. Test count progresses 69 → 77.

**No changes to:** `src/lib/scoring/*` (layer-2 stays stubbed until #24), `scripts/embed*.ts` (offline pipeline is talk-side), `data/embeddings/*`, `src/components/*` (no UI).

---

## Chunk 1: Pure helpers (TDD)

This chunk lands the deterministic, fully-unit-testable pieces of the interest profile module: the filter function, the mean-pool math, and the Voyage response shape validator. No network, no filesystem, no environment variables. After this chunk `interest-profile.ts` exists but does not yet export `buildInterestVector` — that function is wired up in Chunk 2.

### Task 1: Filter function + 2 filter tests

**Files:**
- Create: `src/lib/crawl/interest-profile.ts` (initial scaffold — constants + `filterFeedItems` export)
- Create: `src/lib/crawl/interest-profile.test.ts`

**Skills:** `superpowers:test-driven-development`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/crawl/interest-profile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AppBskyFeedDefs } from "@atproto/api";
import { filterFeedItems, MAX_AGE_MS } from "./interest-profile";

type FeedViewPost = AppBskyFeedDefs.FeedViewPost;

const USER_DID = "did:plc:self";
const OTHER_DID = "did:plc:other";

/**
 * Minimal factory for a FeedViewPost the filter cares about. The filter
 * only reads: .post.author.did, .post.indexedAt, .post.record.text,
 * .reply?.parent, .reason.$type. Everything else is cast through `unknown`
 * to keep the fixture concise.
 */
function makeFeedItem(opts: {
  authorDid?: string;
  indexedAt?: string;
  text?: string;
  repost?: boolean;
  replyParentAuthor?: string | null; // null = no reply, string = parent author DID
}): FeedViewPost {
  const {
    authorDid = USER_DID,
    indexedAt = new Date().toISOString(),
    text = "hello world",
    repost = false,
    replyParentAuthor = null,
  } = opts;

  const item: Record<string, unknown> = {
    post: {
      $type: "app.bsky.feed.defs#postView",
      uri: `at://${authorDid}/app.bsky.feed.post/${Math.random()}`,
      cid: "bafytest",
      author: { did: authorDid, handle: "test.bsky.social" },
      record: { $type: "app.bsky.feed.post", text, createdAt: indexedAt },
      indexedAt,
    },
  };

  if (repost) {
    item.reason = {
      $type: "app.bsky.feed.defs#reasonRepost",
      by: { did: OTHER_DID },
      indexedAt,
    };
  }

  if (replyParentAuthor !== null) {
    item.reply = {
      $type: "app.bsky.feed.defs#replyRef",
      root: { $type: "app.bsky.feed.defs#postView", author: { did: replyParentAuthor } },
      parent: { $type: "app.bsky.feed.defs#postView", author: { did: replyParentAuthor } },
    };
  }

  return item as unknown as FeedViewPost;
}

describe("filterFeedItems", () => {
  it("keeps originals and self-replies, drops reposts and replies to others", () => {
    const items: FeedViewPost[] = [
      makeFeedItem({ text: "original 1" }),
      makeFeedItem({ repost: true, text: "someone else's post" }),
      makeFeedItem({ replyParentAuthor: USER_DID, text: "self-reply (thread)" }),
      makeFeedItem({ replyParentAuthor: OTHER_DID, text: "reply to someone else" }),
      makeFeedItem({ text: "original 2" }),
    ];
    const result = filterFeedItems(items, USER_DID, Date.now());
    expect(result.map((p) => p.record.text)).toEqual([
      "original 1",
      "self-reply (thread)",
      "original 2",
    ]);
  });

  it("drops posts older than MAX_AGE_MS and keeps posts at the boundary", () => {
    const now = Date.now();
    const items: FeedViewPost[] = [
      makeFeedItem({
        text: "fresh",
        indexedAt: new Date(now - 1_000).toISOString(),
      }),
      makeFeedItem({
        text: "exactly at 90 days",
        indexedAt: new Date(now - MAX_AGE_MS).toISOString(),
      }),
      makeFeedItem({
        text: "one ms past 90 days",
        indexedAt: new Date(now - MAX_AGE_MS - 1).toISOString(),
      }),
      makeFeedItem({
        text: "ancient",
        indexedAt: new Date(now - MAX_AGE_MS * 10).toISOString(),
      }),
    ];
    const result = filterFeedItems(items, USER_DID, now);
    expect(result.map((p) => p.record.text)).toEqual([
      "fresh",
      "exactly at 90 days",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/crawl/interest-profile.test.ts`

Expected: tests fail with `Failed to resolve import "./interest-profile"` — the file doesn't exist yet.

- [ ] **Step 3: Create the initial interest-profile.ts scaffold**

Create `src/lib/crawl/interest-profile.ts`:

```ts
import type { AppBskyFeedDefs } from "@atproto/api";

type FeedViewPost = AppBskyFeedDefs.FeedViewPost;
type PostView = AppBskyFeedDefs.PostView;

// Window for "recent" — posts older than this are dropped.
const MAX_AGE_DAYS = 90;
export const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

// Hard cap on posts per profile build. Bounds Voyage token cost.
export const MAX_POSTS = 100;

// Hard cap on getAuthorFeed pages per build. Bounds wall-clock time
// under the /api/crawl 30s budget even with a pathological feed.
export const MAX_PAGES = 3;

// Voyage configuration — the user side of layer-2 similarity.
// Mirrors #21's talk-side choices so the vectors are comparable.
export const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
export const MODEL = "voyage-3.5-lite";
export const DIMENSIONS = 1024;

/**
 * Narrowed post shape the rest of the module needs. `record` on a
 * real FeedViewPost is typed as `Record<string, unknown>`, so we
 * re-cast at the filter boundary and carry the concrete shape forward.
 */
export interface FilteredPost {
  uri: string;
  text: string;
  indexedAt: string;
  record: { text: string; createdAt?: string };
}

/**
 * Keep only posts that represent the user's own voice and fall inside
 * the recency window. Rules:
 *
 *   - Drop reposts (feed item has `reason.$type === "...reasonRepost"`).
 *     The author of a repost is someone else; their text isn't ours.
 *   - Drop replies where the parent post's author is NOT the user.
 *     These are context-dependent and often short / non-topical.
 *   - Keep originals (no `reply` field) and self-replies (parent
 *     author === user DID). Self-reply threads are the user
 *     continuing their own idea.
 *   - Drop posts where `indexedAt` is more than MAX_AGE_MS before `now`.
 *     Boundary is inclusive (exactly 90 days old is kept).
 *   - Drop posts with empty or missing `record.text`.
 *
 * Pure function — no I/O, deterministic on its three inputs.
 */
export function filterFeedItems(
  items: FeedViewPost[],
  userDid: string,
  now: number,
): FilteredPost[] {
  const cutoff = now - MAX_AGE_MS;
  const out: FilteredPost[] = [];

  for (const item of items) {
    // Drop reposts. The repost marker lives on feedItem.reason, not the post.
    if (
      item.reason &&
      (item.reason as { $type?: string }).$type ===
        "app.bsky.feed.defs#reasonRepost"
    ) {
      continue;
    }

    // Drop replies to other users. Self-replies pass through.
    //
    // ReplyRef.parent is a union of PostView | NotFoundPost | BlockedPost.
    // Only PostView carries `.author.did`; the other two variants mean
    // the parent was deleted or the author blocked us. In both of those
    // cases parentDid will be undefined, which fails the `=== userDid`
    // check and drops the reply — which is the correct behavior: we
    // can't verify it's a self-reply, so treat it as a reply to someone
    // else and exclude it from the interest profile.
    if (item.reply) {
      const parent = (item.reply as { parent?: unknown }).parent as
        | (PostView & { author?: { did?: string } })
        | undefined;
      const parentDid = parent?.author?.did;
      if (parentDid !== userDid) continue;
    }

    // Extract text; drop if missing.
    const record = item.post.record as
      | { text?: unknown; createdAt?: unknown }
      | undefined;
    const text = typeof record?.text === "string" ? record.text.trim() : "";
    if (text.length === 0) continue;

    // Recency window (inclusive at the boundary).
    const indexedAtMs = Date.parse(item.post.indexedAt);
    if (!Number.isFinite(indexedAtMs)) continue;
    if (indexedAtMs < cutoff) continue;

    out.push({
      uri: item.post.uri,
      text,
      indexedAt: item.post.indexedAt,
      record: {
        text,
        createdAt:
          typeof record?.createdAt === "string" ? record.createdAt : undefined,
      },
    });
  }

  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/crawl/interest-profile.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`

Expected: 71 tests pass (69 existing from #21 + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/crawl/interest-profile.ts src/lib/crawl/interest-profile.test.ts
git commit -m "feat(crawl): add filterFeedItems + interest profile constants (#23)

Initial scaffold for src/lib/crawl/interest-profile.ts with the pure
filter function and the configuration constants. Keeps originals and
self-replies, drops reposts and replies to other users, applies a
90-day recency window with an inclusive boundary.

2 unit tests pin the filter contract:
- mixed feed → keeps originals + self-replies, drops reposts + other-
  replies
- recency window → drops > 90 days, keeps ≤ 90 days at the boundary"
```

---

### Task 2: Mean-pool helper + test

**Files:**
- Modify: `src/lib/crawl/interest-profile.ts` (add `meanPool` export)
- Modify: `src/lib/crawl/interest-profile.test.ts` (add 1 test)

- [ ] **Step 1: Write the failing test**

Append to the top-of-file imports in `src/lib/crawl/interest-profile.test.ts`:

```ts
import { filterFeedItems, MAX_AGE_MS, meanPool } from "./interest-profile";
```

(Update the existing import line — do not create a second import statement from the same module. The `import/first` and `import/no-duplicates` lint rules both apply.)

Append this new `describe` block at the bottom of the file:

```ts
describe("meanPool", () => {
  it("returns the element-wise average of N equal-length vectors", () => {
    const result = meanPool([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(result.length).toBe(3);
    expect(result[0]).toBeCloseTo(1 / 3, 10);
    expect(result[1]).toBeCloseTo(1 / 3, 10);
    expect(result[2]).toBeCloseTo(1 / 3, 10);
  });
});
```

- [ ] **Step 2: Run tests to verify the mean-pool test fails**

Run: `npm test -- src/lib/crawl/interest-profile.test.ts`

Expected: `meanPool` is not exported — import or test error.

- [ ] **Step 3: Implement meanPool**

Append to `src/lib/crawl/interest-profile.ts`:

```ts

/**
 * Element-wise mean of N equal-length numeric vectors. Returns a plain
 * `number[]` (not Float32Array) so the result serializes cleanly through
 * JSON in the /api/crawl response — #24's client consumer reads it back
 * as `number[]` and passes it directly to `cosineSimilarity`, which
 * accepts `ArrayLike<number>`.
 *
 * Throws if `vectors` is empty (callers must check upstream) or if the
 * vectors have mismatched lengths (defensive guard — Voyage should
 * return uniform dimensions, but catching a mismatch here surfaces a
 * protocol drift as a clear error rather than silently corrupt math).
 */
export function meanPool(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    throw new Error("meanPool: cannot average zero vectors");
  }
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    if (v.length !== dim) {
      throw new Error(
        `meanPool: length mismatch — expected ${dim}, got ${v.length}`,
      );
    }
    for (let i = 0; i < dim; i++) {
      sum[i] += v[i];
    }
  }
  const n = vectors.length;
  for (let i = 0; i < dim; i++) {
    sum[i] /= n;
  }
  return sum;
}
```

- [ ] **Step 4: Run tests to verify the mean-pool test passes**

Run: `npm test -- src/lib/crawl/interest-profile.test.ts`

Expected: 3 tests pass (2 filter + 1 mean-pool).

- [ ] **Step 5: Commit**

```bash
git add src/lib/crawl/interest-profile.ts src/lib/crawl/interest-profile.test.ts
git commit -m "feat(crawl): add meanPool helper (#23)

Element-wise mean of N equal-length numeric vectors. Returns number[]
for clean JSON serialization through the /api/crawl response.

Throws on empty input (caller invariant) and on length mismatch
(defensive — catches Voyage protocol drift as a clear error instead
of silently corrupt math).

1 unit test pins the centroid calculation with three orthogonal unit
vectors."
```

---

### Task 3: Voyage response validator + test

**Files:**
- Modify: `src/lib/crawl/interest-profile.ts` (add `validateVoyageResponse`)
- Modify: `src/lib/crawl/interest-profile.test.ts` (add 1 test)

**Context:** `scripts/embed.ts` from #21 already has a similar `validateBatchResponse` for the talk side, but the offline pipeline in `scripts/` is deliberately kept independent of the runtime server code in `src/lib/crawl/` (see spec §5.4). We re-implement a small version here rather than cross-importing.

- [ ] **Step 1: Write the failing test**

Update the top-of-file imports in `src/lib/crawl/interest-profile.test.ts` to include the new names:

```ts
import {
  filterFeedItems,
  MAX_AGE_MS,
  meanPool,
  validateVoyageResponse,
  type VoyageEmbedResponse,
} from "./interest-profile";
```

Append this `describe` block:

```ts
describe("validateVoyageResponse", () => {
  function makeResponse(items: number): VoyageEmbedResponse {
    return {
      data: Array.from({ length: items }, (_, i) => ({
        embedding: new Array(1024).fill(0.1),
        index: i,
      })),
      model: "voyage-3.5-lite",
      usage: { total_tokens: 1000 },
    };
  }

  it("accepts a well-formed response", () => {
    expect(() => validateVoyageResponse(makeResponse(3), 3)).not.toThrow();
  });

  it("throws on malformed response shapes", () => {
    // Wrong length
    expect(() => validateVoyageResponse(makeResponse(2), 3)).toThrow(
      /length/i,
    );

    // Wrong dimension
    const wrongDim = makeResponse(1);
    wrongDim.data[0].embedding = new Array(512).fill(0.1);
    expect(() => validateVoyageResponse(wrongDim, 1)).toThrow(/dimension/i);

    // Non-finite value
    const nan = makeResponse(1);
    nan.data[0].embedding[0] = NaN;
    expect(() => validateVoyageResponse(nan, 1)).toThrow(/finite/i);

    // Missing data field
    const noData = { model: "voyage-3.5-lite", usage: { total_tokens: 0 } };
    expect(() =>
      validateVoyageResponse(noData as VoyageEmbedResponse, 1),
    ).toThrow(/data/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/crawl/interest-profile.test.ts`

Expected: `validateVoyageResponse` and `VoyageEmbedResponse` are not exported — import error.

- [ ] **Step 3: Implement the validator**

Append to `src/lib/crawl/interest-profile.ts`:

```ts

/**
 * POST body shape for Voyage's /v1/embeddings endpoint. Identical to
 * the talk-side shape in scripts/lib/embedding-types.ts but duplicated
 * here so src/lib/crawl/ stays independent of scripts/ (see spec §5.4).
 */
export interface VoyageEmbedRequest {
  input: string[];
  model: string;
  input_type: "document" | "query";
}

/** Response shape from Voyage's /v1/embeddings endpoint. */
export interface VoyageEmbedResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}

/**
 * Defensive validation of a Voyage batch response before any math.
 * Same invariants as scripts/embed.ts::validateBatchResponse, scoped
 * to the runtime server code path:
 *   - data is a non-null array with the expected length
 *   - every vector has exactly DIMENSIONS elements
 *   - every element is a finite number (no NaN, no Infinity)
 *
 * We deliberately skip the index-range/uniqueness check the offline
 * pipeline does. The offline pipeline writes one file per response
 * item and needs the index to key correctly; here we mean-pool and
 * discard indices, so a reordered response doesn't corrupt anything.
 */
export function validateVoyageResponse(
  response: VoyageEmbedResponse,
  expectedBatchSize: number,
): void {
  if (!response || !Array.isArray(response.data)) {
    throw new Error(
      "Voyage response: missing or non-array `data` field",
    );
  }
  if (response.data.length !== expectedBatchSize) {
    throw new Error(
      `Voyage response: length mismatch — expected ${expectedBatchSize}, got ${response.data.length}`,
    );
  }
  for (const item of response.data) {
    if (item === null || typeof item !== "object") {
      throw new Error(
        `Voyage response: non-object item in data array (got ${
          item === null ? "null" : typeof item
        })`,
      );
    }
    if (!Array.isArray(item.embedding) || item.embedding.length !== DIMENSIONS) {
      throw new Error(
        `Voyage response: wrong dimension count — expected ${DIMENSIONS}, got ${
          item.embedding?.length ?? "missing"
        }`,
      );
    }
    for (const v of item.embedding) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error(
          `Voyage response: non-finite number in embedding`,
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/crawl/interest-profile.test.ts`

Expected: 5 tests pass (2 filter + 1 mean-pool + 2 validator).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`

Expected: 74 tests pass (69 + 5).

- [ ] **Step 6: Commit**

```bash
git add src/lib/crawl/interest-profile.ts src/lib/crawl/interest-profile.test.ts
git commit -m "feat(crawl): add validateVoyageResponse defensive guard (#23)

Pre-math validation of a Voyage batch response: non-null data array
of expected length, every vector has exactly DIMENSIONS (1024)
elements, every element is a finite number.

Deliberately skips the index-range/uniqueness check that the offline
pipeline's scripts/embed.ts::validateBatchResponse enforces. The
offline pipeline keys files by response index; here we mean-pool
and discard indices so reordering is harmless.

2 unit tests: happy path + 4 failure modes bundled into one 'throws
on malformed shapes' case to keep the test file compact."
```

---

## Chunk 2: buildInterestVector orchestration + integration

This chunk wires the pure helpers into the `buildInterestVector` server function, calls it from `crawler.ts`, extends the types, and passes the new fields through `useCrawlData`. No more pure math — this is where fetch, agent, and environment variables enter.

### Task 4: buildInterestVector end-to-end test

**Files:**
- Modify: `src/lib/crawl/interest-profile.test.ts` (add 1 describe block with 3 tests)
- Will drive: `src/lib/crawl/interest-profile.ts` (implementation in Task 5)

- [ ] **Step 1: Write the failing tests**

Update the top-of-file imports:

```ts
import {
  filterFeedItems,
  MAX_AGE_MS,
  meanPool,
  validateVoyageResponse,
  buildInterestVector,
  type VoyageEmbedResponse,
} from "./interest-profile";
```

Append this new `describe` block at the bottom of the file:

```ts
describe("buildInterestVector", () => {
  // Minimal mock Agent surface: only getAuthorFeed is consulted.
  // Returns a queue of pages the test can preload.
  function makeAgent(pages: Array<{ feed: unknown[]; cursor?: string }>) {
    let page = 0;
    return {
      getAuthorFeed: async () => ({
        data: pages[Math.min(page++, pages.length - 1)] ?? { feed: [] },
      }),
    } as unknown as Parameters<typeof buildInterestVector>[0];
  }

  function makeVoyageOk(n: number): VoyageEmbedResponse {
    return {
      data: Array.from({ length: n }, (_, i) => ({
        embedding: new Array(1024).fill(1), // each post is the vector [1,1,...]
        index: i,
      })),
      model: "voyage-3.5-lite",
      usage: { total_tokens: 100 },
    };
  }

  beforeEach(() => {
    vi.stubEnv("VOYAGE_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns no-posts status without hitting Voyage when feed is empty", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const agent = makeAgent([{ feed: [] }]);

    const result = await buildInterestVector(agent, "did:plc:self");

    expect(result.status).toBe("no-posts");
    expect(result.vector).toBeNull();
    expect(result.postCount).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("batch-embeds filtered posts and returns the mean-pooled vector", async () => {
    const now = new Date().toISOString();
    const feedPage = {
      feed: [
        { post: { uri: "at://a", cid: "c", author: { did: "did:plc:self" }, record: { text: "post one", createdAt: now }, indexedAt: now } },
        { post: { uri: "at://b", cid: "c", author: { did: "did:plc:self" }, record: { text: "post two", createdAt: now }, indexedAt: now } },
      ],
    };
    const agent = makeAgent([feedPage]);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(makeVoyageOk(2)), { status: 200 }),
      );

    const result = await buildInterestVector(agent, "did:plc:self");

    expect(result.status).toBe("ok");
    expect(result.postCount).toBe(2);
    expect(result.vector).not.toBeNull();
    expect(result.vector!.length).toBe(1024);
    // Both input vectors were [1,1,...,1], so mean is also [1,1,...,1].
    expect(result.vector![0]).toBeCloseTo(1, 10);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("voyage-3.5-lite");
    expect(body.input_type).toBe("query");
    expect(body.input).toEqual(["post one", "post two"]);
  });

  it("returns error status on Voyage failure without throwing", async () => {
    const now = new Date().toISOString();
    const agent = makeAgent([
      {
        feed: [
          { post: { uri: "at://a", cid: "c", author: { did: "did:plc:self" }, record: { text: "post one", createdAt: now }, indexedAt: now } },
        ],
      },
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream 500", { status: 500 }),
    );

    const result = await buildInterestVector(agent, "did:plc:self");

    expect(result.status).toBe("error");
    expect(result.vector).toBeNull();
    // postCount reflects the count we attempted to embed — useful for logs.
    expect(result.postCount).toBe(1);
  });
});
```

You'll also need to update the top imports of the test file to include the vitest lifecycle helpers. Change the existing vitest import to:

```ts
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/crawl/interest-profile.test.ts`

Expected: 3 new tests fail with import errors (`buildInterestVector` is not exported yet).

- [ ] **Step 3: Commit the failing tests**

(TDD discipline — red before green, and the failing tests make Task 5's diff explicit about what the implementation needs to satisfy.)

```bash
git add src/lib/crawl/interest-profile.test.ts
git commit -m "test(crawl): add failing buildInterestVector tests (#23)

Three end-to-end tests for the orchestration layer, intentionally
landed before the implementation (TDD red phase):

- Empty feed returns no-posts without any Voyage call
- Non-empty feed triggers a single batched Voyage POST with
  input_type=query and returns the mean-pooled vector
- Voyage 5xx returns error status without throwing

Mocks a minimal Agent surface (only getAuthorFeed is consulted) and
stubs globalThis.fetch + VOYAGE_API_KEY via vitest's vi helpers."
```

---

### Task 5: buildInterestVector implementation

**Files:**
- Modify: `src/lib/crawl/interest-profile.ts`

- [ ] **Step 1: Add the function signature types and helper imports**

At the top of `src/lib/crawl/interest-profile.ts`, update the import and add a second import for the runtime `Agent` type:

```ts
import type { AppBskyFeedDefs } from "@atproto/api";
import type { Agent } from "@atproto/api";
```

(Both are type-only imports so the browser bundler can't accidentally pull `Agent`'s runtime into a client component — not that we ever import this file from a client component, but it's a cheap guardrail.)

- [ ] **Step 2: Add the result type and the `buildInterestVector` function**

Append this to the end of `src/lib/crawl/interest-profile.ts`:

```ts

export interface InterestProfileResult {
  /** Null on error or when no usable posts were found. */
  vector: number[] | null;
  /** Number of posts that made it into the Voyage call. 0 when vector is null. */
  postCount: number;
  /** Why vector is (or isn't) present. */
  status: "ok" | "no-posts" | "error";
}

/**
 * Build a per-user interest profile vector from their recent Bluesky posts.
 *
 * Flow (see spec §6.2):
 *   1. Paginate agent.getAuthorFeed with filter: "posts_and_author_threads"
 *      until we have MAX_POSTS filtered posts, hit the 90-day cutoff, or
 *      exhaust MAX_PAGES pages.
 *   2. Run every page through filterFeedItems to drop reposts, replies to
 *      other users, and out-of-window posts.
 *   3. If zero posts remain: return { status: "no-posts" } without any
 *      Voyage call (cheap, common, and distinct from "error" in logs).
 *   4. POST the filtered texts to Voyage /v1/embeddings with
 *      input_type: "query".
 *   5. Validate the response shape defensively.
 *   6. Mean-pool the N vectors element-wise into one 1024-dim vector.
 *   7. Return { status: "ok", vector, postCount }.
 *
 * Error handling (see spec §6.3):
 *   - Abort propagates immediately: each awaited step checks
 *     signal?.aborted in a catch clause, mirroring the pattern in
 *     crawler.ts and search.ts.
 *   - All other errors are caught, logged with a category prefix, and
 *     returned as { status: "error", vector: null }. The function
 *     NEVER throws to its caller except on abort.
 */
export async function buildInterestVector(
  agent: Agent,
  did: string,
  signal?: AbortSignal,
): Promise<InterestProfileResult> {
  let filtered: FilteredPost[] = [];
  const now = Date.now();

  try {
    // ── Paginated fetch ────────────────────────────────────────────
    let cursor: string | undefined;
    let pagesFetched = 0;

    while (pagesFetched < MAX_PAGES && filtered.length < MAX_POSTS) {
      if (signal?.aborted) throw signal.reason ?? new Error("Aborted");

      const res = await agent.getAuthorFeed(
        {
          actor: did,
          filter: "posts_and_author_threads",
          limit: 100,
          cursor,
        },
        { signal },
      );

      pagesFetched++;
      const page = (res.data.feed ??
        []) as unknown as AppBskyFeedDefs.FeedViewPost[];

      // Filter this page and append to the running total.
      filtered = filtered.concat(filterFeedItems(page, did, now));

      // Stop if the oldest item on this page is already past the window —
      // nothing earlier in the feed can possibly contribute. `indexedAt`
      // is descending (newest first) in author feeds, so the last item
      // on the page is the oldest.
      const oldest = page[page.length - 1]?.post?.indexedAt;
      if (oldest) {
        const oldestMs = Date.parse(oldest);
        if (Number.isFinite(oldestMs) && oldestMs < now - MAX_AGE_MS) {
          break;
        }
      }

      cursor = res.data.cursor;
      if (!cursor) break; // no more pages
    }

    // Cap at MAX_POSTS if we overshot.
    if (filtered.length > MAX_POSTS) {
      filtered = filtered.slice(0, MAX_POSTS);
    }

    // ── Empty case ────────────────────────────────────────────────
    if (filtered.length === 0) {
      console.warn(`[interest-profile] no-posts: user ${did}`);
      return { vector: null, postCount: 0, status: "no-posts" };
    }

    // ── Voyage call ───────────────────────────────────────────────
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) {
      console.error("[interest-profile] error: VOYAGE_API_KEY not set");
      return { vector: null, postCount: filtered.length, status: "error" };
    }

    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");

    const body: VoyageEmbedRequest = {
      input: filtered.map((p) => p.text),
      model: MODEL,
      input_type: "query",
    };

    const res = await fetch(VOYAGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(
        `Voyage API ${res.status} ${res.statusText}: ${errorBody.slice(0, 500)}`,
      );
    }

    const response = (await res.json()) as VoyageEmbedResponse;
    validateVoyageResponse(response, filtered.length);

    // ── Mean-pool ─────────────────────────────────────────────────
    const vector = meanPool(response.data.map((d) => d.embedding));

    return { vector, postCount: filtered.length, status: "ok" };
  } catch (err) {
    // Abort propagates immediately — never burn retries or return "error"
    // on a cancelled crawl.
    if (signal?.aborted) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[interest-profile] error: ${msg}`);
    return {
      vector: null,
      postCount: filtered.length,
      status: "error",
    };
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `npm test -- src/lib/crawl/interest-profile.test.ts`

Expected: 8 tests pass (2 filter + 1 mean-pool + 2 validator + 3 buildInterestVector).

- [ ] **Step 4: Run the full suite**

Run: `npm test`

Expected: 77 tests pass (69 baseline + 8 new).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

Expected: zero output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/crawl/interest-profile.ts
git commit -m "feat(crawl): implement buildInterestVector orchestration (#23)

Wires the filterFeedItems + meanPool + validateVoyageResponse pure
helpers into a server-only async function that:

1. Paginates agent.getAuthorFeed with filter: posts_and_author_threads
   up to MAX_PAGES (3) pages, capped at MAX_POSTS (100) filtered posts
2. Applies filterFeedItems per page
3. Returns { status: no-posts } without a Voyage call on empty
4. POSTs filtered text to Voyage /v1/embeddings with input_type=query
5. Validates the response shape
6. Mean-pools the N vectors into one 1024-dim result

Abort handling mirrors crawler.ts:113 — signal?.aborted check in the
top-level catch re-throws the abort while catching everything else as
a structured { status: error } return. The function never throws to
its caller except on abort.

Logs failures with category prefixes for future instrumentation:
'[interest-profile] no-posts: user <did>' vs '[interest-profile]
error: <msg>'."
```

---

### Task 6: Extend CrawlResult type

**Files:**
- Modify: `src/lib/crawl/types.ts`

- [ ] **Step 1: Read the existing file**

Use the Read tool on `/Users/bryan.guffey/Code/Understory/src/lib/crawl/types.ts`. Confirm the current `CrawlResult` has: `talkMentions`, `followCount`, `postsScanned`, `crawledAt`. Confirm the file also exports `TalkMention`, `TalkMentions`, and `CacheEntry` — all of which must remain untouched.

- [ ] **Step 2: Add the two new fields**

Edit `src/lib/crawl/types.ts` and modify only the `CrawlResult` interface. The final shape:

```ts
export interface CrawlResult {
  talkMentions: TalkMentions;
  followCount: number;
  postsScanned: number;
  crawledAt: number;
  /** User interest profile vector (1024-dim voyage-3.5-lite query
   *  embedding, mean-pooled across recent original posts). Null when
   *  the profile build failed or the user had no usable posts. See
   *  interestProfileStatus for the reason. */
  interestVector: number[] | null;
  /** Diagnostic state for the profile build. "ok" when a vector was
   *  produced, "no-posts" when the user had zero usable posts after
   *  filtering, "error" when Voyage or the feed fetch failed. */
  interestProfileStatus: "ok" | "no-posts" | "error";
}
```

Leave `TalkMention`, `TalkMentions`, and `CacheEntry` untouched.

- [ ] **Step 3: Verify the file typechecks**

Run: `npx tsc --noEmit`

Expected: **the typecheck will fail**. `crawler.ts`'s `buildResult` function currently constructs a `CrawlResult` without the two new fields, so TypeScript will flag it. That's expected — Task 7 fixes it. Confirm the errors are specifically about missing `interestVector` and `interestProfileStatus` in `crawler.ts`, and no other errors.

- [ ] **Step 4: Do NOT commit yet**

Task 7 fixes the type error in the same commit.

---

### Task 7: Wire buildInterestVector into crawler.ts

**Files:**
- Modify: `src/lib/crawl/crawler.ts`

- [ ] **Step 1: Read the existing file**

Use the Read tool on `/Users/bryan.guffey/Code/Understory/src/lib/crawl/crawler.ts` to understand the current structure. Note these three details:

1. **`buildResult` is a closure**, not a top-level function. It's defined inside `crawl()` around line 86 as `const buildResult = (postsScanned: number): CrawlResult => {...}` and closes over `followDids`, `followSets`, `postLists`, `rsvpSets`, and `talks`.
2. **`buildResult` is called in TWO places**: the early-exit on line ~106 (`return buildResult(0)`) when the user has zero follows, and the happy-path on line ~150 (`return buildResult(allPosts.length)`). Task 7 must cover both — `interestProfile` is not in scope on the early-exit path because the `Promise.all` hasn't run yet.
3. **The `Promise.all` block** starts around line 112 with `const [rsvpMap, allPosts] = await Promise.all([...])` and contains exactly two parallel calls today: `fetchRsvps` and `searchConferencePosts`.

- [ ] **Step 2: Add the import**

Add this to the imports at the top of `src/lib/crawl/crawler.ts`, alongside the existing `fetchRsvps` and `searchConferencePosts` imports:

```ts
import { buildInterestVector } from "./interest-profile";
import type { InterestProfileResult } from "./interest-profile";
```

- [ ] **Step 3: Extend the Promise.all**

The existing crawler has a block like this:

```ts
const [rsvpMap, allPosts] = await Promise.all([
  fetchRsvps(talks, signal).catch((err) => {
    if (signal?.aborted) throw err;
    console.error("Constellation fetch failed, skipping RSVPs:", err);
    return new Map<string, Set<string>>();
  }),
  searchConferencePosts(agent, signal),
]);
```

Add `buildInterestVector` as a third parallel call, wrapped in `.catch` with the same abort-check pattern. **Do not merge this with the existing destructuring by mistake — add it as a third array element.**

Replace the block above with:

```ts
const [rsvpMap, allPosts, interestProfile] = await Promise.all([
  fetchRsvps(talks, signal).catch((err) => {
    if (signal?.aborted) throw err;
    console.error("Constellation fetch failed, skipping RSVPs:", err);
    return new Map<string, Set<string>>();
  }),
  searchConferencePosts(agent, signal),
  buildInterestVector(agent, did, signal).catch((err): InterestProfileResult => {
    if (signal?.aborted) throw err;
    // buildInterestVector already converts internal failures to structured
    // returns, so this catch is a safety net for anything that slipped
    // through (e.g. a bug in the function itself). Never reached in normal
    // operation.
    console.error("Interest profile build threw unexpectedly:", err);
    return { vector: null, postCount: 0, status: "error" };
  }),
]);
```

- [ ] **Step 4: Extend buildResult's signature and both call sites**

`buildResult` is a closure that currently takes only `postsScanned: number`. It needs to accept a second parameter — the `InterestProfileResult` from `buildInterestVector` — so both call sites can populate the new `CrawlResult` fields.

Change the `buildResult` definition (around line 86) from:

```ts
const buildResult = (postsScanned: number): CrawlResult => {
  const talkMentions: TalkMentions = {};
  for (const talk of talks) {
    const follows = followSets.get(talk.rkey)!;
    talkMentions[talk.rkey] = {
      count: follows.size,
      follows: [...follows],
      posts: postLists.get(talk.rkey)!,
      rsvps: [...rsvpSets.get(talk.rkey)!],
    };
  }
  return {
    talkMentions,
    followCount: followDids.size,
    postsScanned,
    crawledAt: Date.now(),
  };
};
```

to:

```ts
const buildResult = (
  postsScanned: number,
  interestProfile: InterestProfileResult,
): CrawlResult => {
  const talkMentions: TalkMentions = {};
  for (const talk of talks) {
    const follows = followSets.get(talk.rkey)!;
    talkMentions[talk.rkey] = {
      count: follows.size,
      follows: [...follows],
      posts: postLists.get(talk.rkey)!,
      rsvps: [...rsvpSets.get(talk.rkey)!],
    };
  }
  return {
    talkMentions,
    followCount: followDids.size,
    postsScanned,
    crawledAt: Date.now(),
    interestVector: interestProfile.vector,
    interestProfileStatus: interestProfile.status,
  };
};
```

- [ ] **Step 5: Update the early-exit call site**

The early-exit on line ~106 currently reads:

```ts
if (followDids.size === 0) {
  return buildResult(0);
}
```

Change it to pass a synthetic `no-posts` status — this path runs before the profile build has happened, and the user has zero follows anyway, so returning a null vector with `"no-posts"` is the honest answer:

```ts
if (followDids.size === 0) {
  return buildResult(0, {
    vector: null,
    postCount: 0,
    status: "no-posts",
  });
}
```

- [ ] **Step 6: Update the happy-path call site**

The happy-path on line ~150 currently reads:

```ts
return buildResult(allPosts.length);
```

Change it to pass the `interestProfile` from the `Promise.all` destructuring in Step 3:

```ts
return buildResult(allPosts.length, interestProfile);
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`

Expected: zero output. The type error from Task 6 is now resolved because both `buildResult` call sites populate the two new fields via the `interestProfile` argument.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`

Expected: 77 tests pass. The existing crawler tests don't assert anything about the new fields, so no regressions are expected.

- [ ] **Step 9: Commit Tasks 6 + 7 together**

```bash
git add src/lib/crawl/types.ts src/lib/crawl/crawler.ts
git commit -m "feat(crawl): wire interest profile into CrawlResult (#23)

- types.ts: add interestVector: number[] | null and
  interestProfileStatus: 'ok' | 'no-posts' | 'error' to CrawlResult.
  Both required, so the client always has an explicit status for why
  the profile is (or isn't) there.

- crawler.ts: call buildInterestVector as a third parallel branch
  in the existing Promise.all alongside fetchRsvps and
  searchConferencePosts. Wrapped in .catch with the abort-check
  pattern from search.ts:116 — best-effort, never aborts the crawl.
  The catch is a safety net: buildInterestVector already converts
  internal failures to structured {status: error} returns, so the
  catch should never fire under normal operation.

- crawler.ts: extend the CrawlResult construction in buildResult
  to populate the two new fields from the interestProfile result.

No behavior change to layer 1. Layer 2 stays dark — the vector
flows through the response and sits unused until #24 wires it into
combineLayers."
```

---

### Task 8: Pass the new fields through useCrawlData

**Files:**
- Modify: `src/hooks/useCrawlData.ts`

- [ ] **Step 1: Read the existing file**

Use the Read tool on `/Users/bryan.guffey/Code/Understory/src/hooks/useCrawlData.ts`. Note that the hook's `CrawlData` interface is NOT structurally identical to the server's `CrawlResult` — it reshapes `talkMentions` → `mentions` and adds `loading` / `error` fields. You're preserving that pattern.

- [ ] **Step 2: Add the two new fields to the CrawlData interface**

The existing interface:

```ts
export interface CrawlData {
  mentions: TalkMentions | null;
  followCount: number;
  loading: boolean;
  error: string | null;
}
```

Extend it to:

```ts
export interface CrawlData {
  mentions: TalkMentions | null;
  followCount: number;
  loading: boolean;
  error: string | null;
  /** User interest profile vector from /api/crawl. Null while loading,
   *  on auth failure, on network failure, or when the profile build
   *  returned status: no-posts / error. #24 consumes this for layer-2
   *  cosine matching. */
  interestVector: number[] | null;
  /** Diagnostic state for the profile build. Null in the initial load
   *  and non-happy-path states (401/504/network error). Only populated
   *  with the server's status on a successful /api/crawl response. */
  interestProfileStatus: "ok" | "no-posts" | "error" | null;
}
```

- [ ] **Step 3: Set the new fields to null in the initial useState default**

Find the existing `useState<CrawlData>({...})` call (line ~24). Add the two new fields:

```ts
const [data, setData] = useState<CrawlData>({
  mentions: null,
  followCount: 0,
  loading: true,
  error: null,
  interestVector: null,
  interestProfileStatus: null,
});
```

- [ ] **Step 4: Set the new fields to null in the 401/504 branch**

Find the `setData({...})` call inside the `if (res.status === 401 || res.status === 504)` branch. Add the two new fields set to `null`:

```ts
setData({
  mentions: null,
  followCount: 0,
  loading: false,
  error: null,
  interestVector: null,
  interestProfileStatus: null,
});
```

- [ ] **Step 5: Set the new fields to null in the other-error branch**

Find the `else` branch that sets `error: \`Crawl failed: ${res.status} ${res.statusText}\``. Add the two new fields set to `null`:

```ts
setData({
  mentions: null,
  followCount: 0,
  loading: false,
  error: `Crawl failed: ${res.status} ${res.statusText}`,
  interestVector: null,
  interestProfileStatus: null,
});
```

- [ ] **Step 6: Unpack the new fields from the JSON in the happy-path setData**

Find the happy-path `setData({...})` call that reads from `json.talkMentions` and `json.followCount`. Add the two new fields:

```ts
setData({
  mentions: json.talkMentions,
  followCount: json.followCount,
  loading: false,
  error: null,
  interestVector: json.interestVector ?? null,
  interestProfileStatus: json.interestProfileStatus ?? null,
});
```

The `?? null` guards are defensive in case a stale `/api/crawl` response (e.g., cached by a deployed-but-not-redeployed worker) is missing the new fields. They become unnecessary once the server-side ships, but cost nothing.

- [ ] **Step 7: Set the new fields to null in the catch-all**

Find the outer `try { ... } catch { setData({...}) }`. Add the two new fields set to `null`:

```ts
} catch (err) {
  if (!cancelled) {
    setData({
      mentions: null,
      followCount: 0,
      loading: false,
      error: err instanceof Error ? err.message : "Crawl failed",
      interestVector: null,
      interestProfileStatus: null,
    });
  }
}
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`

Expected: zero output. `ScoredTalksGrid` destructures from `useCrawlData()` but only uses `mentions`, `followCount`, `loading`, and `error`, so adding optional fields to the return type is purely additive.

- [ ] **Step 9: Run the full test suite**

Run: `npm test`

Expected: 77 tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/hooks/useCrawlData.ts
git commit -m "feat(hooks): surface interest profile fields in useCrawlData (#23)

Extend the client-side CrawlData shape with interestVector and
interestProfileStatus, mirroring the two new fields on the server-side
CrawlResult. Both are nullable on the client side because the initial
useState, 401/504 branch, other-error branch, and catch-all all have
to produce a CrawlData value before any server response exists.

Happy-path setData unpacks json.interestVector and json.interestProfileStatus
from /api/crawl, with ?? null guards for forward/backward compatibility
with stale responses during deploy rollouts.

No consumer uses the new fields yet. #24 will."
```

---

## Final Validation

- [ ] **Step 1: Full test suite**

Run: `npm test`

Expected: 77 tests pass across 6 test files (5 existing + 1 new `interest-profile.test.ts`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: zero output.

- [ ] **Step 3: Lint**

Run: `npm run lint 2>&1 | tail -20`

Expected: zero errors in the touched files.

- [ ] **Step 4: Manual spot-check on staging**

This cannot happen until the PR lands on the staging environment. After Railway redeploys:

1. Log in on the staging URL as yourself
2. Open browser devtools → Network → filter on `crawl`
3. Inspect the response body. Verify `interestVector` is a non-null array of 1024 numbers, and `interestProfileStatus === "ok"`
4. If `interestProfileStatus === "no-posts"` or `"error"`, check the Railway deployment logs for `[interest-profile]` prefixed messages to understand why
5. Observe `/talks` — it should look **identical to before**. Layer 2 stays dark until #24 consumes the vector, so no user-visible change is the correct outcome

If the response body is missing the new fields entirely, the server build hasn't deployed yet (or the browser is serving a cached response from before the deploy — hard-refresh).

- [ ] **Step 5: File any follow-ups**

If the staging smoke test surfaces anything unexpected (e.g., low `postCount` for users you expected to have more posts, Voyage errors in the logs), file follow-up issues rather than patching in this PR. The `interestProfileStatus` diagnostic field exists precisely so we can see the telemetry before deciding whether to tune.

---

## Known Follow-Ups (out of scope)

- **#24** — Consume `interestVector` in the scoring engine. Replace `computeInterestStub` with a function that computes `cosineSimilarity(interestVector, talkEmbedding)` for every talk and returns it as the layer-2 contribution to `combineLayers`. Load `data/embeddings/{rkey}.json` from the server bundle at startup. This is the task that actually lights up layer 2.
- **#22** — Publish `watch.understory.topicIndex` records to a project PDS. Independent of #23 and #24; owned by a different thread of work.
- **#53** — Tighten embed.ts I/O robustness (atomic writes, JSON parse guards). Pre-existing from the #21 code review, still open.
- **#54** — Extract topic labels for talks via LLM. Pre-existing from the #21 scope split.
- **Future tuning**: post scope (100 / 90 days), aggregation weights (mean-pool vs recency-weighted), model (voyage-3.5-lite vs voyage-3.5 / voyage-3-large). Don't touch until we see real user data showing the current defaults underperform.
