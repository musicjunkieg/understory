import type { Agent } from "@atproto/api";
import type { TalkEntry } from "@/lib/types";
import type { TalkMentions, CrawlResult } from "./types";
import { fetchRsvps } from "./constellation";
import { searchConferencePosts } from "./search";
import { buildInterestVector } from "./interest-profile";
import type { InterestProfileResult } from "./interest-profile";
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

  if (followDids.size === 0) {
    // A zero-follows user has no layer-1 signal worth scoring against.
    // We skip buildInterestVector entirely (no Voyage cost, no latency),
    // and synthesize status: "no-posts" so the client treats this
    // uniformly with the "we tried and found zero usable posts" case —
    // both mean "no layer-2 vector available," which is what #24 needs.
    return buildResult(0, {
      vector: null,
      postCount: 0,
      status: "no-posts",
    });
  }

  throwIfAborted(signal);

  // Run both strategies in parallel, plus interest profile build
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

  return buildResult(allPosts.length, interestProfile);
}
