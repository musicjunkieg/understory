import type { AppBskyFeedDefs } from "@atproto/api";

type PostView = AppBskyFeedDefs.PostView;

const APPVIEW_URL =
  "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts";

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

interface SearchResponse {
  posts: PostView[];
  cursor?: string;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
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
 * Fetch a single search page with bounded retries on transient failures.
 *
 * Retries on HTTP 429, 5xx, and network errors with exponential backoff
 * (200ms → 400ms → 800ms) plus uniform jitter up to the same delay.
 * Non-retryable HTTP errors (4xx other than 429) and abort errors are
 * thrown immediately. The crawl has a 30s overall budget enforced upstream,
 * so retry counts and base delay are deliberately kept small.
 */
async function fetchSearchPage(
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");

    try {
      const res = await fetch(`${APPVIEW_URL}?${params.toString()}`, {
        signal,
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        return (await res.json()) as SearchResponse;
      }
      if (!isRetryableStatus(res.status)) {
        throw new Error(
          `AppView searchPosts returned ${res.status} ${res.statusText}`,
        );
      }
      lastError = new Error(
        `AppView searchPosts returned ${res.status} ${res.statusText}`,
      );
    } catch (err) {
      // Abort always propagates immediately — never burn retries on a
      // cancelled crawl.
      if (signal?.aborted) throw err;
      lastError = err;
    }

    // No sleep after the final attempt — we're about to give up.
    if (attempt < MAX_ATTEMPTS - 1) {
      const backoff = BASE_BACKOFF_MS * 2 ** attempt;
      const jitter = Math.random() * backoff;
      await abortableDelay(backoff + jitter, signal);
    }
  }

  throw lastError ?? new Error("AppView searchPosts failed after retries");
}

/**
 * Search Bluesky for conference-related posts during the conference period
 * and the post-conference aftermath.
 *
 * Calls the public AppView (`api.bsky.app`) directly via `fetch` instead of
 * routing through the user's PDS via `agent.app.bsky.feed.searchPosts`. The
 * search is a public read — there is no benefit to authenticating it, and
 * the OAuth/DPoP path through the PDS has been observed returning 5xx in
 * production while the public AppView returns 200 for the same query.
 */
export async function searchConferencePosts(
  signal?: AbortSignal,
): Promise<PostView[]> {
  const seenUris = new Set<string>();
  const posts: PostView[] = [];

  for (const query of SEARCH_QUERIES) {
    let cursor: string | undefined;

    do {
      if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
      const params = new URLSearchParams({
        q: query,
        sort: "latest",
        since: SEARCH_SINCE,
        until: SEARCH_UNTIL,
        limit: "100",
      });
      if (cursor) params.set("cursor", cursor);

      try {
        const data = await fetchSearchPage(params, signal);

        for (const post of data.posts) {
          if (!seenUris.has(post.uri)) {
            seenUris.add(post.uri);
            posts.push(post);
          }
        }

        cursor = data.cursor;
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
