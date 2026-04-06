# Bioluminescent Design System Spec

**Date:** 2026-04-06
**Issue:** Chainlink #14
**Status:** Approved

---

## Overview

The design system for Understory implements the "Illuminated Specimen" aesthetic — a bioluminescent forest floor at night. Elements emerge from atmospheric depth through tonal layering and soft glow effects. The system is built for Tailwind CSS v4 with custom theme tokens, targeting Next.js 16 with App Router.

Visual reference: Stitch mockups in `docs/stitch/` (landing, talk page, coverage map). These define the aesthetic; the actual page structure follows the Understory design spec in `docs/understory-design.md`.

---

## 1. Color System

### Foundation (Surface Tonal Scale)

Depth is expressed through a tonal scale of mossy charcoal greens. The base is never true black.

| Token | Hex | Role |
|-------|-----|------|
| `surface` | `#101411` | Page background |
| `surface-container-lowest` | `#0b0f0c` | Deepest recessed areas |
| `surface-container-low` | `#191d1a` | Card backgrounds, secondary panels |
| `surface-container` | `#1d211d` | Default containers |
| `surface-container-high` | `#272b28` | Elevated interactive modules |
| `surface-container-highest` | `#323632` | Inputs, popovers, modals |
| `surface-bright` | `#363a37` | Brightest surface (rare) |
| `surface-tint` | `#4bdf97` | Fog gradients at 5-10% opacity |

### Text

| Token | Hex | Role |
|-------|-----|------|
| `on-surface` | `#e0e3de` | Primary text (never pure white) |
| `on-surface-variant` | `#bbcabe` | Secondary/body text |
| `outline` | `#869489` | Subtle UI elements |
| `outline-variant` | `#3c4a40` | Ghost borders (at 15% opacity) |

### Primary (Bioluminescent Mint)

| Token | Hex | Role |
|-------|-----|------|
| `primary-fixed` | `#6cfcb2` | Glow, CTAs, active states |
| `primary-fixed-dim` | `#4bdf97` | Dimmed glow, top-edge accents |
| `on-primary` | `#003920` | Text on primary surfaces |
| `on-primary-container` | `#007347` | Text on primary containers |
| `primary-container` | `#6cfcb2` | Primary container fill |

### Glow Spectrum (Coverage Map)

Maps network attention to visual intensity. Cold = undiscovered = glows. Hot = covered = fades.

| Token | Hex | Role |
|-------|-----|------|
| `glow-bright` | `#6cfcb2` | Maximum understory — glows |
| `glow-medium` | `#3d9970` | Moderate understory |
| `glow-dim` | `#1a4d3a` | Partially covered |
| `covered-muted` | `#2a3530` | Fully covered — fades into background |

### Accents

| Token | Hex | Role |
|-------|-----|------|
| `tertiary-fixed` | `#ffdf90` | Friend recommendations — warm amber |
| `tertiary-fixed-dim` | `#e9c254` | Dimmed amber |
| `on-tertiary` | `#3d2e00` | Text on tertiary surfaces |
| `interest-match` | `#66b3ff` | Interest similarity indicator — cool blue |
| `secondary` | `#b7ccb9` | Soft green for secondary UI |
| `secondary-container` | `#3b4d3f` | Chips, tags |
| `on-secondary-container` | `#a9beab` | Text on chips/tags |

### Error

| Token | Hex | Role |
|-------|-----|------|
| `error` | `#ffb4ab` | Error state |
| `error-container` | `#93000a` | Error container |
| `on-error-container` | `#ffdad6` | Text on error container |

---

## 2. Typography

Three fonts, each with a distinct voice:

### Font Stack

| Role | Font | CSS Variable | Usage |
|------|------|-------------|-------|
| Display/Headlines | Newsreader (serif) | `--font-headline` | Talk titles, tagline, page headers, pull quotes |
| Body | Work Sans (sans-serif) | `--font-body` | Transcript text, descriptions, nav, general UI |
| Labels/Technical | Space Grotesk | `--font-label` | Timestamps, metadata, handles, chips, room names |

### Type Scale

| Token | Size | Font | Notes |
|-------|------|------|-------|
| `display-lg` | 3.5rem | Newsreader | Hero tagline. Tight tracking (-0.02em). |
| `headline-md` | 1.75rem | Newsreader | Talk titles, section headers |
| `headline-sm` | 1.25rem | Newsreader | Card titles |
| `body-lg` | 1.125rem | Work Sans | Transcript segments, main content |
| `body-md` | 1rem | Work Sans | General body text |
| `label-md` | 0.875rem | Space Grotesk | Metadata, timestamps. Uppercase for coordinates/metadata. |
| `label-sm` | 0.75rem | Space Grotesk | Small technical details |

### Rules

- Never use `#FFFFFF` for text. `on-surface` (`#e0e3de`) is the brightest allowed.
- Newsreader italic for pull quotes and friend recommendation notes.
- Space Grotesk uppercase for metadata labels (room, duration, speaker handles).
- Newsreader gets tight tracking (`-0.02em`) at `display-lg` scale.

---

## 3. Surfaces, Depth & Effects

### Core Principle

Depth comes from tonal layering and atmospheric blur, not drop shadows or borders.

### Surface Hierarchy (back to front)

1. `surface` — page background with radial fog gradients
2. `surface-container-low` — cards, transcript panel
3. `surface-container-high` — interactive modules, hover states
4. `surface-container-highest` — inputs, popovers, modals

### Misty Glass (floating elements)

Used for the top nav bar, modals, and overlays:

```css
.misty-glass {
  background: rgba(50, 54, 50, 0.4);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
```

### Fog Gradients

Applied to page backgrounds to create the "light filtering through canopy" effect:

```css
.bg-understory {
  background-color: #101411;
  background-image:
    radial-gradient(circle at 50% -20%, rgba(75, 223, 151, 0.08) 0%, transparent 50%),
    radial-gradient(circle at 10% 40%, rgba(75, 223, 151, 0.05) 0%, transparent 30%),
    radial-gradient(circle at 90% 80%, rgba(255, 223, 144, 0.03) 0%, transparent 40%);
}
```

### Glow Effects

```css
.biolume-glow {
  box-shadow: 0 0 20px rgba(108, 252, 178, 0.15);
}
.biolume-glow-strong {
  box-shadow: 0 0 40px rgba(108, 252, 178, 0.3);
}
```

- Subtle glow (`.biolume-glow`) for understory cards at rest
- Strong glow (`.biolume-glow-strong`) for hover/active states
- Primary CTA buttons glow on hover (brightness increase, not color change)

### The No-Line Rule

**Borders are prohibited for sectioning.** Boundaries are defined by:
- Tonal shifts between surface levels
- Whitespace (32-48px between sections)
- Ghost border (`outline-variant` at 15% opacity) only for accessibility

### Ambient Shadows

If a shadow is required for floating elements:
- Color: tinted version of background, not black
- Value: `0px 20px 40px rgba(0, 0, 0, 0.4)` — extra diffused
- Should feel like ambient occlusion, not Material Design shadows

### Corner Radius

| Token | Value | Usage |
|-------|-------|-------|
| `DEFAULT` | `0.25rem` (4px) | Small elements |
| `lg` | `0.75rem` (12px) | Cards, buttons, containers |
| `xl` | `1rem` (16px) | Large panels |
| `full` | `9999px` | Chips, tags, avatars |

No hard corners. The world is organic.

---

## 4. Components

### Top Nav Bar

- Misty glass background, full-width, fixed position
- Left: "Understory" wordmark in Newsreader italic
- Center: page links (Feed, Map) in Work Sans — map to `/for/:handle` and `/map/:handle`
- Right: search input + user avatar (post-auth) or "Sign in with Bluesky" button (pre-auth)
- No bottom border — separates from content via blur + tonal difference

### Buttons

| Variant | Fill | Text | Radius | Hover |
|---------|------|------|--------|-------|
| Primary | `primary-fixed` | `on-primary` | lg (12px) | Glow intensifies (brightness, not color change) |
| Secondary | None (ghost border `outline` at 20%) | `on-surface` | lg (12px) | Background lightens subtly |
| Tertiary | None | `tertiary-fixed-dim` in Space Grotesk | lg (12px) | Underline or subtle glow |

**States (all button variants):**
- **Focus**: `primary-fixed` ring (2px, offset 2px) — visible for keyboard navigation
- **Active/Pressed**: slight scale-down (0.98) + glow dims
- **Disabled**: 40% opacity, no glow, `cursor: not-allowed`
- **Loading**: spinner icon replaces text, maintains button width

### Lume-Card (Talk Cards)

The signature component for displaying talks in the feed and coverage map:

- Background: `surface-container-low` at 60% opacity
- `backdrop-filter: blur(20px)`
- 2px top-edge-only accent border in `primary-fixed-dim` (this is a component accent, not sectioning — permitted under the No-Line Rule)
- `border-radius: 0.75rem` (lg)
- Headline: Newsreader (`headline-sm`)
- Metadata: Space Grotesk (`label-md`) — room, duration, speaker handles
- Glow intensity maps to understory score (undiscovered = brighter)
- Focus state: `primary-fixed` ring (2px) for keyboard navigation through card grids
- The `interest-match` token (`#66b3ff`) appears as a small indicator dot or badge on cards where the talk matches the user's interest profile but was missed by their network

### Transcript Panel

- Body text: Work Sans (`body-lg`) for segments
- Timestamps: Space Grotesk (`label-md`)
- Active segment: left-border glow in `primary-fixed` + slightly elevated background (`surface-container-high`)
- Click any segment to seek video to that timestamp
- Smooth highlight transition (150ms ease)

### Sliders

Two sliders control scoring weights:
- "Surprise Me <-> For Me" — interest matching weight
- "Algorithm <-> Friends" — friend override weight
- Track: `surface-container-high`
- Thumb: `primary-fixed` with glow
- Labels: Space Grotesk at each end

### Chips & Tags

- Full radius capsules (`9999px`)
- Default: `secondary-container` background, `on-secondary-container` text
- Friend recommendation chips: `tertiary-fixed` background, `on-tertiary` text
- Room names, categories, topic tags

### Input Fields

- Background: `surface-container-highest`
- On focus: subtle `primary-fixed` outer glow + slight background lightening
- No heavy border on focus
- Error state: `error` outer glow replaces primary glow, error message in `label-sm` below field using `on-error-container`
- Disabled: 40% opacity
- Label: `label-md` in Space Grotesk above the field, never inside

### Coverage Map Tiles

- Grid of Lume-Cards, one per talk
- Glow intensity driven by understory score:
  - Cold (undiscovered): bright glow (`glow-bright`), breathing animation
  - Hot (covered): fades to `covered-muted`, static
- Breathing animation on cold tiles: opacity 0.85-1.0, 4s cycle, staggered per tile

---

## 5. Motion

| Element | Animation | Duration | Notes |
|---------|-----------|----------|-------|
| Coverage map cold tiles | Opacity 0.85-1.0 breathing | 4s cycle | Staggered per tile. Only understory tiles. |
| Transcript highlight | Background + border transition | 150ms ease | Follows video playback |
| Slider feedback | Coverage map re-sort + re-color | Spring (Framer Motion) | Real-time as slider moves |
| Page transitions | Fade | 200ms | Between routes |
| Hover glow | Glow intensity increase | 200ms | No color shift |
| Lume-Card enter | Fade up | 300ms | Staggered in grid |

---

## 6. Responsive / Mobile

| Breakpoint | Adaptation |
|------------|------------|
| Desktop (>1024px) | Full layout: top nav, coverage map grid, side-by-side video + transcript |
| Tablet (768-1024px) | Coverage map reduces columns, transcript moves below video |
| Mobile (<768px) | Coverage map becomes vertical scrolling list with glow on left edge. Talk pages stack: video -> metadata -> transcript. Sliders become full-width. Top nav collapses to wordmark + hamburger. |

Misty glass effects are preserved on mobile (well-supported on modern browsers).

---

## 7. Implementation Notes

### Tailwind v4 Setup

All configuration lives in CSS via `@theme` in `globals.css`. No `tailwind.config.ts` is needed — Tailwind v4 uses CSS-first configuration.

### `@theme` Block

```css
@theme inline {
  /* Surfaces */
  --color-surface: #101411;
  --color-surface-dim: #101411;
  --color-surface-bright: #363a37;
  --color-surface-container-lowest: #0b0f0c;
  --color-surface-container-low: #191d1a;
  --color-surface-container: #1d211d;
  --color-surface-container-high: #272b28;
  --color-surface-container-highest: #323632;
  --color-surface-tint: #4bdf97;

  /* Text */
  --color-on-surface: #e0e3de;
  --color-on-surface-variant: #bbcabe;
  --color-on-background: #e0e3de;

  /* Primary (bioluminescent mint) */
  --color-primary-fixed: #6cfcb2;
  --color-primary-fixed-dim: #4bdf97;
  --color-primary-container: #6cfcb2;
  --color-on-primary: #003920;
  --color-on-primary-container: #007347;
  --color-on-primary-fixed: #002111;
  --color-on-primary-fixed-variant: #005231;
  --color-inverse-primary: #006d43;

  /* Secondary */
  --color-secondary: #b7ccb9;
  --color-secondary-container: #3b4d3f;
  --color-secondary-fixed: #d3e8d5;
  --color-secondary-fixed-dim: #b7ccb9;
  --color-on-secondary: #233427;
  --color-on-secondary-container: #a9beab;
  --color-on-secondary-fixed: #0e1f13;
  --color-on-secondary-fixed-variant: #394b3d;

  /* Tertiary (warm amber) */
  --color-tertiary-fixed: #ffdf90;
  --color-tertiary-fixed-dim: #e9c254;
  --color-tertiary-container: #ffdf90;
  --color-on-tertiary: #3d2e00;
  --color-on-tertiary-container: #7c6100;
  --color-on-tertiary-fixed: #241a00;
  --color-on-tertiary-fixed-variant: #584400;

  /* Glow spectrum */
  --color-glow-bright: #6cfcb2;
  --color-glow-medium: #3d9970;
  --color-glow-dim: #1a4d3a;
  --color-covered-muted: #2a3530;

  /* Accents */
  --color-interest-match: #66b3ff;

  /* Outline */
  --color-outline: #869489;
  --color-outline-variant: #3c4a40;

  /* Error */
  --color-error: #ffb4ab;
  --color-error-container: #93000a;
  --color-on-error: #690005;
  --color-on-error-container: #ffdad6;

  /* Inverse */
  --color-inverse-surface: #e0e3de;
  --color-inverse-on-surface: #2d312e;

  /* Fonts */
  --font-headline: var(--font-newsreader), serif;
  --font-body: var(--font-work-sans), sans-serif;
  --font-label: var(--font-space-grotesk), sans-serif;

  /* Border radius */
  --radius-DEFAULT: 0.25rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-full: 9999px;
}
```

### Type Scale (CSS Utility Classes)

Tailwind v4 does not create composite typography utilities (font + size + tracking). Define these as CSS classes in `globals.css`:

```css
.text-display-lg {
  font-family: var(--font-headline);
  font-size: 3.5rem;
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.text-headline-md {
  font-family: var(--font-headline);
  font-size: 1.75rem;
  line-height: 1.3;
}
.text-headline-sm {
  font-family: var(--font-headline);
  font-size: 1.25rem;
  line-height: 1.4;
}
.text-body-lg {
  font-family: var(--font-body);
  font-size: 1.125rem;
  line-height: 1.6;
}
.text-body-md {
  font-family: var(--font-body);
  font-size: 1rem;
  line-height: 1.6;
}
.text-label-md {
  font-family: var(--font-label);
  font-size: 0.875rem;
  line-height: 1.4;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.text-label-sm {
  font-family: var(--font-label);
  font-size: 0.75rem;
  line-height: 1.4;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
```

### Breathing Animation

```css
@keyframes breathe {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; }
}
.animate-breathe {
  animation: breathe 4s ease-in-out infinite;
  animation-delay: calc(var(--tile-index, 0) * 0.3s);
}
```

Set `--tile-index` via inline style on each tile: `style="--tile-index: 5"`. Only apply to understory (cold) tiles. Covered tiles have no animation.

Respect `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  .animate-breathe { animation: none; opacity: 1; }
}
```

### Files to Create/Modify

| File | Action |
|------|--------|
| `src/app/globals.css` | Replace scaffold CSS with `@theme` block, type scale classes, utility classes, fog gradients, animations |
| `src/app/layout.tsx` | Replace Geist fonts with Newsreader, Work Sans, Space Grotesk via `next/font/google`. Update metadata. |

No `tailwind.config.ts` needed. Tailwind v4 is CSS-first.

### Font Loading

```tsx
// layout.tsx
import { Newsreader } from 'next/font/google';
import { Work_Sans } from 'next/font/google';
import { Space_Grotesk } from 'next/font/google';

const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  display: 'swap',
});
const workSans = Work_Sans({
  variable: '--font-work-sans',
  subsets: ['latin'],
  display: 'swap',
});
const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  display: 'swap',
});
```

### Spring Animations

Slider feedback (coverage map re-sort/re-color) uses CSS spring easing via `linear()` for modern browser support. Framer Motion is not required. If more complex orchestration is needed later, it can be added as an optional dependency.

```css
/* Approximate spring easing */
--ease-spring: linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%,
  0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161,
  1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%,
  0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1.004 83.8%, 1);
```

### Page Transitions

Next.js App Router does not have built-in page transitions. Use the View Transitions API via Next.js experimental support (`next.config.ts: { experimental: { viewTransition: true } }`) for a simple cross-fade. Fallback: no transition (instant navigation) — the fog gradients provide enough visual continuity.

---

## 8. Accessibility

### Contrast

All primary text pairings meet WCAG AA (4.5:1 for normal text, 3:1 for large):
- `on-surface` on `surface`: ~12.5:1
- `on-surface-variant` on `surface`: ~8.5:1
- `on-surface-variant` on `surface-container-low`: ~7.0:1
- `on-primary` on `primary-fixed`: ~7.5:1

The `outline` token (#869489) achieves ~4.3:1 on `surface` — adequate for large text and decorative elements only. Never use `outline` for body-sized informational text.

### Focus Indicators

All interactive elements must show a visible `primary-fixed` focus ring (2px, offset 2px) when focused via keyboard. This overrides the misty/no-border aesthetic for accessibility compliance.

### Reduced Motion

All animations respect `prefers-reduced-motion: reduce`:
- Breathing animation: disabled (static opacity 1)
- Spring transitions: replaced with instant transitions
- Page transitions: disabled
- Hover glow: still permitted (not motion)

### Screen Reader Strategy

Glow intensity communicates information visually (understory score). This must also be available as text:
- Each Lume-Card includes an `aria-label` with the understory score (e.g., "Understory score: 85% undiscovered")
- Coverage map tiles include `aria-description` for coverage status
- Friend recommendation badges include `aria-label` noting the recommender

---

## 9. Do's and Don'ts

### Do

- Embrace intentional asymmetry — offset text columns, let headlines overhang containers
- Use fog overlays — soft gradients occasionally overlap content module corners
- Prioritize scale — Newsreader at `display-lg` for signature editorial moments
- Let Lume-Cards breathe — generous whitespace between cards in grids

### Don't

- Don't use `1px solid` borders — they break the smoky illusion
- Don't use `#FFFFFF` for text — `on-surface` (`#e0e3de`) maximum
- Don't use hard corners — no `rounded-none` or `rounded-sm`
- Don't use Material Design-style drop shadows — think ambient occlusion
- Don't over-glow — the glow is the reward for undiscovered content, not decoration
