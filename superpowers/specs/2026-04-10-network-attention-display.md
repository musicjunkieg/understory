# Network Attention Display Spec

**Date:** 2026-04-10
**Issue:** Chainlink #10
**Status:** Approved (pending review)
**Depends on:** PR #9 (scoring algorithm — merged), PR #11 (Railway deploy — merged)
**Unblocks:** #25/#26 (coverage map), #20 (slider UI), talk page scoring (future follow-up)

---

## 1. Goal

Wire the scoring engine into the `/talks` grid so authenticated users see bioluminescent glow on talks their network missed. Hover/tap reveals score details ("97% of your network missed this"). Unauthenticated users see the grid without glow, unchanged from today.

---

## 2. Background

The scoring engine (`src/lib/scoring/`) is fully implemented with 40 unit tests. It takes `TalkMentions` from the crawler and produces `TalkScore[]` with a 0–1 `intensity` value, a three-state classifier (`engaged | missed | unknown`), and a `layer1` object with the raw counts.

The `/talks` page currently renders a grid of `LumeCard` components with `glowIntensity={0}` (hardcoded). `LumeCard` already supports `glowIntensity` (maps to CSS glow classes and breathing animation), `tileIndex` (staggers breathing), and `interestMatch` (blue dot for Layer 2, not used yet).

The missing piece: a client-side hook that fetches `/api/crawl`, pipes the result through `rankTalks`, and passes scores to the cards.

---

## 3. New Files

### 3.1 `src/hooks/useCrawlData.ts` — crawl data fetcher

A React hook that:
1. Calls `GET /api/crawl` on mount
2. Returns `{ mentions: TalkMentions | null, followCount: number, loading: boolean, error: string | null }`
3. Only fetches if the user is authenticated (check is implicit — `/api/crawl` returns 401 if not, which the hook treats as "no data")
4. Caches the result for the component lifecycle (no re-fetch on re-render)

```ts
import { useState, useEffect } from "react";
import type { TalkMentions } from "@/lib/scoring";

interface CrawlData {
  mentions: TalkMentions | null;
  followCount: number;
  loading: boolean;
  error: string | null;
}

export function useCrawlData(): CrawlData {
  const [data, setData] = useState<CrawlData>({
    mentions: null,
    followCount: 0,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchCrawl() {
      try {
        const res = await fetch("/api/crawl");
        if (!res.ok) {
          // 401 = not authenticated — not an error, just no data
          setData({ mentions: null, followCount: 0, loading: false, error: null });
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          setData({
            mentions: json.talkMentions,
            followCount: json.followCount,
            loading: false,
            error: null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setData({
            mentions: null,
            followCount: 0,
            loading: false,
            error: err instanceof Error ? err.message : "Crawl failed",
          });
        }
      }
    }

    fetchCrawl();
    return () => { cancelled = true; };
  }, []);

  return data;
}
```

The `cancelled` flag prevents state updates after unmount. The hook doesn't retry on failure — the crawl endpoint already has its own caching and timeout logic.

### 3.2 `src/components/scored-talks-grid.tsx` — scored grid wrapper

A `"use client"` component that:
1. Receives `talks: TalkEntry[]` from the server component
2. Calls `useCrawlData()` to get crawl results
3. When data arrives, calls `rankTalks({ talks, mentions, followCount })` to produce scored + sorted talks
4. Renders a `LumeCard` for each talk, passing `glowIntensity={score.intensity}`, `tileIndex`, and the `score` prop for the hover detail
5. When no crawl data: renders talks in original order with `glowIntensity={0}`

```tsx
"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useCrawlData } from "@/hooks/useCrawlData";
import { rankTalks, type TalkScore } from "@/lib/scoring";
import { LumeCard } from "@/components/ui/lume-card";
import { formatDuration } from "@/lib/format";
import type { TalkEntry } from "@/lib/types";

interface ScoredTalksGridProps {
  talks: TalkEntry[];
}

export function ScoredTalksGrid({ talks }: ScoredTalksGridProps) {
  const { mentions, followCount, loading } = useCrawlData();

  const scoredTalks: { talk: TalkEntry; score: TalkScore | null }[] = useMemo(() => {
    if (!mentions) {
      // Not authenticated or crawl not loaded — render unsorted, no scores
      return talks.map((talk) => ({ talk, score: null }));
    }
    const scores = rankTalks({ talks, mentions, followCount });
    // Match scores back to talks by rkey
    return scores.map((score) => ({
      talk: talks.find((t) => t.rkey === score.rkey)!,
      score,
    }));
  }, [talks, mentions, followCount]);

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {scoredTalks.map(({ talk, score }, index) => (
        <Link key={talk.rkey} href={`/talk/${talk.rkey}`}>
          <LumeCard
            className="h-full"
            glowIntensity={score?.intensity ?? 0}
            tileIndex={index}
            score={score}
          >
            {/* Card content: speakers, title, room chip, duration chip.
                Copy the existing JSX from talks/page.tsx (the <div className="p-5">
                block with speakers, h2 title, and metadata chips). */}
          </LumeCard>
        </Link>
      ))}
    </div>
  );
}
```

The `useMemo` ensures `rankTalks` only re-runs when the inputs change (not on every render). The `loading` state is available but not used for a spinner — the grid renders immediately and glow appears when data arrives.

---

## 4. Modified Files

### 4.1 `src/app/talks/page.tsx` — use `ScoredTalksGrid`

Replace the inline `<div className="grid ...">` that maps over talks with:

```tsx
<ScoredTalksGrid talks={talks} />
```

The server component still loads `data/talks.json`, filters by `transcriptFile`, and sorts by `startsAt`. It passes the full talks array to the client component, which re-sorts by score when crawl data arrives.

The `getAuthUser()` call at the top of the page (for the Nav) is unchanged — it's a server-side call that doesn't affect the scoring flow.

### 4.2 `src/components/ui/lume-card.tsx` — add hover/tap score detail

Add an optional `score: TalkScore | null` prop. When present and the card is hovered (desktop) or tapped (mobile), render a detail strip at the bottom of the card.

**Detail strip content by state:**

| `score.state` | Text | Color |
|---|---|---|
| `"missed"` | `"Your network missed this"` | `text-primary-fixed` (mint) |
| `"engaged"` | `"{X}% of your network missed this"` | `text-on-surface-variant` (muted) |
| `"unknown"` | (no detail strip) | — |
| `null` | (no detail strip) | — |

Where:
- `X` = `Math.round(score.layer1.attentionInverse * 100)` — e.g., 83

**Why no percentage for "missed":** The `missed` state means `uniqueFollows === 0`, so `attentionInverse` is always exactly `1.0` — the percentage would always read "100%". A static message is clearer and avoids pointless math. For `engaged` talks, the percentage IS meaningful: "83% of your network missed this" conveys the gradient between "almost nobody talked about it" and "most of your follows discussed it."

**Interaction:**
- Desktop (`sm:` and above): detail is hidden by default, revealed on `:hover` via CSS transition (`max-height` + `opacity`). Uses Tailwind `group`/`group-hover:` — no JavaScript state needed.
- Mobile (below `sm:`): detail is always visible when `score` is present (since there's no hover). Acceptable because mobile cards are full-width and the detail text is small.

**Implementation note:** The detail strip uses flow-based expansion (`max-h-0`/`max-h-12` + `overflow-hidden`) rather than absolute positioning. This avoids layout complexity and works naturally with the card's existing padding. The `transition-all duration-300` on `sm:` breakpoint smoothly animates the reveal on desktop hover.

---

## 5. Data Flow

```
Server: talks/page.tsx
  → reads data/talks.json
  → filters + sorts by startsAt
  → renders <Nav user={authUser} />
  → renders <ScoredTalksGrid talks={talks} />

Client: ScoredTalksGrid mounts
  → useCrawlData() fires fetch("/api/crawl")
  → 401 (not auth) → mentions=null → grid renders with no glow
  → 200 (auth) → { talkMentions, followCount } → rankTalks() → TalkScore[]
  → grid re-renders with glow intensities + re-sorted by score
  → each LumeCard receives intensity + score for hover detail
```

---

## 6. Loading Behavior

**Phase 1 (immediate, server-rendered):** Talk grid appears with all cards at `glowIntensity=0`. Page is fully interactive. If not authenticated, this is the final state.

**Phase 2 (~2-5s after mount, client-side):** Crawl data arrives. Cards animate to their scored glow intensities. Grid re-sorts to put missed talks first. The visual effect is the "forest waking up" — cards that your network missed light up with bioluminescent glow.

No loading spinners, no skeleton screens, no loading text. The transition IS the feedback. The existing `LumeCard` glow CSS already uses transitions, so the intensity change animates smoothly.

**If crawl fails:** Grid stays in Phase 1 (no glow, original sort). The error is logged to console but not shown to the user — the page is still fully functional for browsing talks.

---

## 7. Sort Behavior

| State | Sort Order |
|---|---|
| Not authenticated | Original: by `startsAt` date (server-side) |
| Authenticated, crawl loading | Original: by `startsAt` date |
| Authenticated, crawl loaded | By score: `missed` first (intensity desc) → `engaged` (intensity desc) → `unknown` (rkey asc) |

The re-sort happens when crawl data arrives. Cards shift positions as glow appears. If this transition feels jarring, a CSS `transition` on grid item `order` can smooth it — but this is a polish item, not a blocker.

---

## 8. Edge Cases

- **Not authenticated:** Grid renders without scores. The hook fires `fetch("/api/crawl")` which returns 401; the hook treats this as "no data" and sets `mentions=null`. Same visual as today.
- **Zero follows:** `/api/crawl` returns `followCount: 0`. `rankTalks` produces all `unknown` states. Grid renders without glow. Acceptable — the user needs follows for the scoring to be meaningful.
- **Crawl timeout (30s):** `/api/crawl` returns 504. Hook receives error. Grid stays in Phase 1.
- **Partial crawl data:** Some talks have mentions, some don't (out-of-scope talks). `rankTalks` classifies absent talks as `unknown`. They sort to the bottom.
- **Empty talks array:** Grid renders empty (same as today).

---

## 9. Non-goals

- **Sliders** (#20) — scoring weights are fixed at `DEFAULT_WEIGHTS` for this issue
- **Coverage map** (#25, #26) — separate visualization, different layout
- **Talk page scoring** — deferred to a follow-up (option C: "who discussed this" with profile resolution)
- **Interest match badges** — Layer 2 not live
- **Friend recommendation badges** — Layer 3 not live
- **Grid re-sort animation** — polish follow-up if the abrupt re-sort feels jarring
- **Error UI for crawl failure** — the page works without scores; no user-visible error needed

---

## 10. Acceptance Criteria

- [ ] `src/hooks/useCrawlData.ts` exists and exports `useCrawlData`
- [ ] `src/components/scored-talks-grid.tsx` exists as a `"use client"` component
- [ ] `/talks` page uses `ScoredTalksGrid` instead of inline grid
- [ ] Authenticated users see glow on missed talks after crawl data loads
- [ ] Hover (desktop) or tap (mobile) shows score detail: "X% of your network missed this" or "Discussed by N of T follows"
- [ ] Unauthenticated users see the grid without glow (same as today)
- [ ] Grid re-sorts by score when authenticated + crawl loaded
- [ ] `LumeCard` accepts `score: TalkScore | null` prop for the detail strip
- [ ] `npx tsc --noEmit` clean
- [ ] `npx eslint src/` clean
- [ ] `npm test` passes (existing 40 scoring tests)
- [ ] `npm run build` succeeds
- [ ] Manual test on staging: log in, see glow appear, hover for detail
