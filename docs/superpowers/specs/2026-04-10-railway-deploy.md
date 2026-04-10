# Deploy Understory to Railway Spec

**Date:** 2026-04-10
**Issue:** Chainlink #31
**Status:** Approved (pending review)
**Depends on:** PR #9 (scoring algorithm — merged), PR #5 (social graph crawler — merged)
**Unblocks:** #32 (write submission post), #33 (open source on GitHub)

---

## 1. Goal

Deploy the Understory Next.js application to Railway with a custom domain (`understory.watch`), self-hosted AT Protocol OAuth client metadata, and the 125MB `data/` directory correctly bundled. After this work, the site is publicly accessible with working OAuth login, social graph crawling, and talk browsing.

---

## 2. Background

Understory is currently dev-only behind Tailscale Funnel. The conference ended April 5 — every day the site isn't live is a day the project's audience shrinks. The codebase is production-ready: 115+ talk pages with HLS video + transcripts, an OAuth login flow, a social graph crawler, and a scoring engine. What's missing is the deployment itself.

**Current state:**
- Next.js 16 / React 19 / TypeScript 5
- AT Protocol OAuth via `@atproto/oauth-client-node`, sessions in-memory (ephemeral by design)
- `data/talks.json` (talk index) and `data/transcripts/*.json` (128 transcript files, ~125MB total) loaded at runtime via `fs.readFileSync`
- OAuth `client_id` currently points at `cimd-service.fly.dev` (shared dev-only metadata host)
- No Railway config exists in the repo

**Target state:**
- Live at `https://understory.watch`
- Self-hosted OAuth client metadata (no cimd-service dependency)
- Railway auto-deploys on push to `main`
- One environment variable: `APP_URL`

---

## 3. Code Changes

### 3.1 `next.config.ts` — standalone output + data tracing

Add `output: "standalone"` for Railway's builder, and `outputFileTracingIncludes` to ensure the `data/` directory is bundled into the standalone output.

The `data/` directory contains `talks.json` and 128 transcript JSON files loaded at runtime via dynamically-constructed `fs.readFileSync` paths (e.g., `path.join(DATA_DIR, "transcripts", `${rkey}.json`)`) which `@vercel/nft` cannot trace automatically. The `outputFileTracingIncludes` directive explicitly includes them.

Remove the Tailscale-specific `allowedDevOrigins` entry — it's a dev convenience that shouldn't ship to production. Keep the `127.0.0.1` entry (harmless, useful if someone clones and runs locally).

**Before:**
```ts
const nextConfig: NextConfig = {
  experimental: {
    viewTransition: true,
  },
  allowedDevOrigins: [
    "127.0.0.1",
    "bryans-mac-mini.wildebeest-puffin.ts.net",
  ],
};
```

**After:**
```ts
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./data/**/*"],
  },
  experimental: {
    viewTransition: true,
  },
  allowedDevOrigins: [
    "127.0.0.1",
  ],
};
```

### 3.1b `package.json` — postbuild script + standalone start command

Next.js standalone mode fundamentally changes how the app is served:

1. **Static assets excluded.** `.next/static/` (CSS/JS bundles) and `public/` are deliberately excluded from the standalone output. Without them, pages load with no styles and no client-side JavaScript (no hydration, no HLS player, no interactivity).

2. **Data directory not at `process.cwd()/data`.** The standalone server runs from `.next/standalone/`, so `process.cwd()` resolves there — not the project root. The `outputFileTracingIncludes` config puts traced files under `.next/standalone/.next/server/`, but `path.resolve(process.cwd(), "data")` still looks for `.next/standalone/data/`.

3. **Start command changes.** The standalone server is `node .next/standalone/server.js`, not `next start`. Using `next start` would bypass the standalone output entirely, defeating the optimization.

**Fix:** Add a `postbuild` script that copies the three missing pieces into the standalone directory, and change the `start` script:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "postbuild": "cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public && cp -r data .next/standalone/data",
  "start": "node .next/standalone/server.js",
  ...
}
```

The `postbuild` script runs automatically after `npm run build` (npm lifecycle hook). It copies:
- `.next/static/` → `.next/standalone/.next/static/` (CSS/JS bundles)
- `public/` → `.next/standalone/public/` (currently empty, but correct for future static assets)
- `data/` → `.next/standalone/data/` (talk + transcript JSON files)

The `start` script changes from `next start` to `node .next/standalone/server.js` so Railway (and local `npm start`) use the standalone server.

**Note:** The standalone server reads `PORT` and `HOSTNAME` environment variables. Railway sets `$PORT` automatically, but `HOSTNAME` defaults to `localhost` which won't work on Railway — it needs `HOSTNAME=0.0.0.0` to bind on all interfaces. This is set as a Railway env var in §4.2.

### 3.2 `src/lib/auth/metadata.ts` — shared client metadata builder

The AT Protocol OAuth spec requires that `client_id` is a URL that resolves to a JSON document containing the client metadata. PDS servers fetch this URL during the auth flow and compare it against what the client claims locally. If they don't match, the flow fails with a cryptic mismatch error.

To prevent drift, the metadata object is defined **once** in a shared module and imported by both the HTTP route (§3.3) and the OAuth client (§3.4).

**Create:** `src/lib/auth/metadata.ts`

```ts
export const CLIENT_METADATA_PATH = "/oauth/client-metadata.json";

export function buildClientMetadata(appUrl: string) {
  const clientId = `${appUrl}${CLIENT_METADATA_PATH}`;
  return {
    client_id: clientId,
    client_name: "Understory",
    client_uri: appUrl,
    redirect_uris: [`${appUrl}/oauth/callback`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "atproto transition:generic",
    application_type: "web",
    dpop_bound_access_tokens: true,
    token_endpoint_auth_method: "none",
  };
}
```

`buildClientMetadata` is a pure function: given `APP_URL`, it returns the exact metadata object. Both the route handler and `NodeOAuthClient` call it with the same `APP_URL`, making drift structurally impossible.

### 3.3 `src/app/oauth/client-metadata.json/route.ts` — self-hosted metadata endpoint

**Route path:** `src/app/oauth/client-metadata.json/route.ts`

This creates a Next.js App Router route handler at `/oauth/client-metadata.json`. The folder name contains a literal dot — Next.js App Router supports this (directories are just filesystem names), but if any tooling issue arises during testing, the fallback is to rename the folder to `client-metadata` (serving at `/oauth/client-metadata`) and update `CLIENT_METADATA_PATH` in `metadata.ts` accordingly. The AT Protocol spec does not mandate a specific path — only that `client_id` resolves to valid metadata.

```ts
import { NextResponse } from "next/server";
import { buildClientMetadata } from "@/lib/auth/metadata";

export async function GET() {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    return NextResponse.json(
      { error: "APP_URL not configured" },
      { status: 500 },
    );
  }
  return NextResponse.json(buildClientMetadata(appUrl));
}
```

**Why a route handler and not a static JSON file:** The `client_id` and `redirect_uris` contain the app's URL, which varies by environment (localhost in dev, `understory.watch` in production). A dynamic route reads `APP_URL` at request time so the same code works everywhere without build-time substitution.

**Content-Type:** `NextResponse.json()` automatically sets `Content-Type: application/json`, which is what PDS servers expect.

### 3.4 `src/lib/auth/client.ts` — derive `client_id` from `APP_URL`

Replace the `OAUTH_CLIENT_ID` environment variable with metadata derived from `APP_URL` via the shared `buildClientMetadata` function.

**Changes:**

1. Remove the `OAUTH_CLIENT_ID` env var check — it's no longer needed.
2. Import and call `buildClientMetadata(appUrl)` for the `clientMetadata` field.
3. Update `client_name` from `"Understory (Development)"` to `"Understory"` (handled by the shared builder).

**After:**
```ts
import { buildClientMetadata } from "./metadata";

function createClient(): NodeOAuthClient {
  const appUrl = process.env.APP_URL;

  if (!appUrl) {
    throw new Error(
      "Missing APP_URL environment variable. " +
        "Set to your app's public URL (e.g., https://understory.watch).",
    );
  }

  return new NodeOAuthClient({
    clientMetadata: buildClientMetadata(appUrl),
    // ... stateStore and sessionStore unchanged
  });
}
```

### 3.5 `.env` update for local development

Update the local `.env` to remove `OAUTH_CLIENT_ID` (no longer used) and ensure `APP_URL` is set:

```
APP_URL=http://127.0.0.1:3000
ASSEMBLYAI_API_KEY=<kept for offline transcription scripts>
```

The `.env` file is gitignored (not committed). This change is documented so developers know what to set after cloning.

---

## 4. Railway Infrastructure

### 4.1 Environments: staging + production

The project uses two Railway environments with a promotion workflow:

| Environment | Branch | Domain | Purpose |
|---|---|---|---|
| **Staging** | `staging` | Auto-generated `*.up.railway.app` | Validate changes before production. Push here first. |
| **Production** | `main` | `understory.watch` (custom domain) | Public-facing. Code arrives via `staging` → `main` merge. |

**Workflow:** Push to `staging` branch → Railway auto-deploys staging → validate on the Railway domain → merge `staging` → `main` → Railway auto-deploys production.

This means you can make tweaks, test them on the staging URL, and only promote to production when confident. The two environments run the same code at different points in time, differentiated only by their `APP_URL` and domain.

### 4.2 Create project and services

Using Railway MCP tools or CLI:

1. Create a new Railway project named "understory"
2. Link to the GitHub repo `musicjunkieg/understory`
3. Create two environments:
   - **Production** environment: deploys from `main` branch
   - **Staging** environment: deploys from `staging` branch
4. Railway auto-detects Next.js and uses its Node.js builder (Nixpacks) for both
5. Each environment gets its own service instance, env vars, and domain

### 4.3 Environment variables

**Staging environment:**

| Variable | Value | Notes |
|---|---|---|
| `APP_URL` | `https://<staging>.up.railway.app` | The auto-generated Railway domain for staging. Set after Railway creates it. |
| `HOSTNAME` | `0.0.0.0` | Required. Standalone server defaults to `localhost`; `0.0.0.0` binds on all interfaces. |

**Production environment:**

| Variable | Value | Notes |
|---|---|---|
| `APP_URL` | `https://understory.watch` | The custom domain. |
| `HOSTNAME` | `0.0.0.0` | Same as staging. |

`NODE_ENV=production` is set automatically by Railway in both environments. `PORT` is set automatically. `ASSEMBLYAI_API_KEY` is not needed at runtime (only for offline build scripts).

### 4.4 Domain configuration

**Staging:** Uses the auto-generated `*.up.railway.app` domain. No custom domain needed — it's for validation only.

**Production:**
1. Add `understory.watch` as a custom domain in the production environment
2. Railway provides a CNAME target (e.g., `<hash>.railway.app`)
3. At your registrar, create a CNAME record: `understory.watch` → `<railway-cname-target>`
4. Railway auto-provisions an SSL certificate via Let's Encrypt
5. DNS propagation typically takes 5–30 minutes

### 4.5 Branch setup

Create the `staging` branch from `main` and push it:

```bash
git checkout main
git checkout -b staging
git push -u origin staging
```

Going forward: feature branches merge into `staging` for testing, then `staging` merges into `main` for production release.

---

## 5. OAuth Flow in Production

The OAuth flow works as follows after deployment:

1. User clicks "Log in" on `understory.watch`
2. App calls `client.authorize(handle)` which initiates the OAuth handshake
3. The PDS at the user's handle fetches `https://understory.watch/oauth/client-metadata.json` to validate the client
4. PDS confirms `redirect_uris` includes `https://understory.watch/oauth/callback`
5. User is redirected to their PDS's authorization page
6. After approval, PDS redirects to `https://understory.watch/oauth/callback` with an auth code
7. App exchanges the code for tokens, stores session in-memory, sets the `understory_did` cookie
8. User sees their avatar in the Nav; `/api/crawl` becomes available

**Session lifecycle:**
- Sessions are in-memory `Map` objects (ephemeral by design)
- On redeploy: all sessions are lost; users' next request transparently re-authenticates via `client.restore(did)` using the DID from their browser cookie
- Cookie settings: `httpOnly: true`, `secure: true` (automatic in production via `NODE_ENV`), `sameSite: "lax"`, `path: "/"`, `maxAge: 7 days`
- No database or Redis needed

---

## 6. Data Bundling

The `data/` directory (125MB) is included in every deploy via `outputFileTracingIncludes` AND the `postbuild` copy script (§3.1b). Both mechanisms work together: `outputFileTracingIncludes` ensures Next.js traces the files for its file system, and `postbuild` copies them to `.next/standalone/data/` so `process.cwd()/data` resolves correctly in the standalone server.

The files are:

- `data/talks.json` — master index (~180 talks), read by:
  - `src/app/talks/page.tsx` (SSR at request time — uses `cookies()` for auth check, so cannot be statically generated)
  - `src/app/talk/[rkey]/page.tsx` (`generateStaticParams` provides the rkey list at build time, but pages are SSR'd at request time due to `cookies()`)
  - `src/lib/crawl/crawler.ts` (runtime, cached once per server lifecycle)
- `data/transcripts/*.json` — 128 transcript files, read at request time by `src/app/talk/[rkey]/page.tsx`

**Note:** Despite using `generateStaticParams`, both talk pages call `getAuthUser()` → `cookies()`, which is a dynamic API. This forces Next.js to server-render them on every request rather than statically generating them at build time. The `generateStaticParams` function only provides the list of valid rkeys for routing — it does not enable static generation when dynamic APIs are present.

**To update data:** Run `npm run build-talk-index` and/or `npm run transcribe` locally, commit the updated JSON files, push to `main`. Railway redeploys with the new data.

**The data is static** — it was generated from ATmosphereConf VODs (conference ended April 5, 2026) and won't change unless a re-crawl is needed (e.g., new talks added retroactively).

---

## 7. Verification Plan

### 7.1 Pre-deploy (local)

Before pushing to `staging`:
- [ ] `npm run build` succeeds with `output: "standalone"` — the `.next/standalone/` directory is created
- [ ] The `postbuild` script ran: `.next/standalone/data/`, `.next/standalone/.next/static/`, and `.next/standalone/public/` all exist
- [ ] `npm test` — all 40 scoring tests pass (unrelated to deploy, but confirms nothing broke)
- [ ] `npx tsc --noEmit` — clean
- [ ] `npx eslint src/` — clean
- [ ] `GET /oauth/client-metadata.json` on `localhost:3000` returns valid metadata JSON with `client_id` matching `http://127.0.0.1:3000/oauth/client-metadata.json`
- [ ] OAuth login flow works locally with the self-hosted metadata (no cimd-service)

### 7.2 Post-deploy — staging

Push code to `staging` branch → Railway auto-deploys the staging environment. Using the auto-generated `*.up.railway.app` URL:

- [ ] Landing page loads with correct styles (confirms standalone build + static assets served)
- [ ] `/talks` shows 115+ talk grid (confirms `data/talks.json` was bundled)
- [ ] `/talk/<any-rkey>` shows transcript + HLS video player (confirms transcript JSON files were bundled)
- [ ] `/oauth/client-metadata.json` returns valid metadata with `client_id` matching the staging Railway URL
- [ ] OAuth login flow completes — avatar appears in Nav
- [ ] `/api/crawl` returns `TalkMentions` data (authenticated)
- [ ] Second `/api/crawl` call returns `cached: true` (confirms in-memory cache works)
- [ ] Build logs show no errors or unexpected warnings

### 7.3 Promote to production

After staging passes, merge `staging` → `main`. Railway auto-deploys the production environment.

### 7.4 Post-DNS — production (custom domain)

After pointing `understory.watch` to Railway's production CNAME and DNS propagates:
- [ ] `https://understory.watch` loads with valid SSL certificate
- [ ] Page loads with correct styles (CSS/JS bundles served)
- [ ] `/talks` and `/talk/<any-rkey>` work (data bundled)
- [ ] `/oauth/client-metadata.json` shows `client_id` = `https://understory.watch/oauth/client-metadata.json`
- [ ] Full OAuth flow works on the production domain
- [ ] `/api/crawl` works on the production domain

---

## 8. Edge Cases

- **DNS not propagated yet:** The Railway-generated domain still works as a fallback. The OAuth flow won't work on the custom domain until DNS resolves AND `APP_URL` is updated to the custom domain.
- **Railway cold start:** First request after idle/redeploy takes 2–5 seconds (Node.js startup + module loading + first `fs.readFileSync`). Subsequent requests are fast. Not a concern for this traffic level.
- **Mid-deploy OAuth flow:** A user clicking "Log in" during the ~10 second deploy window gets an error. The in-flight OAuth state is lost. They retry and it works. Acceptable.
- **`data/` directory missing in standalone:** If `outputFileTracingIncludes` doesn't work as expected (unlikely but possible with future Next.js versions), the `/talks` page will crash with `ENOENT`. The verification plan catches this before the custom domain goes live.
- **Cookie not set on Railway domain:** If the browser blocks cookies on `*.up.railway.app` (some aggressive tracker-blockers flag `*.railway.app` subdomains), OAuth won't work on the Railway domain but will work on the custom domain. Not a blocker — the Railway domain is for smoke testing only.

---

## 9. Files Changed

| File | Action | Responsibility |
|------|--------|----------------|
| `next.config.ts` | Modify | Add `output: "standalone"`, `outputFileTracingIncludes`, remove Tailscale dev origin |
| `package.json` | Modify | Add `postbuild` script (copy static/public/data into standalone); change `start` to `node .next/standalone/server.js` |
| `src/lib/auth/metadata.ts` | Create | Shared `buildClientMetadata(appUrl)` function, single source of truth for OAuth metadata |
| `src/app/oauth/client-metadata.json/route.ts` | Create | Self-hosted AT Protocol OAuth client metadata endpoint |
| `src/lib/auth/client.ts` | Modify | Import `buildClientMetadata`, remove `OAUTH_CLIENT_ID` dependency |

5 files touched in the codebase. The rest is Railway CLI/MCP configuration (not committed to git).

---

## 10. Non-goals

- **Redis/database for session persistence.** Sessions are ephemeral by design. `client.restore(did)` transparently re-authenticates on the next request after a redeploy. No user action required.
- **Dockerfile or custom builder.** Railway's Nixpacks auto-detects Next.js and handles the build. No custom config needed.
- **CDN or caching layer.** Railway serves static assets with built-in caching. Dynamic routes are server-rendered per request, which is correct for authenticated endpoints like `/api/crawl`.
- **Health check endpoint.** Railway uses automatic TCP health checks. A custom `/health` route would be dead code.
- **CI/CD pipeline.** Railway auto-deploys from GitHub on push to `main`. No GitHub Actions workflow needed.
- **Monitoring/alerting.** Can be added later if needed. Railway provides basic logs and metrics in its dashboard.
- **Rate limiting.** The Bluesky/Constellation APIs are called server-side per authenticated user. At conference-talk traffic levels, rate limiting is unnecessary.

---

## 11. Acceptance Criteria

### Code
- [ ] `next.config.ts` has `output: "standalone"` and `outputFileTracingIncludes` for `data/`
- [ ] `package.json` has `postbuild` script copying `.next/static`, `public`, `data` into standalone directory
- [ ] `package.json` `start` script is `node .next/standalone/server.js`
- [ ] `src/lib/auth/metadata.ts` exports `buildClientMetadata`, imported by both route handler and `client.ts`
- [ ] `/oauth/client-metadata.json` route exists and returns valid metadata
- [ ] `src/lib/auth/client.ts` uses `buildClientMetadata(appUrl)` (no `OAUTH_CLIENT_ID` env var)
- [ ] `npm run build` produces a working standalone output with `data/`, `.next/static/`, and `public/` present in `.next/standalone/`
- [ ] `npx tsc --noEmit` clean, `npx eslint src/` clean, `npm test` passes

### Railway infrastructure
- [ ] Railway project "understory" exists with a service linked to `musicjunkieg/understory`
- [ ] Two environments configured: staging (deploys from `staging` branch) and production (deploys from `main` branch)
- [ ] `APP_URL` and `HOSTNAME=0.0.0.0` set in both environments (different `APP_URL` values)
- [ ] `staging` branch exists and is pushed to origin

### Staging validation
- [ ] Staging auto-deploys on push to `staging`; build logs clean
- [ ] Landing page, `/talks`, `/talk/[rkey]` all work on the staging Railway domain
- [ ] OAuth flow completes on staging
- [ ] `/api/crawl` returns valid crawl data when authenticated on staging

### Production validation
- [ ] Production auto-deploys on merge to `main`; build logs clean
- [ ] Custom domain `understory.watch` configured with valid SSL
- [ ] Landing page, `/talks`, `/talk/[rkey]` all work on `https://understory.watch`
- [ ] Full OAuth flow works on `https://understory.watch`
- [ ] `/api/crawl` returns valid crawl data when authenticated on production
