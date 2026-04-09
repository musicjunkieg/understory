import type { Agent } from "@atproto/api";
import type { TalkEntry } from "@/lib/types";
import type { TalkMentions, CrawlResult } from "./types";
import { fetchRsvps } from "./constellation";
import { searchConferencePosts } from "./search";
import { matchPost } from "./matcher";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.resolve(process.cwd(), "data");

function loadTalks(): TalkEntry[] {
  const raw = fs.readFileSync(path.join(DATA_DIR, "talks.json"), "utf-8");
  return JSON.parse(raw);
}

// Cache the talk list — loaded once per server lifecycle
let cachedTalks: TalkEntry[] | null = null;
function getTalks(): TalkEntry[] {
  if (!cachedTalks) {
    cachedTalks = loadTalks().filter((t) => t.eventUri);
  }
  return cachedTalks;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Aborted");
  }
}

/**
 * Fetch all follows for a user. Returns a Set of DIDs.
 */
async function fetchFollows(
  agent: Agent,
  did: string,
  signal?: AbortSignal,
): Promise<Set<string>> {
  const follows = new Set<string>();
  let cursor: string | undefined;

  do {
    throwIfAborted(signal);
    const res = await agent.getFollows(
      {
        actor: did,
        limit: 100,
        cursor,
      },
      { signal },
    );
    for (const follow of res.data.follows) {
      follows.add(follow.did);
    }
    cursor = res.data.cursor;
  } while (cursor);

  return follows;
}

/**
 * Run the full crawl: fetch follows, query Constellation + search, match, merge.
 */
export async function crawl(
  agent: Agent,
  did: string,
  signal?: AbortSignal,
): Promise<CrawlResult> {
  const talks = getTalks();

  // Build aggregation with Set-backed per-talk tracking to avoid O(n²)
  // includes() scans on hot loops. These are projected to arrays at the end.
  const followSets = new Map<string, Set<string>>();
  const rsvpSets = new Map<string, Set<string>>();
  const postLists = new Map<string, string[]>();
  for (const talk of talks) {
    followSets.set(talk.rkey, new Set());
    rsvpSets.set(talk.rkey, new Set());
    postLists.set(talk.rkey, []);
  }

  // Fetch follows
  const followDids = await fetchFollows(agent, did, signal);

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

  if (followDids.size === 0) {
    return buildResult(0);
  }

  throwIfAborted(signal);

  // Run both strategies in parallel
  const [rsvpMap, allPosts] = await Promise.all([
    fetchRsvps(talks, signal).catch((err) => {
      if (signal?.aborted) throw err;
      console.error("Constellation fetch failed, skipping RSVPs:", err);
      return new Map<string, Set<string>>();
    }),
    searchConferencePosts(agent, signal),
  ]);

  throwIfAborted(signal);

  // Strategy A: Apply RSVP data
  for (const [rkey, rsvpDids] of rsvpMap) {
    const rsvpSet = rsvpSets.get(rkey);
    const followSet = followSets.get(rkey);
    if (!rsvpSet || !followSet) continue;
    for (const rsvpDid of rsvpDids) {
      if (followDids.has(rsvpDid)) {
        rsvpSet.add(rsvpDid);
        followSet.add(rsvpDid);
      }
    }
  }

  // Strategy B: Filter posts to follows, match to talks
  const networkPosts = allPosts.filter((p) => followDids.has(p.author.did));

  for (const post of networkPosts) {
    const matchedRkeys = matchPost(post, talks);
    for (const rkey of matchedRkeys) {
      const posts = postLists.get(rkey);
      const followSet = followSets.get(rkey);
      if (!posts || !followSet) continue;
      posts.push(post.uri);
      followSet.add(post.author.did);
    }
  }

  return buildResult(allPosts.length);
}
