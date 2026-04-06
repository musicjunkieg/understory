# Bioluminescent Design System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the bioluminescent forest-floor design system — theme tokens, typography, utility classes, and core UI components — so all subsequent Understory pages build on a consistent visual foundation.

**Architecture:** Tailwind v4 CSS-first configuration via `@theme` in `globals.css`. Fonts loaded via `next/font/google` in `layout.tsx`. Reusable components in `src/components/ui/`. No `tailwind.config.ts` needed.

**Tech Stack:** Next.js 16 (App Router), Tailwind CSS v4, TypeScript, `next/font/google`

**Spec:** `docs/superpowers/specs/2026-04-06-bioluminescent-design-system.md`

**Chainlink Issue:** #14

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/app/globals.css` | Rewrite | `@theme` tokens, type scale classes, utility classes (misty-glass, fog, glow, breathe animation), reduced-motion |
| `src/app/layout.tsx` | Rewrite | Font loading (Newsreader, Work Sans, Space Grotesk), metadata, html/body classes |
| `src/components/ui/button.tsx` | Create | Button component (primary, secondary, tertiary variants + states) |
| `src/components/ui/lume-card.tsx` | Create | Lume-Card talk card component with glow intensity prop |
| `src/components/ui/chip.tsx` | Create | Chip/tag component (default + friend-rec variants) |
| `src/components/ui/nav.tsx` | Create | Top nav bar with misty glass effect |
| `src/app/page.tsx` | Rewrite | Replace scaffold with design system showcase (temporary, replaced by landing page later) |
| `next.config.ts` | Modify | Add `experimental: { viewTransition: true }` |

---

## Chunk 1: Theme Foundation

### Task 1: Replace globals.css with design system tokens

**Files:**
- Rewrite: `src/app/globals.css`

- [ ] **Step 1: Read current globals.css**

Read `src/app/globals.css` to confirm current scaffold content.

- [ ] **Step 2: Write the complete globals.css**

Replace the entire file with:

```css
@import "tailwindcss";

/* ============================================
   Understory Design System — Bioluminescent
   ============================================ */

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

  /* Fonts — variables set by next/font/google in layout.tsx */
  --font-headline: var(--font-newsreader), serif;
  --font-body: var(--font-work-sans), sans-serif;
  --font-label: var(--font-space-grotesk), sans-serif;

  /* Border radius */
  --radius-DEFAULT: 0.25rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-full: 9999px;

  /* Spring easing */
  --ease-spring: linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%,
    0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161,
    1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%,
    0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1.004 83.8%, 1);
}

/* ============================================
   Type Scale
   ============================================ */

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

/* ============================================
   Atmospheric Utilities
   ============================================ */

.misty-glass {
  background: rgba(50, 54, 50, 0.4);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.bg-understory {
  background-color: var(--color-surface);
  background-image:
    radial-gradient(circle at 50% -20%, rgba(75, 223, 151, 0.08) 0%, transparent 50%),
    radial-gradient(circle at 10% 40%, rgba(75, 223, 151, 0.05) 0%, transparent 30%),
    radial-gradient(circle at 90% 80%, rgba(255, 223, 144, 0.03) 0%, transparent 40%);
}

.biolume-glow {
  box-shadow: 0 0 20px rgba(108, 252, 178, 0.15);
}
.biolume-glow-strong {
  box-shadow: 0 0 40px rgba(108, 252, 178, 0.3);
}

.ghost-border {
  outline: 1px solid rgba(60, 74, 64, 0.15);
}

/* ============================================
   Animations
   ============================================ */

@keyframes breathe {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; }
}
.animate-breathe {
  animation: breathe 4s ease-in-out infinite;
  animation-delay: calc(var(--tile-index, 0) * 0.3s);
}

@media (prefers-reduced-motion: reduce) {
  .animate-breathe {
    animation: none;
    opacity: 1;
  }
}

/* ============================================
   Base Styles
   ============================================ */

body {
  background-color: var(--color-surface);
  color: var(--color-on-surface);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Focus ring for keyboard navigation */
:focus-visible {
  outline: 2px solid var(--color-primary-fixed);
  outline-offset: 2px;
}

/* Selection color */
::selection {
  background-color: var(--color-primary-container);
  color: var(--color-on-primary-container);
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: Build succeeds with no CSS errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: add bioluminescent design system tokens and utilities"
```

---

### Task 2: Update layout.tsx with fonts and metadata

**Files:**
- Rewrite: `src/app/layout.tsx`

- [ ] **Step 1: Read current layout.tsx**

Read `src/app/layout.tsx` to confirm current scaffold content.

- [ ] **Step 2: Write the updated layout.tsx**

Replace the entire file with:

```tsx
import type { Metadata } from "next";
import { Newsreader } from "next/font/google";
import { Work_Sans } from "next/font/google";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  display: "swap",
});

const workSans = Work_Sans({
  variable: "--font-work-sans",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Understory — What your timeline missed",
  description:
    "A social anti-algorithm for ATmosphereConf VODs. Understory finds the talks your network didn't.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${workSans.variable} ${spaceGrotesk.variable}`}
    >
      <body className="min-h-screen bg-understory antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Verify the build compiles and fonts load**

Run: `npm run dev`
Open http://localhost:3000 — verify dark forest background with fog gradients appears. Check the Network tab in devtools to confirm all three Google Fonts load.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: load Newsreader, Work Sans, Space Grotesk fonts and update metadata"
```

---

### Task 3: Enable View Transitions in next.config.ts

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Read current next.config.ts**

Read `next.config.ts` to confirm current content.

- [ ] **Step 2: Add experimental viewTransition**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    viewTransition: true,
  },
};

export default nextConfig;
```

- [ ] **Step 3: Verify dev server restarts cleanly**

Run: `npm run dev`
Expected: No errors on startup.

- [ ] **Step 4: Commit**

```bash
git add next.config.ts
git commit -m "feat: enable experimental View Transitions API"
```

---

## Chunk 2: Core UI Components

### Task 4: Button component

**Files:**
- Create: `src/components/ui/button.tsx`

- [ ] **Step 1: Create the components directory**

Run: `mkdir -p src/components/ui`

- [ ] **Step 2: Write the Button component**

```tsx
import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "tertiary";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: [
    "bg-primary-fixed text-on-primary",
    "hover:brightness-110 hover:biolume-glow-strong",
    "biolume-glow",
  ].join(" "),
  secondary: [
    "bg-transparent text-on-surface",
    "outline outline-1 outline-outline/20",
    "hover:bg-surface-container-high",
  ].join(" "),
  tertiary: [
    "bg-transparent text-tertiary-fixed-dim font-label",
    "hover:underline hover:underline-offset-4",
  ].join(" "),
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", loading = false, disabled, className = "", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={[
          "inline-flex items-center justify-center gap-2",
          "rounded-lg px-5 py-2.5 text-body-md",
          "transition-all duration-200",
          "active:scale-[0.98]",
          "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-fixed",
          variantStyles[variant],
          className,
        ].join(" ")}
        {...props}
      >
        {loading ? (
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          children
        )}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, type ButtonProps, type ButtonVariant };
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/button.tsx
git commit -m "feat: add Button component with primary/secondary/tertiary variants"
```

---

### Task 5: Chip component

**Files:**
- Create: `src/components/ui/chip.tsx`

- [ ] **Step 1: Write the Chip component**

```tsx
import { type HTMLAttributes } from "react";

type ChipVariant = "default" | "friend";

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant;
}

const variantStyles: Record<ChipVariant, string> = {
  default: "bg-secondary-container text-on-secondary-container",
  friend: "bg-tertiary-fixed text-on-tertiary",
};

function Chip({ variant = "default", className = "", children, ...props }: ChipProps) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-3 py-1",
        "text-label-sm",
        variantStyles[variant],
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </span>
  );
}

export { Chip, type ChipProps, type ChipVariant };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/chip.tsx
git commit -m "feat: add Chip component with default and friend-rec variants"
```

---

### Task 6: Lume-Card component

**Files:**
- Create: `src/components/ui/lume-card.tsx`

- [ ] **Step 1: Write the LumeCard component**

```tsx
import { type HTMLAttributes } from "react";

interface LumeCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Understory score 0-1. Higher = more undiscovered = brighter glow. */
  glowIntensity?: number;
  /** Index for staggered breathing animation. */
  tileIndex?: number;
  /** Whether to show the interest match indicator. */
  interestMatch?: boolean;
}

function glowStyle(intensity: number): string {
  if (intensity > 0.7) return "biolume-glow-strong";
  if (intensity > 0.3) return "biolume-glow";
  return "";
}

function LumeCard({
  glowIntensity = 0,
  tileIndex,
  interestMatch = false,
  className = "",
  children,
  ...props
}: LumeCardProps) {
  const isUnderstory = glowIntensity > 0.3;

  return (
    <div
      className={[
        "relative rounded-lg",
        "bg-surface-container-low/60 backdrop-blur-[20px]",
        "border-t-2 border-primary-fixed-dim",
        "transition-shadow duration-200",
        "hover:biolume-glow-strong",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-fixed",
        glowStyle(glowIntensity),
        isUnderstory ? "animate-breathe" : "",
        className,
      ].join(" ")}
      style={tileIndex !== undefined ? { "--tile-index": tileIndex } as React.CSSProperties : undefined}
      {...props}
    >
      {interestMatch && (
        <span
          className="absolute top-3 right-3 h-2.5 w-2.5 rounded-full bg-interest-match"
          aria-label="Matches your interests"
        />
      )}
      {children}
    </div>
  );
}

export { LumeCard, type LumeCardProps };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/lume-card.tsx
git commit -m "feat: add LumeCard component with glow intensity and breathing animation"
```

---

### Task 7: Top Nav component

**Files:**
- Create: `src/components/ui/nav.tsx`

- [ ] **Step 1: Write the Nav component**

```tsx
import Link from "next/link";

function Nav() {
  return (
    <nav className="fixed top-0 z-50 w-full misty-glass">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* Wordmark */}
        <Link href="/" className="font-headline text-xl italic text-on-surface">
          Understory
        </Link>

        {/* Center links */}
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

        {/* Right side — placeholder for auth */}
        <div className="flex items-center gap-4">
          <span className="text-label-md text-on-surface-variant">
            Sign in with Bluesky
          </span>
        </div>
      </div>
    </nav>
  );
}

export { Nav };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/nav.tsx
git commit -m "feat: add top Nav component with misty glass effect"
```

---

## Chunk 3: Showcase Page & Verification

### Task 8: Design system showcase page

**Files:**
- Rewrite: `src/app/page.tsx`

- [ ] **Step 1: Write a showcase page that exercises all design tokens and components**

This is a temporary page that displays the design system elements. It will be replaced by the real landing page later (issue #13).

```tsx
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { LumeCard } from "@/components/ui/lume-card";
import { Nav } from "@/components/ui/nav";

export default function Home() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl px-6 pt-24 pb-16">
        {/* Hero */}
        <section className="mb-16">
          <p className="text-label-md text-primary-fixed-dim mb-4">
            Design System Preview
          </p>
          <h1 className="text-display-lg text-on-surface mb-6">
            What your <em className="text-primary-fixed">timeline</em> missed.
          </h1>
          <p className="text-body-lg text-on-surface-variant max-w-2xl">
            Understory inverts the signal. The talks your network missed glow brightest.
          </p>
        </section>

        {/* Buttons */}
        <section className="mb-16">
          <h2 className="text-headline-md text-on-surface mb-6">Buttons</h2>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="primary">Primary Action</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="tertiary">Tertiary Link</Button>
            <Button variant="primary" disabled>Disabled</Button>
            <Button variant="primary" loading>Loading</Button>
          </div>
        </section>

        {/* Chips */}
        <section className="mb-16">
          <h2 className="text-headline-md text-on-surface mb-6">Chips & Tags</h2>
          <div className="flex flex-wrap gap-3">
            <Chip>Performance Theatre</Chip>
            <Chip>lightning-talk</Chip>
            <Chip>decentralized-identity</Chip>
            <Chip variant="friend">@alice recommended</Chip>
            <Chip variant="friend">@bob recommended</Chip>
          </div>
        </section>

        {/* Lume Cards */}
        <section className="mb-16">
          <h2 className="text-headline-md text-on-surface mb-6">Lume Cards</h2>
          <div className="grid gap-6 md:grid-cols-3">
            <LumeCard glowIntensity={0.9} tileIndex={0} interestMatch>
              <div className="p-5">
                <p className="text-label-md text-primary-fixed-dim mb-2">
                  Performance Theatre &middot; 10 min
                </p>
                <h3 className="text-headline-sm text-on-surface mb-2">
                  Modular Open Science with ATProto
                </h3>
                <p className="text-body-md text-on-surface-variant">
                  95% undiscovered by your network
                </p>
              </div>
            </LumeCard>

            <LumeCard glowIntensity={0.5} tileIndex={1}>
              <div className="p-5">
                <p className="text-label-md text-primary-fixed-dim mb-2">
                  Bukhman Lounge &middot; 25 min
                </p>
                <h3 className="text-headline-sm text-on-surface mb-2">
                  Decentralized Preprints on ATProto
                </h3>
                <p className="text-body-md text-on-surface-variant">
                  50% covered by your network
                </p>
              </div>
            </LumeCard>

            <LumeCard glowIntensity={0.1} tileIndex={2}>
              <div className="p-5">
                <p className="text-label-md text-on-surface-variant mb-2">
                  Performance Theatre &middot; 45 min
                </p>
                <h3 className="text-headline-sm text-on-surface mb-2">
                  Protocol Governance in the Atmosphere
                </h3>
                <p className="text-body-md text-on-surface-variant">
                  Heavily covered — 3 friends posted about this
                </p>
              </div>
            </LumeCard>
          </div>
        </section>

        {/* Surface Tonal Scale */}
        <section className="mb-16">
          <h2 className="text-headline-md text-on-surface mb-6">Surface Scale</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-surface-container-lowest p-6">
              <p className="text-label-sm text-on-surface-variant">Lowest</p>
            </div>
            <div className="rounded-lg bg-surface-container-low p-6">
              <p className="text-label-sm text-on-surface-variant">Low</p>
            </div>
            <div className="rounded-lg bg-surface-container-high p-6">
              <p className="text-label-sm text-on-surface-variant">High</p>
            </div>
            <div className="rounded-lg bg-surface-container-highest p-6">
              <p className="text-label-sm text-on-surface-variant">Highest</p>
            </div>
          </div>
        </section>

        {/* Typography */}
        <section className="mb-16">
          <h2 className="text-headline-md text-on-surface mb-6">Type Scale</h2>
          <div className="space-y-4">
            <p className="text-display-lg text-on-surface">display-lg — Newsreader 3.5rem</p>
            <p className="text-headline-md text-on-surface">headline-md — Newsreader 1.75rem</p>
            <p className="text-headline-sm text-on-surface">headline-sm — Newsreader 1.25rem</p>
            <p className="text-body-lg text-on-surface-variant">body-lg — Work Sans 1.125rem</p>
            <p className="text-body-md text-on-surface-variant">body-md — Work Sans 1rem</p>
            <p className="text-label-md text-on-surface-variant">label-md — Space Grotesk 0.875rem</p>
            <p className="text-label-sm text-on-surface-variant">label-sm — Space Grotesk 0.75rem</p>
          </div>
        </section>

        {/* Glow Spectrum */}
        <section className="mb-16">
          <h2 className="text-headline-md text-on-surface mb-6">Glow Spectrum</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-glow-bright p-6">
              <p className="text-label-sm text-on-primary">Bright</p>
            </div>
            <div className="rounded-lg bg-glow-medium p-6">
              <p className="text-label-sm text-on-primary">Medium</p>
            </div>
            <div className="rounded-lg bg-glow-dim p-6">
              <p className="text-label-sm text-on-surface">Dim</p>
            </div>
            <div className="rounded-lg bg-covered-muted p-6">
              <p className="text-label-sm text-on-surface-variant">Covered</p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
```

- [ ] **Step 2: Run the dev server and visually verify**

Run: `npm run dev`
Open http://localhost:3000

Verify:
- Forest floor background with subtle green fog gradients
- Misty glass nav bar at top
- Newsreader font for headlines, Work Sans for body, Space Grotesk for labels
- Three Lume-Cards with different glow intensities (brightest on left, dimmest on right)
- First card has blue interest-match dot
- Cold cards have breathing animation
- Buttons show all states (hover for glow, tab for focus ring)
- No borders used for sectioning
- Surface tonal scale shows clear depth progression

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add design system showcase page"
```

---

### Task 9: Delete unused scaffold files

**Files:**
- Delete: `public/file.svg`, `public/globe.svg`, `public/next.svg`, `public/vercel.svg`, `public/window.svg`

- [ ] **Step 1: Remove Next.js scaffold SVGs**

Run: `rm public/file.svg public/globe.svg public/next.svg public/vercel.svg public/window.svg`

- [ ] **Step 2: Verify build still passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add public/
git commit -m "chore: remove Next.js scaffold assets"
```

---

### Task 10: Run eslint and fix any issues

- [ ] **Step 1: Run eslint**

Run: `npx eslint src/`
Expected: No errors. Fix any that appear.

- [ ] **Step 2: Commit fixes if any**

```bash
git add src/
git commit -m "fix: resolve eslint issues in design system components"
```
