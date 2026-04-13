# Transcript Embeddings Design Spec

**Date:** 2026-04-13
**Issue:** Chainlink #21 (Generate transcript embeddings)
**Status:** Approved (pending review)
**Depends on:** None — all 108 transcripts already exist on disk under `data/transcripts/`
**Unblocks:** #23 (User interest profiling), #24 (Cosine similarity matching), and the layer-2 implementation in `src/lib/scoring/`

---

## 1. Goal

Produce one dense semantic vector per ATmosphereConf 2026 talk transcript and persist it to disk so the in-browser scoring engine can later compute cosine similarity between a user's interest profile and each talk. Layer 2 of the three-layer scoring engine is currently a stub (`src/lib/scoring/interestStub.ts`); this work is the **data-production half** of replacing that stub. The matching half lives in #23 and #24.

After this work lands, every talk that has a transcript will have a corresponding embedding file with full content-addressable idempotency, and a one-shot smoke check will prove the embeddings carry meaningful semantic signal.

---

## 2. Background

Understory's three-layer client-side scoring engine combines:

1. **Network attention (inverted)** — already shipped, runs in the browser against AT Protocol crawl data
2. **Interest similarity** — currently `computeInterestStub` returns `0`, gated on this work
3. **Friend overrides** — currently `computeFriendStub` returns `0`, gated on the friend-recommendation lexicon

Layer 2 needs two inputs at run time:

- **One vector per talk**, derived from each talk's transcript. *Static, computed offline. This spec.*
- **One vector per user**, derived from the user's recent Bluesky posts. *Computed on every login, see #23.*

Then it computes cosine similarity between the user vector and each talk vector and contributes the result to the talk's overall intensity score (#24).

The custom AT Protocol lexicon `watch.understory.topicIndex` (defined in `docs/understory-design.md`) commits us to a single dense embedding per talk, packed as a `bytes` field with `maxLength: 8192`. With float32 (4 bytes per element), that is a **hard ceiling of 2048 dimensions**. The chosen model — `voyage-3.5-lite`, 1024 dimensions — uses half of that budget and fits cleanly.

We have 108 talks with transcripts on disk after the recent re-sync (#45). Total transcript audio time is approximately 37.5 hours. Per-talk transcript text averages 30–50k characters (~7.5–12.5k tokens). The largest 90-minute talks come in around 12–15k tokens, well inside `voyage-3.5-lite`'s 32k input token limit, so **no chunking is required** — we embed each transcript as a single document.

---

## 3. Decisions and Rationale

### 3.1 Embedding model: `voyage-3.5-lite`

| Decision | Value |
|---|---|
| Model | `voyage-3.5-lite` |
| Dimensions | 1024 |
| Input limit | 32k tokens per request |
| Pricing tier | Cheapest in Voyage's lineup; full 108-talk run ≈ $0.03 |

**Why Voyage over OpenAI**: Voyage's models consistently outrank OpenAI's `text-embedding-3-*` on MTEB retrieval benchmarks. Voyage's API supports asymmetric `input_type: "document"` vs `input_type: "query"`, which exactly matches our pattern (long-form indexed talks vs short-form user-post-derived queries) and is what the model is trained for. OpenAI does not have this distinction. Bryan already maintains a Voyage account on another project, so no new vendor relationship.

**Why `voyage-3.5-lite` over `voyage-3.5` or `voyage-3-large`**: All three are 1024-dim, all three fit the same lexicon budget. `voyage-3.5-lite` is the cost-optimized member of the same family; the marginal quality gain from upgrading is not load-bearing for ~100 talks against a single user profile, and swapping models later is a one-line config change with no schema impact. YAGNI applies.

### 3.2 Storage strategy: hybrid (local first, AT Protocol later)

Generate embeddings into local files under `data/embeddings/{rkey}.json`, mirroring the existing `data/transcripts/{rkey}.json` pattern. These files become part of the Next.js standalone bundle automatically via the existing `outputFileTracingIncludes: { "/*": ["./data/**/*"] }` in `next.config.ts` — **no config change required**.

Publishing the same embeddings to a `watch.understory.topicIndex` AT Protocol record on a project PDS is the job of #22, which can read directly from these local files without needing to re-run Voyage. The local file becomes the source of truth that the publisher reads from.

### 3.3 File layout: per-rkey, not single bundled file

One file per talk in `data/embeddings/{rkey}.json`, mirroring the transcripts pattern. Per-talk files give us:

- **Scoped PR diffs.** Re-embedding only Eli's re-cuts touches 79 files instead of dumping a 1.5 MB unreadable diff into a single bundled file.
- **Idempotent script behavior.** The script can use `fs.existsSync` per talk, just like `transcribe.ts` does.
- **Selective regeneration.** Deleting individual files forces re-embedding without running through the whole list.
- **Pattern consistency.** New contributors immediately recognize the layout from the transcript directory.

Total disk cost: 108 files × ~12 KB each ≈ 1.3 MB. Negligible.

### 3.4 Scope: embeddings only, not topic extraction

The `watch.understory.topicIndex` lexicon has two computed fields: `embedding` (the vector) and `topics` (an array of `{label, weight}` for human-readable theme labels). Topic extraction is a separate LLM-based task with its own API dependency (Claude or similar), prompt design, and cost profile.

This spec scopes #21 to **embeddings only**. Topic extraction will be filed as a separate followup issue. Layer 2 of the scoring engine only needs the embedding vector — topics are downstream UX (filter chips, theme labels) that do not gate the layer-2 implementation. The local file shape is forward-compatible: adding a `topics` field later does not break existing consumers.

### 3.5 HTTP client: direct `fetch`, no SDK dependency

Use Node's built-in `fetch` to hit `https://api.voyageai.com/v1/embeddings` directly. The Voyage REST API is simple enough that an SDK adds dependency surface for very little payoff. One less package to audit, version, and update.

### 3.6 Idempotency: content-addressable via SHA-256

Every embedding file stores `transcriptHash`, the SHA-256 of the exact bytes we sent to Voyage (post-truncation if any). On re-runs, the script:

1. Loads the existing `data/embeddings/{rkey}.json` if present
2. Hashes the current transcript text from `data/transcripts/{rkey}.json`
3. **Skips** if `existing.transcriptHash === current_hash` AND `existing.model === configured_model`
4. **Re-embeds** in any other case (file missing, hash mismatch, model upgrade)

This solves the failure mode we just lived through with the talks resync: when a talk's transcript content changes (Eli re-cuts a VOD → we re-transcribe), the embedding is automatically detected as stale and regenerated. No manual `rm` step required. The same mechanism handles model upgrades cleanly: bumping `voyage-3.5-lite` → `voyage-3.5` invalidates everything atomically.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│    OFFLINE PIPELINE  (npm run embed)                                │
│                                                                     │
│    ┌─────────────────────┐         ┌──────────────────────┐        │
│    │ data/talks.json     │────────▶│ scripts/embed.ts     │        │
│    │ (108 rkeys)         │         │                      │        │
│    └─────────────────────┘         │  for each rkey:      │        │
│                                    │   load transcript    │        │
│    ┌─────────────────────┐         │   hash text          │        │
│    │ data/transcripts/   │────────▶│   compare to file    │        │
│    │   {rkey}.json       │         │   queue if dirty     │        │
│    └─────────────────────┘         │                      │        │
│                                    │  batch 32 at a time  │        │
│                                    │   POST voyage API    │        │
│                                    │   (input_type=doc)   │        │
│                                    │                      │        │
│                                    │  per result:         │        │
│                                    │   write JSON file    │        │
│                                    └──────────────────────┘        │
│                                              │                     │
│                                              ▼                     │
│                              ┌─────────────────────────┐           │
│                              │ data/embeddings/        │           │
│                              │   {rkey}.json           │           │
│                              │   (108 files, ~1.3 MB)  │           │
│                              └─────────────────────────┘           │
│                                              │                     │
│    SMOKE CHECK  (npm run embed:check)        │                     │
│                                              ▼                     │
│    ┌─────────────────────┐         ┌──────────────────────┐        │
│    │ scripts/            │         │ load all embeddings  │        │
│    │   embed-smoke.ts    │────────▶│ embed test queries   │        │
│    │                     │         │   (input_type=query) │        │
│    │ test queries:       │         │ cosine similarity    │        │
│    │ - "decentralized    │         │ print top/bottom 5   │        │
│    │    identity..."     │         │ assert sanity gates  │        │
│    │ - "moderation..."   │         └──────────────────────┘        │
│    │ - "federated..."    │                                         │
│    └─────────────────────┘                                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

Layer-2 runtime consumption (NOT in this spec — see #24):
  data/embeddings/*.json  ─→  src/lib/scoring/embeddings.ts (loader)
                          ─→  src/lib/scoring/cosine.ts (math, in this spec)
                          ─→  computeInterestStub() replacement
```

---

## 5. Data shape

### 5.1 Per-talk embedding file: `data/embeddings/{rkey}.json`

```jsonc
{
  "rkey": "3mi54oonum62b",
  "model": "voyage-3.5-lite",
  "dimensions": 1024,
  "vector": [0.0234, -0.1812, 0.0517, /* ... 1021 more floats ... */ 0.0091],
  "transcriptHash": "sha256-3a7b8f29e4c6...",
  "truncated": false,
  "generatedAt": "2026-04-13T05:42:11.000Z"
}
```

| Field | Type | Notes |
|---|---|---|
| `rkey` | string | Talk record key, matches the transcript filename |
| `model` | string | The Voyage model identifier — invalidates the file on upgrade |
| `dimensions` | number | 1024 for `voyage-3.5-lite`. Exposed so consumers can validate at load time |
| `vector` | `number[]` | Length must equal `dimensions`. Stored as plain JSON numbers, not packed bytes — readable in PR diffs and `jq`-compatible |
| `transcriptHash` | string | `sha256-` prefix + hex digest of the bytes actually sent to Voyage (post-truncation). Idempotency key. |
| `truncated` | boolean | `true` only if the source transcript exceeded the safe character limit and was truncated before embedding. Defaults to `false`. |
| `generatedAt` | string | ISO 8601 timestamp. Diagnostic only — not used for idempotency |

The file is intentionally a **flat single-object JSON** rather than wrapped in a nested envelope: it's readable, diffable, and `jq`-compatible without ceremony.

### 5.2 TypeScript types (used by both `embed.ts` and `embed-smoke.ts`)

```ts
// scripts/lib/embedding-types.ts (new)

export interface EmbeddingFile {
  rkey: string;
  model: string;
  dimensions: number;
  vector: number[];
  transcriptHash: string;
  truncated: boolean;
  generatedAt: string;
}

export interface VoyageEmbedRequest {
  input: string[];
  model: string;
  input_type: "document" | "query";
}

export interface VoyageEmbedResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}
```

These types live in a small `scripts/lib/` directory shared between the two scripts. Promoted to a `src/lib/scoring/` types file in #24 if needed.

---

## 6. Pipeline script — `scripts/embed.ts`

### 6.1 Configuration constants

```ts
const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3.5-lite";
const DIMENSIONS = 1024;
const BATCH_SIZE = 32;
const SAFE_CHAR_LIMIT = 120_000; // ~30k tokens, leaves headroom under voyage's 32k cap
```

`SAFE_CHAR_LIMIT` is deliberately conservative. Voyage will reject inputs over its real token limit; we truncate to a character count well below the boundary so we never round-trip a rejection in normal operation.

### 6.2 Flow

1. **Discover talks.** Read `data/talks.json`. Filter to entries with `transcriptFile != null` (currently 108).

2. **Build the work queue.** For each candidate rkey:
   - Read `data/transcripts/{rkey}.json`. Extract the `transcription.text` field — the full clean transcript string from AssemblyAI.
   - If the text length exceeds `SAFE_CHAR_LIMIT`, truncate to that limit and remember `truncated = true`. Otherwise `truncated = false`.
   - Compute the SHA-256 hash of the (possibly truncated) text, prefixed with `"sha256-"`.
   - Read the existing `data/embeddings/{rkey}.json` if present.
   - **Skip** if `existing.transcriptHash === computed_hash` AND `existing.model === MODEL`. Increment a `skipped` counter.
   - Otherwise queue the talk with `{rkey, text, transcriptHash, truncated}`.

3. **Batch and embed.** Group the queue into chunks of `BATCH_SIZE = 32`. For each chunk:
   - Build a `VoyageEmbedRequest` with `input: chunk.map(t => t.text)`, `model: MODEL`, `input_type: "document"`.
   - `POST` to `VOYAGE_API_URL` with `Authorization: Bearer ${process.env.VOYAGE_API_KEY}`.
   - Validate the response shape against `VoyageEmbedResponse`. Reject with a clear error on shape mismatch.
   - Validate that `data.length === chunk.length` and each vector has exactly `DIMENSIONS` elements.
   - For each result, write `data/embeddings/{rkey}.json` with the file shape from §5.1. Use `data[i].index` to associate the result with its input talk (Voyage may not preserve order — always trust `index`).
   - Print `[done] "{title}"` per talk.

4. **Per-batch error handling.** Wrap the batch fetch + write in `try/catch`. On any exception:
   - Log the error message and the rkeys in the failed batch.
   - Continue with the next batch. **Do not abort the whole run.**
   - Increment a `failed` counter.

5. **Final summary.** Print:
   ```
   Found N talks with transcripts
   Skipped X already embedded (hash matched)
   Embedded Y new talks
   Failed Z batches (see above for details)
   Truncated T talks (logged)
   ```
   Exit code 0 if `failed === 0`, exit code 1 otherwise — so CI / wrapping shells can detect partial failures.

### 6.3 Environment

- New required env var: `VOYAGE_API_KEY`. Document it in the README's "Local development" section alongside the existing `ASSEMBLYAI_API_KEY`. Add a placeholder line to `.env.example` if that file exists (verify during implementation; create it if missing).
- New npm script: `"embed": "tsx scripts/embed.ts"` in `package.json`.
- The script is offline-only, never invoked at request time, never imported by the Next.js app.

### 6.4 Output progress format

Follows the existing `transcribe.ts` style for visual consistency:

```
Found 108 talks with transcripts
Loaded 91 existing embeddings
17 talks queued for embedding (16 missing, 1 stale hash)

Embedding batch 1 of 1 (17 talks)...
  [done] "Compete or kill Cooperate and Succeed!"
  [done] "Building Bridgy, Not Walls"
  [done] "Social Components"
  ...

=== Summary ===
Skipped: 91
Embedded: 17
Failed: 0
Truncated: 0

Done. data/embeddings/ now contains 108 files.
```

---

## 7. Cosine similarity helper — `src/lib/scoring/cosine.ts`

Lives in the runtime scoring directory because **#24 will consume it directly**, but lands in this spec so the smoke check (§8) has a tested helper to use.

### 7.1 API

```ts
/**
 * Cosine similarity in [-1, 1] for two equal-length numeric vectors.
 * Returns 0 if either vector has zero magnitude (avoids NaN propagation).
 * Throws if the vectors have different lengths — defensive guard against
 * a model upgrade leaving stale embeddings on disk.
 */
export function cosineSimilarity(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): number;
```

Accepts both `number[]` and `Float32Array` via `ArrayLike<number>` so callers don't have to convert.

### 7.2 Tests — `src/lib/scoring/cosine.test.ts`

Vitest, mirroring the existing `rank.test.ts` pattern:

| Test | Expected |
|---|---|
| Identical vectors | `1.0` (within float epsilon) |
| Opposite vectors (`[1,0]` vs `[-1,0]`) | `-1.0` |
| Orthogonal vectors (`[1,0]` vs `[0,1]`) | `0.0` |
| Magnitude invariance (`[2,0]` vs `[1,0]`) | `1.0` |
| Mixed `Float32Array` and `number[]` inputs | matches array-array result |
| Length mismatch | throws |
| Zero magnitude vector | `0.0` (no NaN) |

---

## 8. End-to-end smoke check — `scripts/embed-smoke.ts`

A single-shot validation that runs after `npm run embed` and proves the embeddings carry meaningful semantic signal — that the `document`/`query` asymmetry actually works, that the cosine math is sane, and that the data is not noise.

### 8.1 Flow

1. **Load embeddings.** Read every file in `data/embeddings/` into a `Map<rkey, Float32Array>`. Read `data/talks.json` for the title lookup so output is human-readable. Validate that every file has `model === MODEL` and `dimensions === DIMENSIONS`; abort with a clear error if any file is from a different model (corrupt local state).

2. **Embed three test queries** via Voyage with `input_type: "query"`:
   - `"decentralized identity and personal data sovereignty"`
   - `"content moderation and trust and safety on social networks"`
   - `"federated social media protocol design and ATProto architecture"`

3. **Compute cosine similarity** of each query vector to every talk vector using `cosineSimilarity` from §7.

4. **Print top-5 and bottom-5** matches per query, sorted by similarity:

   ```
   ── Query: "decentralized identity and personal data sovereignty" ──
   Top:
     0.71  PDS Sovereignty: Owning Your Data on AT Protocol
     0.68  Building Bridgy, Not Walls
     0.65  Account logic in ATProto using Trusted Execution Environments
     0.63  Compete or kill Cooperate and Succeed!
     0.61  Reigniting the Party: Lessons from a Stalled Migration to Bluesky

   Bottom:
     0.18  This isn't over until we all listen to kpop
     0.17  Lunch Break
     0.15  closing remarks
     ...
   ```

5. **Sanity gates.** Exit 1 (failure) if any of these conditions hold:
   - No query produces any match with similarity ≥ `0.50`.
   - Any query's top match has similarity < `0.30`.
   - Any embedding file has `dimensions !== 1024` or `model !== "voyage-3.5-lite"`.

   These gates catch catastrophic failures (collapsed vectors, model returning constants, dimension drift) without being so strict that they trigger on quality tuning. They are NOT a substitute for the human eyeball check on the top-5 output.

### 8.2 Why this is "minimal end-to-end" and not full integration

It is the minimum amount of code that proves four things at once:

1. The Voyage `document` mode in `embed.ts` produces real semantic vectors.
2. The Voyage `query` mode (the asymmetric path #24 will use) works against the same model.
3. The `cosineSimilarity` math is correct in production conditions.
4. The embeddings carry topic-discriminating signal that survives a real query path.

It does NOT touch the scoring engine (`computeInterestStub` stays a stub), does NOT modify the React tree, does NOT ship a user-facing feature. Layer 2 still goes live in #23 + #24, not here.

### 8.3 Cost

Three additional Voyage `query`-type embed calls, ~50 input tokens each. Effectively free (~$0.000003).

---

## 9. Testing strategy

### 9.1 Unit tests

| File | What it covers |
|---|---|
| `src/lib/scoring/cosine.test.ts` | Cosine math correctness (see §7.2) |
| `scripts/__tests__/embed.test.ts` | Hash idempotency, truncation behavior, Voyage response shape validation |

`scripts/__tests__/embed.test.ts` mocks `fs` and `fetch`, isolating the deterministic logic from the Voyage API. The three behaviors exercised:

1. **Hash idempotency.** Given an existing embedding file with matching `transcriptHash` and matching `model`, the script does not call `fetch`. Mismatch on either field → fetch is called.

2. **Truncation behavior.** Given a transcript text longer than `SAFE_CHAR_LIMIT`, the embedder calls Voyage with the truncated text, sets `truncated: true`, and computes the hash over the truncated text (so re-runs stay idempotent). This is the load-bearing detail — hashing the raw text would re-embed forever.

3. **Voyage response shape validation.** Given a malformed response (missing `data`, wrong dimension count, non-numeric vector entries), the embedder throws a clear error rather than writing a corrupt file.

### 9.2 What is deliberately not tested

- **Live Voyage API calls.** Flaky and burns API budget in CI. The smoke check (§8) covers the live integration when manually run.
- **Layer-2 scoring integration.** Out of scope — `computeInterestStub` stays a stub until #24.
- **Per-talk embedding quality.** Subjective; eyeballed in `embed-smoke` output.

---

## 10. Cost and operational notes

| Concern | Number |
|---|---|
| Talks to embed (initial run) | 108 |
| Estimated total tokens (108 talks × ~12k average) | ~1.3M tokens |
| Cost at `voyage-3.5-lite` rates | ≈ $0.03 |
| Embedding file disk footprint | ~1.3 MB total |
| Re-run cost (no transcript changes) | $0.00 (all skipped via hash) |
| Smoke check cost per run | ≈ $0.000003 (3 query embeddings) |
| Wall-clock time, full run, 1 batch of 108 | ~5–15 seconds typical |

The script is cheap enough to run on every PR that touches transcripts without thinking about cost.

---

## 11. Scope boundary

### 11.1 What this issue (#21) produces

- New script: `scripts/embed.ts`
- New script: `scripts/embed-smoke.ts`
- New shared types: `scripts/lib/embedding-types.ts`
- New runtime helper: `src/lib/scoring/cosine.ts` + tests
- New unit tests: `scripts/__tests__/embed.test.ts`
- New data directory: `data/embeddings/{rkey}.json` × 108 (via running the script)
- New `package.json` scripts: `embed`, `embed:check`
- New `.env` requirement: `VOYAGE_API_KEY`
- README update: the "Local development" section gains the new env var and the data pipeline section gains the two new scripts

### 11.2 What this issue does NOT do (filed or already-filed followups)

- ❌ Compute the user's interest profile from their Bluesky posts → **#23 — User interest profiling**
- ❌ Compute cosine similarity between embeddings and user profile at runtime → **#24 — Cosine similarity matching**
- ❌ Wire layer 2 into `combineLayers` / replace `computeInterestStub` → **#24**
- ❌ Publish embeddings to `watch.understory.topicIndex` AT Protocol records → **#22 — Publish topicIndex records**
- ❌ Extract human-readable topic labels (`topics: [{label, weight}]`) → **new followup issue, to be filed when this spec is approved**

`computeInterestStub` continues to return `{ interestScore: 0 }` after this spec is implemented. Layer 2 of the scoring engine goes live when **both** #23 and #24 land. The merge of #21 alone does not change any user-visible behavior.

---

## 12. Open questions

None at time of writing. All architectural decisions are listed in §3 with rationale.

---

## 13. Followups to file after this spec is approved

- **New issue:** "Extract topic labels for talks" — separate offline task that adds the `topics: [{label, weight}]` field to each `data/embeddings/{rkey}.json` file via Claude/LLM extraction. Required before #22 (lexicon publishing) so the published `topicIndex` records have both fields. Not required for #23 / #24.
