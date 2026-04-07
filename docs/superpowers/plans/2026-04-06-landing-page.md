# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the landing page and talks index page — the static front door to Understory.

**Architecture:** Two static pages using existing design system components. Landing page explains the product and links to a talks browse page. Talks index loads from `data/talks.json` at build time and renders a grid of LumeCards. Minor modification to Nav for a `minimal` prop.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-04-06-landing-page.md`

**Chainlink Issue:** #13

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/ui/nav.tsx` | Modify | Add `minimal` prop to hide center links on pre-auth pages |
| `src/app/page.tsx` | Rewrite | Landing page (hero, feature sections, footer) |
| `src/app/talks/page.tsx` | Create | Talks index — grid of LumeCards linking to `/talk/[rkey]` |

---

### Task 1: Add `minimal` prop to Nav

**Files:**
- Modify: `src/components/ui/nav.tsx`

- [ ] **Step 1: Read current Nav component**

Read `src/components/ui/nav.tsx`.

- [ ] **Step 2: Add `minimal` prop**

Update the component to accept an optional `minimal` boolean prop. When true, hide the center links (Feed, Map).

```tsx
import Link from "next/link";

interface NavProps {
  minimal?: boolean;
}

function Nav({ minimal = false }: NavProps) {
  return (
    <nav className="fixed top-0 z-50 w-full misty-glass">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="font-headline text-xl italic text-on-surface">
          Understory
        </Link>

        {!minimal && (
          <div className="hidden items-center gap-8 md:flex">
            <Link
              href="/for/me"
              className="text-body-md text-on-surface-variant transition-colors hover:text-on-surface"
            >
              Feed
            </Link>
            <Link
              href="/map/me"
              className="text-body-md text-on-surface-variant transition-colors hover:text-on-surface"
            >
              Map
            </Link>
          </div>
        )}

        <div className="flex items-center gap-4">
          <span className="text-label-md text-on-surface-variant">
            Sign in with your Atmosphere Account
          </span>
        </div>
      </div>
    </nav>
  );
}

export { Nav, type NavProps };
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/nav.tsx
git commit -m "feat: add minimal prop to Nav for pre-auth pages"
```

---

### Task 2: Landing page

**Files:**
- Rewrite: `src/app/page.tsx`

- [ ] **Step 1: Replace the design system showcase with the landing page**

```tsx
import Link from "next/link";
import { Nav } from "@/components/ui/nav";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <>
      <Nav minimal />
      <main>
        {/* Hero */}
        <section className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <h1 className="text-display-lg text-on-surface mb-6 max-w-3xl">
            What your{" "}
            <span className="text-primary-fixed">timeline</span> missed.
          </h1>
          <p className="text-body-lg text-on-surface-variant mb-10 max-w-xl">
            Your network already surfaced the popular talks. Understory finds
            the ones they didn&apos;t.
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <Button variant="primary" disabled>
              Get started
            </Button>
            <Link
              href="/talks"
              className="text-body-md text-primary-fixed-dim transition-colors hover:text-primary-fixed"
            >
              Browse talks →
            </Link>
          </div>
        </section>

        {/* Feature sections */}
        <section className="bg-surface-container-low py-24">
          <div className="mx-auto max-w-3xl space-y-16 px-6">
            <div>
              <h2 className="text-headline-sm text-on-surface mb-3">
                Quiet Discovery
              </h2>
              <p className="text-body-md text-on-surface-variant">
                We crawl your network&apos;s conference posts and invert the
                signal. The talks nobody mentioned? Those glow brightest.
              </p>
            </div>

            <div>
              <h2 className="text-headline-sm text-on-surface mb-3">
                Tuned to You
              </h2>
              <p className="text-body-md text-on-surface-variant">
                Your posting history meets talk transcripts. Understory finds
                talks that match your interests but slipped past your feed.
              </p>
            </div>

            <div>
              <h2 className="text-headline-sm text-on-surface mb-3">
                Friend Signal
              </h2>
              <p className="text-body-md text-on-surface-variant">
                Your friends can recommend talks directly. Human curation, not
                engagement metrics.
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-surface-container-lowest py-8 px-6">
          <div className="mx-auto max-w-3xl flex flex-col items-center gap-2 text-center">
            <p className="text-label-md text-on-surface-variant">
              Built for the Streamplace VOD JAM
            </p>
            <div className="flex gap-4">
              <a
                href="https://atmosphereconf.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-label-sm text-outline transition-colors hover:text-on-surface-variant"
              >
                ATmosphereConf
              </a>
              <a
                href="https://github.com/musicjunkieg/understory"
                target="_blank"
                rel="noopener noreferrer"
                className="text-label-sm text-outline transition-colors hover:text-on-surface-variant"
              >
                GitHub
              </a>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Visual check**

Run: `npm run dev`
Open: http://localhost:3000

Verify:
- Full-height hero with tagline, "timeline" in green
- "Get started" button (disabled state)
- "Browse talks →" link
- Three feature sections on darker background
- Footer with external links
- Nav shows only wordmark + sign-in text (no Feed/Map links)

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add landing page with hero, features, and footer"
```

---

### Task 3: Talks index page

**Files:**
- Create: `src/app/talks/page.tsx`

- [ ] **Step 1: Create the talks directory**

Run: `mkdir -p src/app/talks`

- [ ] **Step 2: Write the talks index page**

```tsx
import * as fs from "fs";
import * as path from "path";
import Link from "next/link";
import { Nav } from "@/components/ui/nav";
import { Chip } from "@/components/ui/chip";
import { LumeCard } from "@/components/ui/lume-card";
import { formatDuration } from "@/lib/format";
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

export default function TalksPage() {
  const talks = loadTalks()
    .filter((t) => t.transcriptFile)
    .sort((a, b) => {
      if (a.startsAt && b.startsAt) return a.startsAt.localeCompare(b.startsAt);
      if (a.startsAt) return -1;
      if (b.startsAt) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });

  return (
    <>
      <Nav minimal />
      <main className="mx-auto max-w-7xl px-6 pt-24 pb-16">
        <header className="mb-8">
          <h1 className="text-headline-md text-on-surface mb-2">All Talks</h1>
          <p className="text-label-md text-on-surface-variant">
            {talks.length} talks with transcripts
          </p>
        </header>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {talks.map((talk) => (
            <Link key={talk.rkey} href={`/talk/${talk.rkey}`}>
              <LumeCard className="h-full">
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
      </main>
    </>
  );
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: Build succeeds with `/talks` route.

- [ ] **Step 4: Visual check**

Run: `npm run dev`
Open: http://localhost:3000/talks

Verify:
- Header shows "All Talks" with correct count
- Grid of LumeCards, 3 columns on desktop
- Each card shows speakers, title, room/duration chips
- Clicking a card navigates to `/talk/[rkey]`
- Cards sorted by schedule time

- [ ] **Step 5: Commit**

```bash
git add src/app/talks/page.tsx
git commit -m "feat: add talks index page with browse grid"
```

---

### Task 4: Lint and build verification

- [ ] **Step 1: Run eslint**

Run: `npx eslint src/`
Fix any issues.

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: All pages build successfully.

- [ ] **Step 3: Commit fixes if any**

```bash
git add src/
git commit -m "fix: resolve lint issues in landing and talks pages"
```
