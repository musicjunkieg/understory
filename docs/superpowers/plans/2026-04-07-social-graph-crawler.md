# Social Graph Crawler + Post-to-Talk Matching Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crawl an authenticated user's social graph to determine which ATmosphereConf talks their network discussed, using Constellation backlinks for RSVPs and Bluesky searchPosts for text mentions.

**Architecture:** Server-side `GET /api/crawl` route handler. Fetches all follows, queries Constellation for RSVP backlinks per talk, searches Bluesky for conference text posts, filters both to the user's network, matches posts to talks, caches results per DID. Two independent data strategies merged into one `TalkMentions` map.

**Tech Stack:** Next.js 16 (App Router), `@atproto/api` Agent, Constellation API (`constellation.microcosm.blue`), TypeScript

**Spec:** `docs/superpowers/specs/2026-04-07-social-graph-crawler.md`

**Chainlink Issues:** #16, #17

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/crawl/types.ts` | Create | Shared types (TalkMention, TalkMentions, CrawlResult, CacheEntry) |
| `src/lib/crawl/constellation.ts` | Create | Query Constellation backlinks API for RSVPs per talk |
| `src/lib/crawl/search.ts` | Create | Text search via authenticated Agent searchPosts, filter to follows |
| `src/lib/crawl/matcher.ts` | Create | Match posts to talks (URI, embed, speaker+conf, title+conf) |
| `src/lib/crawl/cache.ts` | Create | In-memory TTL cache with concurrent request protection |
| `src/lib/crawl/crawler.ts` | Create | Orchestrate: fetch follows, run both strategies, merge results |
| `src/app/api/crawl/route.ts` | Create | GET handler: auth check, call crawler, return JSON |

---

## Chunk 1: Types and Cache

### Task 1: Crawl types

**Files:**
- Create: `src/lib/crawl/types.ts`

- [ ] **Step 1: Create the crawl directory and types file**

Run: `mkdir -p src/lib/crawl`

```ts
export interface TalkMention {
  count: number;
  follows: string[];
  posts: string[];
  rsvps: string[];
}

export interface TalkMentions {
  [rkey: string]: TalkMention;
}

export interface CrawlResult {
  talkMentions: TalkMentions;
  followCount: number;
  postsScanned: number;
  crawledAt: number;
}

export interface CacheEntry {
  data: CrawlResult;
  timestamp: number;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/lib/crawl/types.ts
git commit -m "feat: add shared types for social graph crawler"
```

---

### Task 2: Cache with TTL and concurrent request protection

**Files:**
- Create: `src/lib/crawl/cache.ts`

- [ ] **Step 1: Write the cache module**

```ts
import type { CrawlResult, CacheEntry } from "./types";

const TTL_MS = 30 * 60 * 1000; // 30 minutes

declare global {
  var __crawlCache: Map<string, CacheEntry> | undefined;
  var __crawlInFlight: Map<string, Promise<CrawlResult>> | undefined;
}

function getCache(): Map<string, CacheEntry> {
  if (!globalThis.__crawlCache) {
    globalThis.__crawlCache = new Map();
  }
  return globalThis.__crawlCache;
}

function getInFlight(): Map<string, Promise<CrawlResult>> {
  if (!globalThis.__crawlInFlight) {
    globalThis.__crawlInFlight = new Map();
  }
  return globalThis.__crawlInFlight;
}

export function getCached(did: string): CrawlResult | null {
  const cache = getCache();
  const entry = cache.get(did);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL_MS) {
    cache.delete(did);
    return null;
  }
  return entry.data;
}

export function setCached(did: string, data: CrawlResult): void {
  getCache().set(did, { data, timestamp: Date.now() });
}

export function getInFlightCrawl(did: string): Promise<CrawlResult> | null {
  return getInFlight().get(did) ?? null;
}

export function setInFlightCrawl(
  did: string,
  promise: Promise<CrawlResult>,
): void {
  const inFlight = getInFlight();
  inFlight.set(did, promise);
  promise.finally(() => inFlight.delete(did));
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/lib/crawl/cache.ts
git commit -m "feat: add in-memory TTL cache with concurrent request protection"
```

---

## Chunk 2: Constellation + Search Strategies

### Task 3: Constellation backlinks (RSVP data)

**Files:**
- Create: `src/lib/crawl/constellation.ts`

- [ ] **Step 1: Write the Constellation module**

```ts
import type { TalkEntry } from "@/lib/types";

const CONSTELLATION_BASE = "https://constellation.microcosm.blue";

interface ConstellationLinksAll {
  links: Record<string, Record<string, { records: number; distinct_dids: number }>>;
}

interface ConstellationBacklink {
  did: string;
  collection: string;
  rkey: string;
  path: string;
}

interface ConstellationBacklinksResponse {
  total: number;
  records: ConstellationBacklink[];
  cursor: string | null;
}

/**
 * For each talk with an eventUri, query Constellation for RSVPs.
 * Returns a map of rkey → Set of DIDs who RSVPed.
 */
export async function fetchRsvps(
  talks: TalkEntry[],
): Promise<Map<string, Set<string>>> {
  const rsvpMap = new Map<string, Set<string>>();
  const talksWithEvents = talks.filter((t) => t.eventUri);

  // First pass: check which talks have RSVPs (parallelized)
  const linksResults = await Promise.allSettled(
    talksWithEvents.map(async (talk) => {
      const url = `${CONSTELLATION_BASE}/links/all?target=${encodeURIComponent(talk.eventUri!)}`;
      const res = await fetch(url);
      if (!res.ok) return { talk, hasRsvps: false };
      const data: ConstellationLinksAll = await res.json();
      const rsvpEntry = data.links?.["community.lexicon.calendar.rsvp"];
      const hasRsvps = rsvpEntry && Object.values(rsvpEntry).some((v) => v.records > 0);
      return { talk, hasRsvps: !!hasRsvps };
    }),
  );

  // Second pass: fetch actual RSVP DIDs for talks that have them
  const talksWithRsvps = linksResults
    .filter((r): r is PromiseFulfilledResult<{ talk: TalkEntry; hasRsvps: boolean }> =>
      r.status === "fulfilled" && r.value.hasRsvps,
    )
    .map((r) => r.value.talk);

  await Promise.allSettled(
    talksWithRsvps.map(async (talk) => {
      const dids = new Set<string>();
      let cursor: string | null = null;

      do {
        const params = new URLSearchParams({
          subject: talk.eventUri!,
          source: "community.lexicon.calendar.rsvp:.subject.uri",
          limit: "100",
        });
        if (cursor) params.set("cursor", cursor);

        const url = `${CONSTELLATION_BASE}/xrpc/blue.microcosm.links.getBacklinks?${params}`;
        const res = await fetch(url);
        if (!res.ok) break;

        const data: ConstellationBacklinksResponse = await res.json();
        for (const record of data.records) {
          dids.add(record.did);
        }
        cursor = data.cursor;
      } while (cursor);

      if (dids.size > 0) {
        rsvpMap.set(talk.rkey, dids);
      }
    }),
  );

  return rsvpMap;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/lib/crawl/constellation.ts
git commit -m "feat: add Constellation backlinks module for RSVP data"
```

---

### Task 4: Post-to-talk matcher

**Files:**
- Create: `src/lib/crawl/matcher.ts`

- [ ] **Step 1: Write the matcher**

```ts
import type { TalkEntry } from "@/lib/types";
import type { AppBskyFeedDefs } from "@atproto/api";

type PostView = AppBskyFeedDefs.PostView;

const CONF_TERMS = ["atmosphereconf", "atmosphere conf", "atmoconf", "stream.place"];

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "can", "shall", "this", "that",
  "these", "those", "it", "its",
]);

function getSignificantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function hasConfTerm(text: string): boolean {
  const lower = text.toLowerCase();
  return CONF_TERMS.some((term) => lower.includes(term));
}

function getPostText(post: PostView): string {
  const record = post.record as { text?: string };
  return record?.text ?? "";
}

function getEmbedUris(post: PostView): string[] {
  const uris: string[] = [];
  const record = post.record as { embed?: Record<string, unknown> };
  const embed = post.embed as Record<string, unknown> | undefined;

  // Check view-level embed
  if (embed) {
    // record embed
    if (embed.record && typeof embed.record === "object") {
      const rec = embed.record as { uri?: string };
      if (rec.uri) uris.push(rec.uri);
    }
    // external embed
    if (embed.external && typeof embed.external === "object") {
      const ext = embed.external as { uri?: string };
      if (ext.uri) uris.push(ext.uri);
    }
  }

  // Check record-level embed
  if (record?.embed) {
    const recEmbed = record.embed as Record<string, unknown>;
    if (recEmbed.record && typeof recEmbed.record === "object") {
      const rec = recEmbed.record as { uri?: string };
      if (rec.uri) uris.push(rec.uri);
    }
    if (recEmbed.external && typeof recEmbed.external === "object") {
      const ext = recEmbed.external as { uri?: string };
      if (ext.uri) uris.push(ext.uri);
    }
  }

  return uris;
}

/**
 * Match a single post against all talks. Returns rkeys of matched talks.
 */
export function matchPost(
  post: PostView,
  talks: TalkEntry[],
): string[] {
  const text = getPostText(post);
  const textLower = text.toLowerCase();
  const embedUris = getEmbedUris(post);
  const matched: string[] = [];

  for (const talk of talks) {
    // 1. URI match in text
    if (talk.vodUri && textLower.includes(talk.vodUri.toLowerCase())) {
      matched.push(talk.rkey);
      continue;
    }
    if (talk.eventUri && textLower.includes(talk.eventUri.toLowerCase())) {
      matched.push(talk.rkey);
      continue;
    }

    // 2. Embed match
    if (embedUris.some((uri) => uri === talk.vodUri || uri === talk.eventUri)) {
      matched.push(talk.rkey);
      continue;
    }

    // 3. Speaker + conference term
    if (hasConfTerm(textLower) && talk.speakers.length > 0) {
      const mentionsSpeaker = talk.speakers.some((s) => {
        const handle = s.id.toLowerCase();
        return textLower.includes(handle) || textLower.includes(`@${handle}`);
      });
      if (mentionsSpeaker) {
        matched.push(talk.rkey);
        continue;
      }
    }

    // 4. Title match (≥4 significant words) + conference term
    if (hasConfTerm(textLower)) {
      const titleWords = getSignificantWords(talk.title);
      if (titleWords.length >= 4) {
        const postWords = getSignificantWords(text);
        const postWordStr = postWords.join(" ");
        // Check for 4+ consecutive title words in post
        for (let i = 0; i <= titleWords.length - 4; i++) {
          const seq = titleWords.slice(i, i + 4).join(" ");
          if (postWordStr.includes(seq)) {
            matched.push(talk.rkey);
            break;
          }
        }
      }
    }
  }

  return matched;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/lib/crawl/matcher.ts
git commit -m "feat: add post-to-talk matcher (URI, embed, speaker, title)"
```

---

### Task 5: Bluesky text search

**Files:**
- Create: `src/lib/crawl/search.ts`

- [ ] **Step 1: Write the search module**

```ts
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
): Promise<PostView[]> {
  const seenUris = new Set<string>();
  const posts: PostView[] = [];

  for (const query of SEARCH_QUERIES) {
    let cursor: string | undefined;

    do {
      try {
        const res = await agent.app.bsky.feed.searchPosts({
          q: query,
          sort: "latest",
          since: SEARCH_SINCE,
          until: SEARCH_UNTIL,
          limit: 100,
          cursor,
        });

        for (const post of res.data.posts) {
          if (!seenUris.has(post.uri)) {
            seenUris.add(post.uri);
            posts.push(post);
          }
        }

        cursor = res.data.cursor;
      } catch (error) {
        console.error(`Search query "${query}" failed:`, error);
        break;
      }
    } while (cursor);
  }

  return posts;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/lib/crawl/search.ts
git commit -m "feat: add Bluesky text search for conference posts"
```

---

## Chunk 3: Crawler Orchestrator + API Route

### Task 6: Crawler orchestrator

**Files:**
- Create: `src/lib/crawl/crawler.ts`

- [ ] **Step 1: Write the crawler**

```ts
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/lib/crawl/crawler.ts
git commit -m "feat: add crawler orchestrator — fetches follows, merges RSVP + search data"
```

---

### Task 7: API route handler

**Files:**
- Create: `src/app/api/crawl/route.ts`

- [ ] **Step 1: Create the directory**

Run: `mkdir -p src/app/api/crawl`

- [ ] **Step 2: Write the route handler**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { crawl } from "@/lib/crawl/crawler";
import {
  getCached,
  setCached,
  getInFlightCrawl,
  setInFlightCrawl,
} from "@/lib/crawl/cache";

const TIMEOUT_MS = 30_000;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const force = request.nextUrl.searchParams.get("force") === "true";

  // Check cache
  if (!force) {
    const cached = getCached(session.did);
    if (cached) {
      return NextResponse.json({ ...cached, cached: true });
    }
  }

  // Check for in-flight crawl
  const inFlight = getInFlightCrawl(session.did);
  if (inFlight) {
    try {
      const result = await inFlight;
      return NextResponse.json({ ...result, cached: true });
    } catch {
      // In-flight failed, start a new one below
    }
  }

  // Start crawl with timeout
  const crawlPromise = crawl(session.agent, session.did);
  setInFlightCrawl(session.did, crawlPromise);

  try {
    const result = await Promise.race([
      crawlPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Crawl timeout")), TIMEOUT_MS),
      ),
    ]);

    setCached(session.did, result);
    return NextResponse.json({ ...result, cached: false });
  } catch (error) {
    console.error("Crawl failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Crawl failed",
        partial: true,
      },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/crawl/route.ts
git commit -m "feat: add GET /api/crawl route with auth, caching, and timeout"
```

---

### Task 8: Lint, type check, and build

- [ ] **Step 1: Run eslint**

Run: `npx eslint src/`
Fix any issues.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: Build succeeds. `/api/crawl` appears as a dynamic route.

- [ ] **Step 4: Manual test**

With dev server running and authenticated:
1. Open browser console
2. Run: `fetch('/api/crawl').then(r => r.json()).then(d => console.log(d))`
3. Should return `{ talkMentions, followCount, postsScanned, cached: false }`
4. Run again — should return `{ ..., cached: true }` quickly
5. Run with force: `fetch('/api/crawl?force=true').then(r => r.json()).then(d => console.log(d))`

- [ ] **Step 5: Commit fixes if any**

```bash
git add src/
git commit -m "fix: resolve lint and type issues in crawler"
```
