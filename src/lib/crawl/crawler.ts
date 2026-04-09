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

/**
 * Fetch all follows for a user. Returns a Set of DIDs.
 */
async function fetchFollows(agent: Agent, did: string): Promise<Set<string>> {
  const follows = new Set<string>();
  let cursor: string | undefined;

  do {
    const res = await agent.getFollows({
      actor: did,
      limit: 100,
      cursor,
    });
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
): Promise<CrawlResult> {
  const talks = getTalks();
  const talkMentions: TalkMentions = {};

  // Initialize empty mentions for all talks
  for (const talk of talks) {
    talkMentions[talk.rkey] = {
      count: 0,
      follows: [],
      posts: [],
      rsvps: [],
    };
  }

  // Fetch follows
  const followDids = await fetchFollows(agent, did);
  if (followDids.size === 0) {
    return {
      talkMentions,
      followCount: 0,
      postsScanned: 0,
      crawledAt: Date.now(),
    };
  }

  // Run both strategies in parallel
  const [rsvpMap, allPosts] = await Promise.all([
    fetchRsvps(talks).catch((err) => {
      console.error("Constellation fetch failed, skipping RSVPs:", err);
      return new Map<string, Set<string>>();
    }),
    searchConferencePosts(agent),
  ]);

  // Strategy A: Apply RSVP data
  for (const [rkey, rsvpDids] of rsvpMap) {
    const mention = talkMentions[rkey];
    if (!mention) continue;
    for (const rsvpDid of rsvpDids) {
      if (followDids.has(rsvpDid) && !mention.rsvps.includes(rsvpDid)) {
        mention.rsvps.push(rsvpDid);
        if (!mention.follows.includes(rsvpDid)) {
          mention.follows.push(rsvpDid);
          mention.count++;
        }
      }
    }
  }

  // Strategy B: Filter posts to follows, match to talks
  const networkPosts = allPosts.filter((p) => followDids.has(p.author.did));

  for (const post of networkPosts) {
    const matchedRkeys = matchPost(post, talks);
    for (const rkey of matchedRkeys) {
      const mention = talkMentions[rkey];
      if (!mention) continue;
      mention.posts.push(post.uri);
      if (!mention.follows.includes(post.author.did)) {
        mention.follows.push(post.author.did);
        mention.count++;
      }
    }
  }

  return {
    talkMentions,
    followCount: followDids.size,
    postsScanned: allPosts.length,
    crawledAt: Date.now(),
  };
}
