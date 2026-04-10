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

### 3.2 `src/app/oauth/client-metadata.json/route.ts` — self-hosted client metadata

The AT Protocol OAuth spec requires that `client_id` is a URL that resolves to a JSON document containing the client metadata. PDS servers fetch this URL during the authorization flow to validate the client.

Previously, this metadata was hosted on `cimd-service.fly.dev` (a shared dev-only service). For production, Understory self-hosts its metadata at `https://understory.watch/oauth/client-metadata.json`.

**Route path:** `src/app/oauth/client-metadata.json/route.ts`

This creates a Next.js route handler at `/oauth/client-metadata.json`. The route reads `APP_URL` from the environment and returns the metadata JSON with the correct `client_id` (self-referencing URL) and `redirect_uris`.

```ts
import { NextResponse } from "next/server";

export async function GET() {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    return NextResponse.json(
      { error: "APP_URL not configured" },
      { status: 500 },
    );
  }

  const clientId = `${appUrl}/oauth/client-metadata.json`;

  return NextResponse.json({
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
  });
}
```

**Why a route handler and not a static JSON file:** The `client_id` and `redirect_uris` contain the app's URL, which varies by environment (localhost in dev, `understory.watch` in production). A dynamic route reads `APP_URL` at request time so the same code works everywhere without build-time substitution.

**Content-Type:** `NextResponse.json()` automatically sets `Content-Type: application/json`, which is what PDS servers expect.

### 3.3 `src/lib/auth/client.ts` — derive `client_id` from `APP_URL`

Replace the `OAUTH_CLIENT_ID` environment variable with a derived value. Since the client metadata is now self-hosted at `${APP_URL}/oauth/client-metadata.json`, the `client_id` is always predictable from `APP_URL`.

**Changes:**

1. Remove the `OAUTH_CLIENT_ID` env var check — it's no longer needed.
2. Derive `clientId` from `appUrl`:
   ```ts
   const clientId = `${appUrl}/oauth/client-metadata.json`;
   ```
3. Update `client_name` from `"Understory (Development)"` to `"Understory"`.
4. The `clientMetadata` object passed to `NodeOAuthClient` must exactly match what the route in §3.2 serves, because PDS servers compare the fetched metadata against what the client claims during the auth flow. Both read from the same `APP_URL` value, so they'll always agree.

**After:**
```ts
function createClient(): NodeOAuthClient {
  const appUrl = process.env.APP_URL;

  if (!appUrl) {
    throw new Error(
      "Missing APP_URL environment variable. " +
        "Set to your app's public URL (e.g., https://understory.watch).",
    );
  }

  const clientId = `${appUrl}/oauth/client-metadata.json`;

  return new NodeOAuthClient({
    clientMetadata: {
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
    },
    // ... stateStore and sessionStore unchanged
  });
}
```

### 3.4 `.env` update for local development

Update the local `.env` to remove `OAUTH_CLIENT_ID` (no longer used) and ensure `APP_URL` is set:

```
APP_URL=http://127.0.0.1:3000
ASSEMBLYAI_API_KEY=<kept for offline transcription scripts>
```

The `.env` file is gitignored (not committed). This change is documented so developers know what to set after cloning.

---

## 4. Railway Infrastructure

### 4.1 Create project and service

Using Railway MCP tools or CLI:

1. Create a new Railway project named "understory"
2. Create a service linked to the GitHub repo `musicjunkieg/understory` on the `main` branch
3. Railway auto-detects Next.js and uses its Node.js builder (Nixpacks)
4. Auto-deploy on push to `main` is enabled by default

### 4.2 Environment variables

Set in Railway's service environment:

| Variable | Value | Notes |
|---|---|---|
| `APP_URL` | `https://understory.watch` | The only required env var. Initially use the Railway-generated `*.up.railway.app` domain for smoke testing, then switch to the custom domain. |

`NODE_ENV=production` is set automatically by Railway. `ASSEMBLYAI_API_KEY` is not needed at runtime (only for offline build scripts).

### 4.3 Domain configuration

**Phase 1 — Railway domain (smoke test):**
Railway auto-generates a `*.up.railway.app` domain. Use this for initial verification. Temporarily set `APP_URL` to this domain.

**Phase 2 — Custom domain:**
1. Add `understory.watch` as a custom domain in Railway
2. Railway provides a CNAME target (e.g., `<hash>.railway.app`)
3. At your registrar, create a CNAME record: `understory.watch` → `<railway-cname-target>`
4. Railway auto-provisions an SSL certificate via Let's Encrypt
5. Update `APP_URL` to `https://understory.watch`
6. DNS propagation typically takes 5–30 minutes

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

The `data/` directory (125MB) is included in every deploy via `outputFileTracingIncludes`. The files are:

- `data/talks.json` — master index (~180 talks), read by:
  - `src/app/talks/page.tsx` (SSG at build time)
  - `src/app/talk/[rkey]/page.tsx` (`generateStaticParams` at build time)
  - `src/lib/crawl/crawler.ts` (runtime, cached once per server lifecycle)
- `data/transcripts/*.json` — 128 transcript files, read at runtime by `src/app/talk/[rkey]/page.tsx`

**To update data:** Run `npm run build-talk-index` and/or `npm run transcribe` locally, commit the updated JSON files, push to `main`. Railway redeploys with the new data.

**The data is static** — it was generated from ATmosphereConf VODs (conference ended April 5, 2026) and won't change unless a re-crawl is needed (e.g., new talks added retroactively).

---

## 7. Verification Plan

### 7.1 Pre-deploy (local)

Before pushing:
- [ ] `npm run build` succeeds with `output: "standalone"` — the `.next/standalone/` directory is created
- [ ] `npm test` — all 40 scoring tests pass (unrelated to deploy, but confirms nothing broke)
- [ ] `npx tsc --noEmit` — clean
- [ ] `npx eslint src/` — clean
- [ ] `GET /oauth/client-metadata.json` on `localhost:3000` returns valid metadata JSON with `client_id` matching `http://127.0.0.1:3000/oauth/client-metadata.json`
- [ ] OAuth login flow works locally with the self-hosted metadata (no cimd-service)

### 7.2 Post-deploy (Railway domain)

Using the auto-generated `*.up.railway.app` URL:
- [ ] Landing page loads (confirms build + serve work)
- [ ] `/talks` shows 115+ talk grid (confirms `data/talks.json` was bundled)
- [ ] `/talk/<any-rkey>` shows transcript + HLS video player (confirms transcript JSON files were bundled)
- [ ] `/oauth/client-metadata.json` returns valid metadata with correct `client_id` URL
- [ ] OAuth login flow completes — avatar appears in Nav
- [ ] `/api/crawl` returns `TalkMentions` data (authenticated)
- [ ] Second `/api/crawl` call returns `cached: true` (confirms in-memory cache works)
- [ ] Build logs show no errors or unexpected warnings

### 7.3 Post-DNS (custom domain)

After pointing `understory.watch` to Railway:
- [ ] `https://understory.watch` loads with valid SSL certificate
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
| `src/app/oauth/client-metadata.json/route.ts` | Create | Self-hosted AT Protocol OAuth client metadata endpoint |
| `src/lib/auth/client.ts` | Modify | Derive `client_id` from `APP_URL`, remove `OAUTH_CLIENT_ID` dependency, update `client_name` |

3 files touched in the codebase. The rest is Railway CLI/MCP configuration (not committed to git).

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

- [ ] Railway project "understory" exists with a service linked to `musicjunkieg/understory`
- [ ] `APP_URL` environment variable set in Railway
- [ ] `next.config.ts` has `output: "standalone"` and `outputFileTracingIncludes` for `data/`
- [ ] `/oauth/client-metadata.json` route exists and returns valid metadata
- [ ] `src/lib/auth/client.ts` derives `client_id` from `APP_URL` (no `OAUTH_CLIENT_ID` env var)
- [ ] `npm run build` produces a working standalone output
- [ ] Railway deploy succeeds automatically on push
- [ ] Landing page, `/talks`, `/talk/[rkey]`, and OAuth flow all work on the Railway domain
- [ ] Custom domain `understory.watch` configured with valid SSL
- [ ] Full OAuth flow works on `https://understory.watch`
- [ ] `npx tsc --noEmit` clean, `npx eslint src/` clean, `npm test` passes
