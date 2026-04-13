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
