# Deploy Understory to Railway Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Understory to Railway with staging + production environments, self-hosted OAuth client metadata, and a custom domain (`understory.watch`).

**Architecture:** Code changes (standalone output, postbuild script, shared OAuth metadata builder, metadata route) land on a feature branch, get validated locally, then pushed to staging for Railway validation. Railway infrastructure (project, environments, env vars, domains) is configured via Railway MCP tools/CLI. Production goes live when staging is validated and the custom domain DNS propagates.

**Tech Stack:** Next.js 16 (standalone output), Railway (Nixpacks), AT Protocol OAuth (`@atproto/oauth-client-node`)

**Spec:** `docs/superpowers/specs/2026-04-10-railway-deploy.md`

**Chainlink Issue:** #31

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `next.config.ts` | Modify | Add `output: "standalone"`, `outputFileTracingIncludes` for `data/`, remove Tailscale dev origin |
| `package.json` | Modify | Add `postbuild` script; change `start` to `node .next/standalone/server.js` |
| `src/lib/auth/metadata.ts` | Create | Shared `buildClientMetadata(appUrl)` — single source of truth for OAuth metadata |
| `src/app/oauth/client-metadata.json/route.ts` | Create | Self-hosted AT Protocol OAuth client metadata endpoint |
| `src/lib/auth/client.ts` | Modify | Import `buildClientMetadata`, remove `OAUTH_CLIENT_ID` dependency |

---

## Chunk 1: Code changes (feature branch)

### Task 1: Create the feature branch

- [ ] **Step 1: Create branch**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/railway-deploy
```

---

### Task 2: Next.js standalone config + postbuild script

**Files:**
- Modify: `next.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Read the current `next.config.ts`**

Read `/Users/bryan.guffey/Code/Understory/next.config.ts` and confirm the current contents match:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    viewTransition: true,
  },
  allowedDevOrigins: [
    "127.0.0.1",
    "bryans-mac-mini.wildebeest-puffin.ts.net",
  ],
};

export default nextConfig;
```

- [ ] **Step 2: Update `next.config.ts`**

Replace the config object with:

```ts
import type { NextConfig } from "next";

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

export default nextConfig;
```

Changes:
- Added `output: "standalone"` — Railway needs this for optimized builds
- Added `outputFileTracingIncludes` — tells `@vercel/nft` to include the `data/` directory in the standalone output trace
- Removed `bryans-mac-mini.wildebeest-puffin.ts.net` from `allowedDevOrigins` — Tailscale dev URL shouldn't ship to production

- [ ] **Step 3: Update `package.json` scripts**

Read `package.json` first, then modify the `"scripts"` section. Use `npm pkg set` to non-destructively add/modify scripts:

```bash
npm pkg set scripts.postbuild="cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public && cp -r data .next/standalone/data"
npm pkg set scripts.start="node .next/standalone/server.js"
```

The `postbuild` script runs automatically after `npm run build` (npm lifecycle hook). It copies three things into the standalone directory that Next.js deliberately excludes:
- `.next/static/` — CSS and JS bundles (without these, pages load with no styles or interactivity)
- `public/` — static assets (currently empty, but correct for future use)
- `data/` — talk + transcript JSON files (loaded at runtime via `fs.readFileSync(path.resolve(process.cwd(), "data", ...))`)

The `start` script changes from `next start` to `node .next/standalone/server.js` because standalone mode produces its own server that doesn't need the full Next.js CLI.

- [ ] **Step 4: Verify the build works locally**

Run: `npm run build`

Expected:
- Build succeeds
- `.next/standalone/` directory exists
- `.next/standalone/server.js` exists
- `.next/standalone/.next/static/` exists (from postbuild)
- `.next/standalone/public/` exists (from postbuild)
- `.next/standalone/data/` exists with `talks.json` and `transcripts/` (from postbuild)

Verify the standalone directory contents:

```bash
ls .next/standalone/server.js
ls .next/standalone/.next/static/
ls .next/standalone/data/talks.json
ls .next/standalone/data/transcripts/ | head -5
```

- [ ] **Step 5: Verify existing tests still pass**

Run: `npm test`
Expected: 40/40 tests pass (scoring tests, unrelated to deploy changes but confirms nothing broke).

- [ ] **Step 6: Verify tsc and eslint**

Run in parallel:
- `npx tsc --noEmit` — Expected: clean
- `npx eslint src/` — Expected: clean

- [ ] **Step 7: Commit**

```bash
git add next.config.ts package.json
git commit -m "feat: add standalone output + postbuild script for Railway deploy

- output: 'standalone' for optimized Railway builds
- outputFileTracingIncludes for data/ directory
- postbuild copies .next/static, public, data into standalone dir
- start script changed to node .next/standalone/server.js
- removed Tailscale dev origin from allowedDevOrigins"
```

---

### Task 3: Shared OAuth metadata builder

**Files:**
- Create: `src/lib/auth/metadata.ts`

- [ ] **Step 1: Create the shared metadata module**

Create `src/lib/auth/metadata.ts`:

```ts
/**
 * Shared AT Protocol OAuth client metadata builder.
 *
 * Used by both the client-metadata.json route handler (serves the metadata
 * to PDS servers during the OAuth flow) and the NodeOAuthClient constructor
 * (uses the metadata locally for the authorization handshake). Defined once
 * here so the two can never drift — drift causes cryptic OAuth mismatch errors.
 */

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
    application_type: "web" as const,
    dpop_bound_access_tokens: true,
    token_endpoint_auth_method: "none" as const,
  };
}
```

The `as const` assertions on `application_type` and `token_endpoint_auth_method` are needed because the metadata is now built in a separate function (not inline in the `NodeOAuthClient` constructor). Without contextual typing from the call site, TypeScript widens `"web"` and `"none"` to `string`, which won't match the SDK's union-of-literal types (`"web" | "native"`, `"none" | "client_secret_post" | ...`). The `as const` keeps them as string literals. The other array fields (`redirect_uris`, `grant_types`, `response_types`) must remain mutable (no top-level `as const`) because the SDK's Zod input types expect mutable tuples. If `tsc --noEmit` passes without the `as const` assertions, they can be safely removed — the verification step will tell you.

- [ ] **Step 2: Verify tsc is clean**

Run: `npx tsc --noEmit`
Expected: clean.

---

### Task 4: Self-hosted client metadata route

**Files:**
- Create: `src/app/oauth/client-metadata.json/route.ts`

- [ ] **Step 1: Create the route directory**

```bash
mkdir -p src/app/oauth/client-metadata.json
```

> **Note:** The folder name contains a literal dot (`.json`). This is intentional — Next.js App Router treats directory names as route segments, so this creates a route at `/oauth/client-metadata.json`. The dot is legal in directory names on all platforms. If any build tooling issue arises, the fallback is to rename to `client-metadata/` and update `CLIENT_METADATA_PATH` in `metadata.ts`.

- [ ] **Step 2: Create the route handler**

Create `src/app/oauth/client-metadata.json/route.ts`:

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

- [ ] **Step 3: Verify the route works locally**

Start the dev server: `npm run dev` (in another terminal or background).

Then:
```bash
curl http://127.0.0.1:3000/oauth/client-metadata.json
```

Expected: JSON response with `client_id` = `http://127.0.0.1:3000/oauth/client-metadata.json`, `redirect_uris` = `["http://127.0.0.1:3000/oauth/callback"]`, etc.

If the route returns 404, the dot-in-folder-name isn't working. Use the fallback: rename the directory to `client-metadata/` (no `.json`), update `CLIENT_METADATA_PATH` in `metadata.ts` to `"/oauth/client-metadata"`, and re-test.

Stop the dev server after verification.

- [ ] **Step 4: Verify tsc and eslint**

Run in parallel:
- `npx tsc --noEmit` — Expected: clean
- `npx eslint src/` — Expected: clean

---

### Task 5: Update OAuth client to use shared metadata

**Files:**
- Modify: `src/lib/auth/client.ts`

- [ ] **Step 1: Read the current file**

Read `src/lib/auth/client.ts`. Current contents (for reference):

```ts
import { NodeOAuthClient } from "@atproto/oauth-client-node";
import type { NodeSavedState, NodeSavedSession } from "@atproto/oauth-client-node";

const stateStore = new Map<string, NodeSavedState>();
const sessionStore = new Map<string, NodeSavedSession>();

function createClient(): NodeOAuthClient {
  const clientId = process.env.OAUTH_CLIENT_ID;
  const appUrl = process.env.APP_URL;

  if (!clientId || !appUrl) {
    throw new Error(
      "Missing OAUTH_CLIENT_ID or APP_URL environment variables. " +
        "See docs/superpowers/specs/2026-04-06-oauth.md for setup instructions.",
    );
  }

  return new NodeOAuthClient({
    clientMetadata: {
      client_id: clientId,
      client_name: "Understory (Development)",
      client_uri: appUrl,
      redirect_uris: [`${appUrl}/oauth/callback`],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "atproto transition:generic",
      application_type: "web",
      dpop_bound_access_tokens: true,
      token_endpoint_auth_method: "none",
    },
    stateStore: { ... },   // full Map-backed implementation — preserved in Step 2
    sessionStore: { ... }, // full Map-backed implementation — preserved in Step 2
  });
}

// globalThis.__oauthClient caching pattern also present — preserved in Step 2
```

> **Note:** The snippet above truncates the stateStore, sessionStore, and globalThis caching pattern for brevity. Step 2's "After" code includes the complete implementations of all three. They are preserved unchanged.

- [ ] **Step 2: Rewrite `createClient` to use `buildClientMetadata`**

Replace the entire file with:

```ts
import { NodeOAuthClient } from "@atproto/oauth-client-node";
import type {
  NodeSavedState,
  NodeSavedSession,
} from "@atproto/oauth-client-node";
import { buildClientMetadata } from "./metadata";

const stateStore = new Map<string, NodeSavedState>();
const sessionStore = new Map<string, NodeSavedSession>();

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
    stateStore: {
      async get(key: string) {
        return stateStore.get(key);
      },
      async set(key: string, value: NodeSavedState) {
        stateStore.set(key, value);
      },
      async del(key: string) {
        stateStore.delete(key);
      },
    },
    sessionStore: {
      async get(sub: string) {
        return sessionStore.get(sub);
      },
      async set(sub: string, value: NodeSavedSession) {
        sessionStore.set(sub, value);
      },
      async del(sub: string) {
        sessionStore.delete(sub);
      },
    },
  });
}

// Cache on globalThis to survive Next.js hot reload
declare global {
  var __oauthClient: NodeOAuthClient | undefined;
}

export function getOAuthClient(): NodeOAuthClient {
  if (!globalThis.__oauthClient) {
    globalThis.__oauthClient = createClient();
  }
  return globalThis.__oauthClient;
}
```

Key changes:
- Removed `OAUTH_CLIENT_ID` env var — `client_id` is now derived from `APP_URL` via `buildClientMetadata`
- Imported `buildClientMetadata` from `./metadata` (shared source of truth)
- Updated error message to reference only `APP_URL`
- `client_name` is now `"Understory"` (via the builder, not `"Understory (Development)"`)

- [ ] **Step 3: Update local `.env`**

Edit `.env` to remove `OAUTH_CLIENT_ID`:

```
APP_URL=http://127.0.0.1:3000
ASSEMBLYAI_API_KEY=<your-key-here>
```

> **Note:** `.env` is gitignored — this change is local only.

- [ ] **Step 4: Verify the full OAuth flow locally**

Start the dev server: `npm run dev`

1. Open `http://127.0.0.1:3000`
2. Click "Log in"
3. Enter a Bluesky handle
4. Complete the OAuth flow (redirects to PDS → back to callback)
5. Verify: avatar appears in the Nav
6. Verify: `/api/crawl` returns data (authenticated)

If the OAuth flow fails, check:
- Does `curl http://127.0.0.1:3000/oauth/client-metadata.json` return valid metadata with matching `client_id`?
- Is `APP_URL=http://127.0.0.1:3000` in `.env`?
- Restart the dev server after `.env` changes (Next.js caches env vars)

Stop the dev server after verification.

- [ ] **Step 5: Verify tsc, eslint, and tests**

Run in parallel:
- `npx tsc --noEmit` — Expected: clean
- `npx eslint src/` — Expected: clean
- `npm test` — Expected: 40/40 pass

- [ ] **Step 6: Run a full production build and verify**

Run: `npm run build`

Expected: build succeeds, standalone output created with all three copied directories.

Verify the build output includes the metadata route:

```
Route (app)
...
├ ƒ /oauth/client-metadata.json   ← NEW
...
```

- [ ] **Step 7: Commit all OAuth changes together**

```bash
git add src/lib/auth/metadata.ts \
        src/app/oauth/client-metadata.json/route.ts \
        src/lib/auth/client.ts
git commit -m "feat: self-hosted OAuth client metadata, drop OAUTH_CLIENT_ID

- metadata.ts: shared buildClientMetadata(appUrl) function, single source
  of truth imported by both the metadata route and NodeOAuthClient.
- /oauth/client-metadata.json route: serves metadata JSON to PDS servers
  during the OAuth authorization flow.
- client.ts: derives client_id from APP_URL instead of reading a separate
  OAUTH_CLIENT_ID env var. client_name updated to 'Understory'.
- Eliminates the cimd-service.fly.dev dependency for auth."
```

---

## Chunk 2: Railway infrastructure

### Task 6: Create Railway project and environments

This task uses Railway MCP tools or CLI. No git commits — infrastructure is configured out-of-band.

- [ ] **Step 1: Check Railway CLI is authenticated**

```bash
railway whoami
```

Expected: shows your Railway account. If not authenticated, run `railway login`.

- [ ] **Step 2: Create the Railway project**

Use the Railway MCP tool `create-project-and-link` or CLI:

```bash
railway init
```

Name the project "understory". Link it to the GitHub repo `musicjunkieg/understory`.

Alternatively, use the MCP tool:
- Tool: `mcp__railway-mcp-server__create-project-and-link`
- Project name: "understory"

- [ ] **Step 3: Create staging environment**

Use the Railway MCP tool `create-environment`:
- Name: "staging"
- Source branch: `staging`

Or via CLI:
```bash
railway environment create staging
```

- [ ] **Step 4: Create the `staging` branch and push it**

```bash
git checkout main
git checkout -b staging
git push -u origin staging
git checkout feat/railway-deploy
```

This creates the `staging` branch (initially identical to `main`) so Railway's staging environment has a branch to track.

- [ ] **Step 5: Generate a domain for the staging environment**

Use the MCP tool `generate-domain` for the staging environment, or check the Railway dashboard for the auto-generated domain.

Note the domain (e.g., `understory-staging-abc123.up.railway.app`) — it's needed for the `APP_URL` env var in the next step.

- [ ] **Step 6: Set environment variables — staging**

Switch Railway context to staging, then set env vars using the domain from Step 5:

Use the MCP tool `set-variables` for the staging environment, or:

```bash
railway link --environment staging
railway variables set APP_URL=https://<staging-domain-from-step-5>.up.railway.app
railway variables set HOSTNAME=0.0.0.0
```

- [ ] **Step 7: Set environment variables — production**

Switch Railway context to production:

```bash
railway link --environment production
railway variables set APP_URL=https://understory.watch
railway variables set HOSTNAME=0.0.0.0
```

---

### Task 7: Push to staging and validate

- [ ] **Step 1: Merge feature branch into staging**

```bash
git checkout staging
git merge feat/railway-deploy
git push
```

Railway auto-deploys the staging environment.

- [ ] **Step 2: Monitor the deploy**

Use the MCP tool `list-deployments` or:

```bash
railway logs --environment staging
```

Wait for the deploy to succeed. Check build logs for:
- `next build` succeeds
- `postbuild` script runs (copies static/public/data)
- Server starts on the assigned port

- [ ] **Step 3: Validate staging — pages**

Using the staging `*.up.railway.app` URL:

1. Hit the landing page — should load with full styles
2. Hit `/talks` — should show 115+ talk grid
3. Hit `/talk/<any-rkey>` — should show transcript + HLS video player

If pages load without styles → postbuild didn't copy `.next/static/`. Check build logs.
If `/talks` crashes with ENOENT → postbuild didn't copy `data/`. Check build logs.

- [ ] **Step 4: Validate staging — OAuth metadata**

```bash
curl https://<staging-domain>.up.railway.app/oauth/client-metadata.json
```

Expected: JSON with `client_id` matching the staging URL.

- [ ] **Step 5: Validate staging — OAuth flow**

1. Open the staging URL in a browser
2. Click "Log in"
3. Enter a Bluesky handle
4. Complete the OAuth flow
5. Verify: avatar appears in Nav
6. Hit `/api/crawl` in the browser console: `fetch('/api/crawl').then(r => r.json()).then(d => console.log(d))`

If OAuth fails with a redirect mismatch → `APP_URL` in Railway doesn't match the actual staging domain. Update it and redeploy.

- [ ] **Step 6: Validate staging — cache**

Hit `/api/crawl` again. Should return `cached: true`.

---

### Task 8: Configure production domain and promote

- [ ] **Step 1: Add custom domain to Railway production**

Use the Railway dashboard or MCP tools to add `understory.watch` as a custom domain for the production environment. Railway will provide a CNAME target.

- [ ] **Step 2: Configure DNS at your registrar**

At your registrar, create a CNAME record:

```
understory.watch → <cname-target-from-railway>
```

Railway auto-provisions an SSL certificate via Let's Encrypt once DNS resolves.

- [ ] **Step 3: Promote staging to production**

```bash
git checkout main
git merge staging
git push
```

Railway auto-deploys the production environment.

- [ ] **Step 4: Wait for DNS propagation**

Check propagation:

```bash
dig understory.watch CNAME
```

Expected: shows the Railway CNAME target. DNS propagation typically takes 5–30 minutes.

- [ ] **Step 5: Validate production**

Once DNS resolves:

1. `https://understory.watch` loads with valid SSL certificate (check the padlock)
2. `/talks` shows the talk grid with full styles
3. `/talk/<any-rkey>` shows transcript + HLS video
4. `/oauth/client-metadata.json` shows `client_id` = `https://understory.watch/oauth/client-metadata.json`
5. Full OAuth flow completes — login, avatar in Nav, `/api/crawl` returns data
6. Second `/api/crawl` call returns `cached: true`

- [ ] **Step 6: Clean up the feature branch**

```bash
git branch -d feat/railway-deploy
git push origin --delete feat/railway-deploy
```

---

### Task 9: Final verification and wrap-up

- [ ] **Step 1: Confirm all acceptance criteria**

Walk through spec §11 acceptance criteria:

**Code:**
- [ ] `next.config.ts` has `output: "standalone"` and `outputFileTracingIncludes`
- [ ] `package.json` has `postbuild` script and standalone `start` command
- [ ] `src/lib/auth/metadata.ts` exports `buildClientMetadata`
- [ ] `/oauth/client-metadata.json` route works
- [ ] `client.ts` uses `buildClientMetadata(appUrl)` (no `OAUTH_CLIENT_ID`)
- [ ] Build produces standalone output with data + static + public
- [ ] tsc clean, eslint clean, tests pass

**Infrastructure:**
- [ ] Railway project "understory" exists
- [ ] Staging environment deploys from `staging` branch
- [ ] Production environment deploys from `main` branch
- [ ] Env vars set in both environments

**Staging:**
- [ ] Staging auto-deploys and all features work

**Production:**
- [ ] `https://understory.watch` loads with valid SSL
- [ ] OAuth + crawl work on production

- [ ] **Step 2: Use the finishing-a-development-branch skill**

Since the feature branch was already merged into `staging` → `main` and deleted in Task 8 Step 6, the finishing skill's main value here is confirming everything is wrapped up. The work is already live.

Invoke `superpowers:finishing-a-development-branch` to formally close out.
