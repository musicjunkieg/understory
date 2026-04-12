import type { Agent, AppBskyFeedDefs } from "@atproto/api";

type PostView = AppBskyFeedDefs.PostView;

const SEARCH_QUERIES = [
  "atmosphereconf",
  "atmosphere conf",
  "stream.place",
];

const SEARCH_SINCE = "2026-03-26T00:00:00.000Z";
// Extended beyond the conference window (March 26 – April 5) to capture
// post-conference aftermath discussion so Understory stays useful after the
// event ends. searchPosts `until` is exclusive, so 2026-04-27T00:00:00.000Z
// includes every post through the end of April 26, 2026.
const SEARCH_UNTIL = "2026-04-27T00:00:00.000Z";

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 200;

interface SearchPageResult {
  posts: PostView[];
  cursor: string | undefined;
}

interface SearchPageParams {
  q: string;
  sort: "latest";
  since: string;
  until: string;
  limit: number;
  cursor?: string;
}

/**
 * Sleep that aborts cleanly when the crawl signal aborts. Uses a one-shot
 * listener so the timer is cancelled instead of leaking past the abort.
 */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal!.reason ?? new Error("Aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Inspect an arbitrary thrown value and decide whether to retry.
 *
 * Retryable: HTTP `429`, any `5xx`, and network errors (fetch / DNS / TCP
 * failures that surface without a status). Non-retryable: other HTTP 4xx
 * and anything with a non-retryable status shape.
 *
 * `@atproto/api` throws `XRPCError` with a numeric `status` on HTTP errors,
 * so that's what we look at first. We fall back to `error.status` on plain
 * objects for defensive parity.
 */
function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return true; // unknown — retry once
  const status = (err as { status?: number }).status;
  if (typeof status === "number") {
    return status === 429 || (status >= 500 && status < 600);
  }
  // No status → network / abort-ish error. Retry unless it's an AbortError
  // (abort handling is done by the caller; we just signal retryable=true).
  return true;
}

/**
 * Fetch a single search page via the user's authenticated agent with
 * bounded retries on transient failures.
 *
 * Why authenticated: the public Bluesky AppView (`public.api.bsky.app`)
 * returns `403 Forbidden` on paginated `searchPosts` requests to prevent
 * unauthenticated scraping — documented behavior per bluesky-social/atproto
 * issue #3583 and others. The alternate host `api.bsky.app` IP-blocks
 * Railway egress. Authenticated-through-PDS is the only reliable path.
 *
 * The original PDS path was returning 500 because `@atproto/oauth-client-node`
 * was running without a `requestLock`, letting concurrent crawl operations
 * race on token refresh and get credentials revoked. That lock is now
 * installed in `src/lib/auth/client.ts`.
 *
 * Retries: 3 attempts, exponential backoff (200ms → 400ms → 800ms) with
 * uniform jitter, retry only on 429/5xx/network. Abort always propagates
 * immediately so a cancelled crawl never burns retries. Retry counts and
 * delays are deliberately small because the overall crawl has a 30s budget
 * enforced upstream in `src/app/api/crawl/route.ts`.
 */
async function fetchSearchPage(
  agent: Agent,
  params: SearchPageParams,
  signal?: AbortSignal,
): Promise<SearchPageResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");

    try {
      const res = await agent.app.bsky.feed.searchPosts(params, { signal });
      return { posts: res.data.posts, cursor: res.data.cursor };
    } catch (err) {
      // Abort always propagates immediately — never burn retries on a
      // cancelled crawl.
      if (signal?.aborted) throw err;
      if (!isRetryableError(err)) throw err;
      lastError = err;
    }

    // No sleep after the final attempt — we're about to give up.
    if (attempt < MAX_ATTEMPTS - 1) {
      const backoff = BASE_BACKOFF_MS * 2 ** attempt;
      const jitter = Math.random() * backoff;
      await abortableDelay(backoff + jitter, signal);
    }
  }

  throw lastError ?? new Error("searchPosts failed after retries");
}

/**
 * Search Bluesky for conference-related posts during the conference period
 * and the post-conference aftermath. Returns deduplicated posts from all
 * search queries.
 */
export async function searchConferencePosts(
  agent: Agent,
  signal?: AbortSignal,
): Promise<PostView[]> {
  const seenUris = new Set<string>();
  const posts: PostView[] = [];

  for (const query of SEARCH_QUERIES) {
    let cursor: string | undefined;

    do {
      if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
      try {
        const page = await fetchSearchPage(
          agent,
          {
            q: query,
            sort: "latest",
            since: SEARCH_SINCE,
            until: SEARCH_UNTIL,
            limit: 100,
            cursor,
          },
          signal,
        );

        for (const post of page.posts) {
          if (!seenUris.has(post.uri)) {
            seenUris.add(post.uri);
            posts.push(post);
          }
        }

        cursor = page.cursor;
      } catch (error) {
        // Propagate abort errors so the whole crawl cancels cleanly.
        if (signal?.aborted) throw error;
        console.error(
          `Search query "${query}" failed after ${MAX_ATTEMPTS} attempts:`,
          error,
        );
        break;
      }
    } while (cursor);
  }

  return posts;
}
