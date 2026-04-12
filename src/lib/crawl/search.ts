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

interface SearchResponse {
  posts: PostView[];
  cursor?: string;
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
        const res = await fetch(`${APPVIEW_URL}?${params.toString()}`, {
          signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          throw new Error(
            `AppView searchPosts returned ${res.status} ${res.statusText}`,
          );
        }
        const data = (await res.json()) as SearchResponse;

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
        console.error(`Search query "${query}" failed:`, error);
        break;
      }
    } while (cursor);
  }

  return posts;
}
