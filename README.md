# Understory

A social anti-algorithm for ATmosphereConf 2026 VODs, built on AT Protocol.

`understory.watch` shows you the conference talks your network *missed* — not
the ones it amplified. Where a normal feed surfaces what's loud, Understory
inverts that signal: the brighter a talk glows, the fewer of your follows
engaged with it. The visual metaphor is a forest floor at night —
bioluminescent green for the undiscovered, fading darkness for what your
network already covered.

## How it scores

All scoring runs in the browser. There is no backend scoring server. Three
layers combine into the final glow:

1. **Network attention (inverted).** When you log in, Understory crawls your
   Bluesky follows' posts during the conference window, matches them to
   talks via `community.lexicon.calendar.event` linkage and Constellation
   RSVP backlinks, and inverts the result: high attention → low score → no
   glow. Talks no one in your network discussed glow brightest.
2. **Interest similarity.** Cosine similarity between dense embeddings of
   your recent posts and per-talk transcript embeddings published as
   `watch.understory.topicIndex` records.
3. **Friend overrides.** `watch.understory.recommendation` records published
   to friends' own PDS repos can promote specific talks regardless of how
   much general attention they got.

The three layers are weighted, normalized against the engaged subset of your
follows (not your full follow list — that dilutes everything to near-zero),
and projected onto a continuous CSS `--glow` variable that drives both the
card opacity fade and the multi-layer box-shadow.

## Custom AT Protocol lexicons

Authority NSID: `watch.understory`

| Lexicon | Purpose |
|---|---|
| `watch.understory.talkRef` | Joins `place.stream.video` records to `community.lexicon.calendar.event` |
| `watch.understory.transcript` | Timestamped, speaker-attributed transcript segments |
| `watch.understory.topicIndex` | Dense embeddings + topic labels for interest matching |
| `watch.understory.recommendation` | User-published social recommendations (lives on each user's own PDS) |

## Tech stack

- **Next.js 16** with the App Router, **React 19**, **TypeScript 5**
- **Tailwind CSS 4** with a custom "bioluminescent understory" theme
- **HLS.js** for VOD playback
- **`@atproto/api`** + **`@atproto/oauth-client-node`** for AT Protocol OAuth and PDS calls
- **AssemblyAI** (`universal-3-pro` model) for offline transcript generation
- **Vitest** for testing

## Local development

### Prerequisites

- **Node.js 20+**
- **ffmpeg** (only required if you plan to re-run the transcription pipeline)
- An AssemblyAI API key (only required for transcription)

### First-time setup

```bash
npm install
cp .env.example .env       # if .env.example exists; otherwise see below
```

Create `.env` with at least:

```
APP_URL=http://localhost:3000
ASSEMBLYAI_API_KEY=your-key-here   # only needed for `npm run transcribe`
VOYAGE_API_KEY=your-key-here       # only needed for `npm run embed`
```

`APP_URL` must be your app's public URL — it's used to generate the AT
Protocol OAuth client metadata. Use `http://localhost:3000` for local dev
and your production URL when deployed.

### Run the dev server

```bash
npm run dev
```

The site is then served at `http://localhost:3000`.

For local UI work without the social graph crawl (no Bluesky login needed),
seed mock crawl data and start the server with the mock toggle:

```bash
npx tsx scripts/seed-mock-crawl.ts
MOCK_CRAWL=1 npm run dev
```

### Build for production

Understory builds in Next.js standalone mode and bundles the `data/`
directory (~125 MB of transcripts and talk metadata) into the standalone
output via `outputFileTracingIncludes`.

```bash
npm run build
npm start
```

`npm run build` runs Next's build, then a `postbuild` script copies
`.next/static`, `public/`, and `data/` into `.next/standalone/`. `npm start`
runs the standalone server, which expects `APP_URL` and `HOSTNAME=0.0.0.0`
in production.

### Run tests

```bash
npm test          # vitest run
npm run test:watch
```

### Lint

```bash
npm run lint
```

## Data pipeline

Three scripts in `scripts/` populate `data/`. All write to `data/` directly
and are intended to be run offline, not at request time.

```bash
npm run build-talk-index   # fetches VODs + schedule from AT Protocol → data/talks.json
npm run transcribe         # extracts audio via ffmpeg → AssemblyAI → data/transcripts/{rkey}.json
npm run embed              # voyage-3.5-lite embeddings → data/embeddings/{rkey}.json
npm run embed:check        # smoke check: 3 test queries → top/bottom 5 per query
```

`build-talk-index` matches `place.stream.video` records on `iameli.com`
against `community.lexicon.calendar.event` records on the conference's
schedule repo via explicit `vodAtUri` links, with a fuzzy fallback for
unmatched VODs (timestamp + title similarity).

`transcribe` is idempotent — it skips any rkey that already has a
transcript on disk, so re-running it after deleting specific files only
regenerates those.

`npm run embed` is idempotent — it skips talks whose transcript hash and
configured model haven't changed, so re-runs only re-embed the deltas.
`npm run embed:check` is the post-embed sanity validation: it runs three
test queries through Voyage and prints the top/bottom 5 matches per query
so you can eyeball whether the embeddings carry the semantic signal you
expect.

## Deployment

Deploy target is **Railway**. The full deploy spec lives at
`docs/superpowers/specs/2026-04-10-railway-deploy.md`.

### Branch workflow

Feature PRs target `staging` for Railway validation, then `staging` is
promoted to `main` via a separate PR. **Never PR directly to `main`.**

```
feature/* → staging  (Railway staging environment)
staging   → main     (Railway production environment)
```

Required Railway environment variables:

- `APP_URL` — the public URL (e.g. `https://understory.watch`)
- `HOSTNAME=0.0.0.0` — Next.js standalone server bind address

## Project layout

```
src/
  app/                  Next.js App Router pages and API routes
    api/crawl/          Server-side social graph crawl endpoint
  components/           React components (LumeCard, ScoredTalksGrid, etc.)
  hooks/                Client-side hooks (useCrawlData)
  lib/
    auth/               AT Protocol OAuth client + session management
    crawl/              Network attention crawler (follows, search, RSVPs)
    scoring/            Three-layer scoring engine
data/
  talks.json            Built talk index
  transcripts/          Per-talk transcript JSON (one file per rkey)
scripts/
  build-talk-index.ts   AT Protocol → data/talks.json
  transcribe.ts         HLS → ffmpeg → AssemblyAI → data/transcripts/
docs/
  understory-design.md  Full design spec
  superpowers/          Implementation specs and plans
```

## Credits

- **VODs** are hosted by [Streamplace](https://stream.place) on the
  `iameli.com` PDS. Conference recordings published as `place.stream.video`
  records.
- **Schedule data** comes from the
  [ATmosphereConf](https://atmosphereconf.org) `bsky.social` repo as
  `community.lexicon.calendar.event` records.
- **Backlinks index** for RSVPs is provided by
  [Constellation](https://constellation.microcosm.blue) on microcosm.blue.
- Built on the [AT Protocol](https://atproto.com) and the public
  [Bluesky AppView](https://docs.bsky.app).

## License

[MIT](LICENSE) © 2026 chaos gremlin

---

Made with [Claude Code](https://claude.com/claude-code).
