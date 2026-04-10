# Network Attention Display Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the scoring engine into the `/talks` grid so authenticated users see bioluminescent glow on missed talks, with hover/tap detail showing the score.

**Architecture:** Server component loads talks from disk (unchanged). New client component (`ScoredTalksGrid`) fetches `/api/crawl` via a `useCrawlData` hook, runs `rankTalks`, and passes scores to `LumeCard`. `LumeCard` gains a `score` prop for hover/tap detail strips. Unauthenticated users see the grid without glow.

**Tech Stack:** Next.js 16 (App Router, React 19), existing scoring module (`@/lib/scoring`), existing bioluminescent design system (Tailwind v4 CSS-first theme)

**Spec:** `docs/superpowers/specs/2026-04-10-network-attention-display.md`

**Chainlink Issue:** #10

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/hooks/useCrawlData.ts` | Create | React hook: fetches `/api/crawl`, returns `{ mentions, followCount, loading, error }` |
| `src/components/scored-talks-grid.tsx` | Create | Client component: calls `useCrawlData` + `rankTalks`, renders scored `LumeCard` grid with card content |
| `src/components/ui/lume-card.tsx` | Modify | Add optional `score: TalkScore | null` prop for hover/tap detail strip |
| `src/app/talks/page.tsx` | Modify | Replace inline grid with `<ScoredTalksGrid talks={talks} />` |

---

## Chunk 1: Hook + LumeCard enhancement

### Task 1: Create `useCrawlData` hook

**Files:**
- Create: `src/hooks/useCrawlData.ts`

- [ ] **Step 1: Create the hooks directory**

Run: `mkdir -p src/hooks`

- [ ] **Step 2: Write the hook**

Create `src/hooks/useCrawlData.ts`:

```ts
"use client";

import { useState, useEffect } from "react";
import type { TalkMentions } from "@/lib/scoring";

export interface CrawlData {
  mentions: TalkMentions | null;
  followCount: number;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches crawl data from `/api/crawl` on mount.
 *
 * - If authenticated: returns `{ mentions, followCount }` from the crawler.
 * - If not authenticated (401): returns `mentions: null` — not an error.
 * - If the crawl fails or times out: returns `error` string.
 *
 * The hook fires one fetch on mount and does not retry. The crawl endpoint
 * has its own caching (30-minute TTL) and concurrent-request coalescing.
 */
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
          // 401 = not authenticated, 504 = timeout — treat as "no data"
          if (!cancelled) {
            setData({
              mentions: null,
              followCount: 0,
              loading: false,
              error: null,
            });
          }
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
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
```

- [ ] **Step 3: Verify tsc is clean**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useCrawlData.ts
git commit -m "feat: add useCrawlData hook for fetching crawl results"
```

---

### Task 2: Add score detail strip to `LumeCard`

**Files:**
- Modify: `src/components/ui/lume-card.tsx`

- [ ] **Step 1: Read the current `LumeCard`**

Read `src/components/ui/lume-card.tsx` and confirm the current interface:
- Props: `glowIntensity`, `tileIndex`, `interestMatch`, plus `HTMLAttributes<HTMLDivElement>`
- No `score` prop exists yet

- [ ] **Step 2: Add the `score` prop and detail strip**

Replace the entire file with:

```tsx
import { type HTMLAttributes } from "react";
import type { TalkScore } from "@/lib/scoring";

interface LumeCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Understory score 0-1. Higher = more undiscovered = brighter glow. */
  glowIntensity?: number;
  /** Index for staggered breathing animation. */
  tileIndex?: number;
  /** Whether to show the interest match indicator. */
  interestMatch?: boolean;
  /** Score data for hover/tap detail strip. null = no detail. */
  score?: TalkScore | null;
}

function glowStyle(intensity: number): string {
  if (intensity > 0.7) return "biolume-glow-strong";
  if (intensity > 0.3) return "biolume-glow";
  return "";
}

function ScoreDetail({ score }: { score: TalkScore }) {
  if (score.state === "unknown") return null;

  if (score.state === "missed") {
    return (
      <div className="text-label-sm text-primary-fixed">
        Your network missed this
      </div>
    );
  }

  // engaged — show percentage
  const pct = Math.round(score.layer1.attentionInverse * 100);
  return (
    <div className="text-label-sm text-on-surface-variant">
      {pct}% of your network missed this
    </div>
  );
}

function LumeCard({
  glowIntensity = 0,
  tileIndex,
  interestMatch = false,
  score,
  className = "",
  children,
  ...props
}: LumeCardProps) {
  const isUnderstory = glowIntensity > 0.3;
  const hasDetail = score && score.state !== "unknown";

  return (
    <div
      className={[
        "group relative rounded-lg",
        "bg-surface-container-low/60 backdrop-blur-[20px]",
        "border-t-2",
        glowIntensity > 0.3
          ? "border-primary-fixed-dim"
          : glowIntensity > 0
            ? "border-primary-fixed-dim/50"
            : "border-primary-fixed-dim/20",
        "transition-all duration-500",
        "hover:biolume-glow-strong",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-fixed",
        glowStyle(glowIntensity),
        isUnderstory ? "animate-breathe" : "",
        className,
      ].join(" ")}
      style={
        tileIndex !== undefined
          ? ({ "--tile-index": tileIndex } as React.CSSProperties)
          : undefined
      }
      {...props}
    >
      {interestMatch && (
        <span
          className="absolute top-3 right-3 h-2.5 w-2.5 rounded-full bg-interest-match"
          aria-label="Matches your interests"
        />
      )}
      {children}

      {hasDetail && (
        <div
          className={[
            "px-5 pb-3 pt-0",
            // Mobile: always visible (no hover capability)
            "max-h-12 opacity-100",
            // Desktop (sm+): hidden by default, revealed on hover via group-hover
            "sm:max-h-0 sm:overflow-hidden sm:opacity-0",
            "sm:transition-all sm:duration-300",
            "sm:group-hover:max-h-12 sm:group-hover:opacity-100",
          ].join(" ")}
        >
          <div className="border-t border-primary-fixed-dim/20 pt-2">
            <ScoreDetail score={score} />
          </div>
        </div>
      )}
    </div>
  );
}

export { LumeCard, type LumeCardProps };
```

**Key changes from the original:**
- Added `score?: TalkScore | null` prop
- Added `ScoreDetail` component (renders "Your network missed this" or "X% of your network missed this")
- Added detail strip: **always visible on mobile** (where there's no hover), **hidden → revealed on hover on desktop** (`sm:group-hover:`). No JavaScript state needed — pure CSS.
- Changed `transition-shadow` to `transition-all duration-500` for smoother glow transitions
- Added `group` class for group-hover targeting
- Border top opacity now varies with glow intensity for more visual gradient
- No `"use client"` needed — no `useState`, no event handlers. The component is rendered inside the client `ScoredTalksGrid` but doesn't need its own client boundary.

- [ ] **Step 3: Verify tsc and eslint are clean**

Run in parallel:
- `npx tsc --noEmit` — Expected: clean
- `npx eslint src/` — Expected: clean

> **Note:** If eslint flags the `useState` import or the `"use client"` directive, ensure the file starts with `"use client";` on its own line (React 19 / Next.js 16 requirement for client components).

- [ ] **Step 4: Verify existing tests still pass**

Run: `npm test`
Expected: 40/40 pass (scoring tests are unrelated but confirms nothing broke).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/lume-card.tsx
git commit -m "feat: add score detail strip to LumeCard (hover/tap)

Shows 'Your network missed this' (mint) for missed talks and
'X% of your network missed this' (muted) for engaged talks.
Detail strip revealed on hover (desktop) or tap (mobile).
Border-top opacity now varies with glow intensity."
```

---

## Chunk 2: Scored grid + page integration

### Task 3: Create `ScoredTalksGrid` client component

**Files:**
- Create: `src/components/scored-talks-grid.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/scored-talks-grid.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useCrawlData } from "@/hooks/useCrawlData";
import { rankTalks, type TalkScore } from "@/lib/scoring";
import { LumeCard } from "@/components/ui/lume-card";
import { Chip } from "@/components/ui/chip";
import { formatDuration } from "@/lib/format";
import type { TalkEntry } from "@/lib/types";

interface ScoredTalksGridProps {
  talks: TalkEntry[];
}

export function ScoredTalksGrid({ talks }: ScoredTalksGridProps) {
  const { mentions, followCount } = useCrawlData();

  const scoredTalks: { talk: TalkEntry; score: TalkScore | null }[] =
    useMemo(() => {
      if (!mentions) {
        // Not authenticated or crawl not loaded — unsorted, no scores
        return talks.map((talk) => ({ talk, score: null }));
      }
      const scores = rankTalks({ talks, mentions, followCount });
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
            <div className="p-5">
              {talk.speakers.length > 0 && (
                <p className="text-label-md text-primary-fixed-dim mb-2">
                  {talk.speakers.map((s) => s.name).join(", ")}
                </p>
              )}
              <h2 className="text-headline-sm text-on-surface mb-3">
                {talk.title}
              </h2>
              <div className="flex flex-wrap gap-2">
                {talk.room && <Chip>{talk.room}</Chip>}
                <Chip>{formatDuration(talk.durationMs)}</Chip>
              </div>
            </div>
          </LumeCard>
        </Link>
      ))}
    </div>
  );
}
```

The card content JSX is copied verbatim from the current `talks/page.tsx` (lines 50–64). The `useMemo` ensures `rankTalks` only re-runs when inputs change.

- [ ] **Step 2: Verify tsc and eslint**

Run in parallel:
- `npx tsc --noEmit` — Expected: clean
- `npx eslint src/` — Expected: clean

- [ ] **Step 3: Commit**

```bash
git add src/components/scored-talks-grid.tsx
git commit -m "feat: add ScoredTalksGrid client component

Fetches crawl data via useCrawlData hook, runs rankTalks to score
and sort talks, renders LumeCard grid with glow intensities and
score detail. Falls back to unsorted grid with no glow when
unauthenticated."
```

---

### Task 4: Wire `ScoredTalksGrid` into the talks page

**Files:**
- Modify: `src/app/talks/page.tsx`

- [ ] **Step 1: Read the current page**

Read `src/app/talks/page.tsx` and confirm the current structure (server component that loads talks and renders the grid inline).

- [ ] **Step 2: Replace the inline grid with `ScoredTalksGrid`**

Replace the entire file with:

```tsx
import * as fs from "fs";
import * as path from "path";
import { Nav } from "@/components/ui/nav";
import { ScoredTalksGrid } from "@/components/scored-talks-grid";
import { getAuthUser } from "@/lib/auth/user";
import type { TalkEntry } from "@/lib/types";

const DATA_DIR = path.resolve(process.cwd(), "data");

function loadTalks(): TalkEntry[] {
  const raw = fs.readFileSync(path.join(DATA_DIR, "talks.json"), "utf-8");
  return JSON.parse(raw);
}

export const metadata = {
  title: "All Talks — Understory",
  description: "Browse all ATmosphereConf 2026 talks with transcripts.",
};

export default async function TalksPage() {
  const user = await getAuthUser();
  const talks = loadTalks()
    .filter((t) => t.transcriptFile)
    .sort((a, b) => {
      if (a.startsAt && b.startsAt)
        return a.startsAt.localeCompare(b.startsAt);
      if (a.startsAt) return -1;
      if (b.startsAt) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });

  return (
    <>
      <Nav minimal user={user} />
      <main className="mx-auto max-w-7xl px-6 pt-24 pb-16">
        <header className="mb-8">
          <h1 className="text-headline-md text-on-surface mb-2">All Talks</h1>
          <p className="text-label-md text-on-surface-variant">
            {talks.length} talks with transcripts
          </p>
        </header>

        <ScoredTalksGrid talks={talks} />
      </main>
    </>
  );
}
```

**Changes from the original:**
- Removed imports: `Link`, `Chip`, `LumeCard`, `formatDuration` (now used inside `ScoredTalksGrid`)
- Added import: `ScoredTalksGrid`
- Replaced the `<div className="grid ...">` block (lines 46–67) with `<ScoredTalksGrid talks={talks} />`
- The server component still does: load talks → filter by transcriptFile → sort by startsAt. The client component handles scoring + re-sorting.

- [ ] **Step 3: Verify tsc, eslint, and tests**

Run in parallel:
- `npx tsc --noEmit` — Expected: clean
- `npx eslint src/` — Expected: clean
- `npm test` — Expected: 40/40 pass

- [ ] **Step 4: Run a production build**

Run: `npm run build`

Expected:
- Build succeeds
- Route list unchanged (same routes as before)
- No new warnings

- [ ] **Step 5: Test locally with the dev server**

Start the dev server: `npm run dev`

**Unauthenticated test:**
1. Open `http://127.0.0.1:3000/talks` in an incognito window
2. Expected: talk grid loads immediately, no glow on any card, same sort as before
3. Hover over a card: no detail strip (no score data)

**Authenticated test (if possible locally):**
1. Open `http://127.0.0.1:3000/talks` while logged in
2. Expected: talk grid loads immediately without glow
3. After ~2-5 seconds: glow appears on missed talks, grid re-sorts by score
4. Hover over a glowing card: detail strip shows "Your network missed this" (mint)
5. Hover over a dimmer card: detail strip shows "X% of your network missed this" (muted)

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/app/talks/page.tsx
git commit -m "feat: wire ScoredTalksGrid into /talks page

Server component loads talks and passes to client component.
Scoring + glow + hover detail are progressive enhancement —
unauthenticated users see the same grid as before."
```

---

## Chunk 3: Final verification

### Task 5: Verify everything and wrap up

- [ ] **Step 1: Run all checks**

Run in parallel:
- `npm test` — Expected: 40/40 pass
- `npx tsc --noEmit` — Expected: clean
- `npx eslint src/` — Expected: clean
- `npm run build` — Expected: succeeds

- [ ] **Step 2: Verify file inventory**

The feature branch should have 4 changed/new files:

```
src/hooks/useCrawlData.ts           (new)
src/components/scored-talks-grid.tsx (new)
src/components/ui/lume-card.tsx      (modified)
src/app/talks/page.tsx               (modified)
```

Run: `git diff --stat main` to confirm.

- [ ] **Step 3: Use the finishing-a-development-branch skill**

Invoke `superpowers:finishing-a-development-branch` to present merge/PR options and execute the chosen workflow. The work should be pushed to `staging` first for Railway validation, then promoted to `main` via PR.
