# Social Graph Crawler + Post-to-Talk Matching Spec

**Date:** 2026-04-07
**Issues:** Chainlink #16, #17
**Status:** Approved

---

## Overview

Server-side crawl of the authenticated user's social graph to determine which ATmosphereConf talks their network discussed. Uses targeted `searchPosts` queries (not per-follow feed fetches) for efficiency. Matches posts to talks via URI, speaker handle, and title matching. Results cached in-memory per DID.

---

## 1. Architecture

### Data Flow

1. Client calls `GET /api/crawl` (authenticated)
2. Server restores session via `getSession()` → gets Agent + DID
3. Check cache: if fresh result exists for this DID (< 30 min), return it
4. Fetch ALL follows: paginated `app.bsky.graph.getFollows` → Set of follow DIDs
5. **Strategy A — Constellation backlinks**: for each talk with an `eventUri`, query Constellation's `/links/all` endpoint for RSVPs (`community.lexicon.calendar.rsvp`). Filter RSVPers to follows set. An RSVP = "this follow was aware of/interested in this talk."
6. **Strategy B — Text search**: batch `app.bsky.feed.searchPosts` queries with conference-related terms, date-filtered. Filter posts to follows set. Match posts to talks.
7. Merge results from both strategies: deduplicate by follow+talk pair
8. Aggregate: count mentions per talk, track which follows mentioned each
9. Cache result keyed by DID with 30-minute TTL
10. Return JSON response

### Dual Strategy: Why Both

- **Constellation backlinks** catch structured references (RSVPs, embeds, app records) that text search misses. RSVPs are a strong signal of awareness — someone who RSVPed to a talk's calendar event paid attention to it.
- **Text search** catches the organic discussion (hashtags, speaker mentions, title references) that Constellation doesn't index from `app.bsky.feed.post` records.
- Together they provide the most complete picture of network attention.

### Why Not Per-Follow Feeds

A user with 500 follows would require 500+ `getAuthorFeed` calls. Most follows posted zero conference content, making those calls wasted. The search + Constellation approach uses ~100 Constellation queries + ~3 search queries, which is far more efficient.

---

## 2. Constellation Backlinks (Strategy A)

### API

Public API at `https://constellation.microcosm.blue` (no auth required).

**Endpoint:** `GET /links/all?target={uri}` — returns all record types that link to the target, with counts.

**For each talk with an `eventUri`:**
1. Query `/links/all?target={eventUri}`
2. Check for `community.lexicon.calendar.rsvp` in the response
3. If present, query `GET /xrpc/blue.microcosm.links.getBacklinks?subject={eventUri}&source=community.lexicon.calendar.rsvp:.subject.uri` to get the actual RSVP records with their source DIDs
4. Filter source DIDs to the user's follows set
5. Each matching RSVP counts as a mention of that talk

**Rate limiting:** ~100 `/links/all` calls (one per talk with eventUri) + follow-up `getBacklinks` calls for talks that have RSVPs. Constellation has no known rate limits for read queries. These calls are fast (~50ms each) and can be parallelized.

**Fallback:** If Constellation is down, skip this strategy and rely solely on text search. The crawl still works — just with less complete data.

---

## 3. Text Search (Strategy B)

### Search Terms

All searches filtered to `since:2026-03-26` and `until:2026-04-06`. Paginated to get all results.

| Query | Rationale |
|-------|-----------|
| `"atmosphereconf"` | Hashtags and direct mentions (search is case-insensitive) |
| `"atmosphere conf"` | Alternate spacing |
| `"stream.place"` | Shared VOD links (may include some non-conf Streamplace posts — filtered by date + follows) |

Note: `at://` URI searches are NOT included — Bluesky search indexes post text, not embed structures. Posts sharing VODs via embeds won't have raw AT URIs in searchable text. The matcher (Section 3) handles embed-based matching on the posts found by these text searches.

Speaker-specific searches are NOT done individually (too many calls). Instead, speaker mentions are caught by the conference-term searches — a post mentioning a speaker handle without any conference context is not a conference mention.

All searches use `sort: 'latest'` for chronological completeness rather than relevance ranking.

### Pagination

Each search query is paginated (cursor-based, 100 results per page). **Caveat:** Bluesky's `searchPosts` cursor "may not necessarily allow scrolling through entire result set" and `hitsTotal` may be rounded. For a popular conference this means some posts may be missed. This is acceptable — the search approach still catches the vast majority of conference discussion, and the alternative (per-follow feed crawling) is prohibitively expensive.

Deduplicate posts by URI across queries.

---

## 4. Post-to-Talk Matching (Issue #17)

### Match Criteria

A post matches a talk if ANY of:

1. **URI match**: post text contains the talk's `vodUri` or `eventUri`
2. **Embed match**: post embeds or quotes a record whose URI matches a talk's `vodUri` or `eventUri`. Check `post.embed.record.uri`, `post.embed.external.uri`, and nested embed structures.
3. **Speaker + conference term**: post mentions a speaker's handle (from `talk.speakers[].id` — these are handle strings like `"row1.ca"`, not DIDs) AND contains a conference-related term (`atmosphereconf`, `atmosphere conf`, `atmoconf`, `stream.place`). Check both raw text for handle strings (with/without `@` prefix) and the post's `facets` array for mention facets.
4. **Title match**: post text contains ≥4 consecutive significant words from the talk title (after stripping common words like "the", "a", "and", "on", "at", "of", "for", "in", "with", "to") AND at least one conference-related term appears in the post. This double requirement prevents false positives from generic phrases.

### Match Priority

A post may match multiple talks. All matches are counted — a post saying "loved both the governance talk and the science keynote" should credit both.

### Output

```ts
interface TalkMention {
  count: number;          // total signals from follows (posts + RSVPs)
  follows: string[];      // DIDs of follows who engaged with this talk
  posts: string[];        // URIs of matching posts (from text search)
  rsvps: string[];        // DIDs of follows who RSVPed (from Constellation)
}

interface TalkMentions {
  [rkey: string]: TalkMention;
}
```

---

## 5. Caching

In-memory `Map` on `globalThis` (same pattern as OAuth client).

```ts
interface CrawlResult {
  talkMentions: TalkMentions;
  followCount: number;
  postsScanned: number;
  crawledAt: number;  // timestamp
}

interface CacheEntry {
  data: CrawlResult;
  timestamp: number;
}
```

- Key: user DID
- TTL: 30 minutes
- Cleared on server restart (acceptable for dev)

---

## 6. API Route

### `GET /api/crawl`

**Auth:** Required. Reads DID cookie, restores session.

**Query params:**
- `force=true` — bypass cache, re-crawl even if fresh result exists

**Response:**
```json
{
  "talkMentions": { "3mi2jdevvu626": { "count": 3, "follows": ["did:plc:..."], "posts": ["at://..."] } },
  "followCount": 423,
  "postsScanned": 847,
  "cached": false
}
```

**Errors:**
- 401: not authenticated
- 500: crawl failed (Bluesky API errors). Response includes `{ error: string, partial?: boolean, talkMentions?: TalkMentions }` — returns partial results if some search queries succeeded.

**Timing:** Expected < 10 seconds. Hard timeout at 30 seconds — if exceeded, returns partial results with `{ partial: true }`. Client shows a loading spinner.

**Concurrent request protection:** If a crawl is already in progress for a DID, subsequent requests await the in-flight result rather than launching a duplicate.

---

## 7. Talk Data Loading

The matcher needs the full talk list to match against. Load from `data/talks.json` at server startup (same as the talk pages). Filter to talks with `eventUri` (can't match posts to talks without schedule data).

---

## 8. File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/crawl/crawler.ts` | Create | Fetch follows, orchestrate search + Constellation, filter to network |
| `src/lib/crawl/constellation.ts` | Create | Query Constellation backlinks API for RSVPs per talk |
| `src/lib/crawl/search.ts` | Create | Text search via searchPosts, filter to follows |
| `src/lib/crawl/matcher.ts` | Create | Match posts to talks (URI, embed, speaker, title) |
| `src/lib/crawl/cache.ts` | Create | In-memory TTL cache with concurrent request protection |
| `src/lib/crawl/types.ts` | Create | Shared types for crawl module |
| `src/app/api/crawl/route.ts` | Create | GET handler orchestrating crawl → match → cache → response |

---

## 9. Rate Limiting Considerations

- `getFollows`: 100 per page, most users need 1-10 pages. No known rate limit issues.
- Constellation: ~100 `/links/all` queries (parallelized) + follow-up `getBacklinks` for talks with RSVPs. No known rate limits. ~50ms each.
- `searchPosts`: 3 search queries, each paginated. Bluesky's search API has generous limits for authenticated requests.
- Total API calls per crawl: ~5-15 (follows + search pagination) + ~100-120 (Constellation). Constellation calls are parallelized and fast.
- Cache prevents repeat crawls within 30 minutes.

---

## 10. Edge Cases

- **User with 0 follows**: return empty talkMentions immediately
- **No conference posts found**: return empty talkMentions (all talks are "undiscovered")
- **Search API returns errors**: fail gracefully, return partial results if some queries succeeded
- **Post with deleted/missing content**: skip, don't crash
- **Duplicate posts across searches**: deduplicate by post URI before matching
- **Constellation down**: skip RSVP data, rely on text search alone. Log warning.
- **Duplicate follow+talk signals**: a follow who both RSVPed and posted about a talk counts once in `follows[]` but both signals are tracked (RSVP in `rsvps[]`, post in `posts[]`)
