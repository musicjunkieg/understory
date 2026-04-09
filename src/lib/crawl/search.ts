import type { Agent } from "@atproto/api";
import type { AppBskyFeedDefs } from "@atproto/api";

type PostView = AppBskyFeedDefs.PostView;

const SEARCH_QUERIES = [
  "atmosphereconf",
  "atmosphere conf",
  "stream.place",
];

const SEARCH_SINCE = "2026-03-26T00:00:00.000Z";
const SEARCH_UNTIL = "2026-04-06T00:00:00.000Z";

/**
 * Search Bluesky for conference-related posts within the conference window.
 * Returns deduplicated posts from all search queries.
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
        const res = await agent.app.bsky.feed.searchPosts(
          {
            q: query,
            sort: "latest",
            since: SEARCH_SINCE,
            until: SEARCH_UNTIL,
            limit: 100,
            cursor,
          },
          { signal },
        );

        for (const post of res.data.posts) {
          if (!seenUris.has(post.uri)) {
            seenUris.add(post.uri);
            posts.push(post);
          }
        }

        cursor = res.data.cursor;
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
