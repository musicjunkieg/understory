# Landing Page Spec

**Date:** 2026-04-06
**Issue:** Chainlink #13
**Status:** Approved

---

## Overview

The landing page (`/`) is the first thing users see. It explains what Understory does, provides a placeholder sign-in CTA, and links to a talk browse page. Pre-auth only — post-auth redirect added when OAuth ships (#15).

---

## 1. Landing Page (`/`)

### Structure

1. **Nav** — existing `Nav` component, but the center links ("Feed", "Map") are hidden on the landing page since those routes require auth. Only the wordmark and sign-in text remain. Implement by adding an optional `minimal` prop to `Nav` that hides the center links.
2. **Hero** — full viewport height, vertically centered
   - Tagline: `display-lg` (Newsreader) — "What your timeline missed." with "timeline" wrapped in `<span className="text-primary-fixed">` for color emphasis (not bold or italic)
   - Subtitle: `body-lg`, `on-surface-variant` — "Your network already surfaced the popular talks. Understory finds the ones they didn't."
   - CTA: Primary `Button` — "Get started" (placeholder, no action yet). The Nav already shows "Sign in with your Atmosphere Account" — no need to duplicate that text.
   - Secondary: text link — "Browse talks →" (using `→` character) linking to `/talks`
   - Fog gradient background (`bg-understory`) provides the atmospheric feel
3. **Feature sections** — below the fold, three sections explaining the scoring layers
   - **Quiet Discovery**: explains network attention inversion — "We crawl your network's conference posts and invert the signal. The talks nobody mentioned? Those glow brightest."
   - **Tuned to You**: explains interest matching — "Your posting history meets talk transcripts. Understory finds talks that match your interests but slipped past your feed."
   - **Friend Signal**: explains friend recommendations — "Your friends can recommend talks directly. Human curation, not engagement metrics."
   - Each section: `headline-sm` title in Newsreader, `body-md` description in Work Sans, `on-surface-variant` text. Laid out with generous whitespace (48px between sections). All three sections on `surface-container-low` background to distinguish from the hero's `bg-understory` fog gradient above.
4. **Footer** — minimal
   - "Built for the Streamplace VOD JAM" in `label-md`
   - Links: "ATmosphereConf" (external), "GitHub" (external, placeholder)
   - `surface-container-lowest` background

### Responsive

- Hero tagline scales down to `text-3xl` on mobile
- Feature sections stack vertically (already vertical)
- Footer is single-column on all sizes

---

## 2. Talks Index Page (`/talks`)

**Route:** `/talks` — statically generated.

### Structure

1. **Nav** — existing component
2. **Header** — "All Talks" in `headline-md`, with talk count in `label-md`
3. **Grid** — Lume-Cards for each talk with a transcript, linking to `/talk/[rkey]`
   - 3 columns on desktop, 2 on tablet, 1 on mobile
   - Each card shows: title (`headline-sm`), speakers (`label-md`), room + duration chips
   - Cards use `glowIntensity={0}` (no scoring data yet — all equal). No `aria-label` for score since scoring is not available pre-auth.
   - Sorted by schedule time (`startsAt`). Talks without `startsAt` are sorted to the end by `createdAt`.
4. **Talks without transcripts** — excluded from the grid (they have no useful page to link to)

### Data Loading

- Reads `data/talks.json` at build time
- Filters to talks with `transcriptFile !== null`
- No client-side state needed — fully static

---

## 3. Implementation Notes

- Replace current `src/app/page.tsx` (design system showcase) with the landing page
- Create `src/app/talks/page.tsx` for the talks index
- Add `minimal` prop to existing `Nav` component (hides center links for pre-auth pages)
- Uses existing `Button`, `Chip`, `LumeCard`
- Both pages are static (no `"use client"`)
- Talk page route (`/talk/[rkey]`) already exists — card links are functional
