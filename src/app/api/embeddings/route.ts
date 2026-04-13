import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Tell Next.js this route is static: we read from the filesystem but the
 * data never changes at request time (it's baked into the standalone
 * build via outputFileTracingIncludes in next.config.ts). Without this,
 * App Router classifies the route as dynamic and may override our
 * Cache-Control header with its default no-store.
 */
export const dynamic = "force-static";

const EMBEDDINGS_DIR = path.resolve(process.cwd(), "data/embeddings");

/**
 * On-disk shape of data/embeddings/{rkey}.json, from #21's offline pipeline.
 * Only the `.rkey` and `.vector` fields are needed at runtime; the other
 * fields (model, dimensions, transcriptHash, truncated, generatedAt) are
 * persistence-layer metadata.
 */
interface EmbeddingFile {
  rkey: string;
  model: string;
  dimensions: number;
  vector: number[];
  transcriptHash: string;
  truncated: boolean;
  generatedAt: string;
}

/**
 * Module-level cache. Populated on first GET request, reused forever.
 * Per-worker memory cost: ~400 KB for 108 vectors × 1024 floats.
 */
let cache: Record<string, number[]> | null = null;

function loadEmbeddings(): Record<string, number[]> {
  if (cache !== null) return cache;

  const files = fs.readdirSync(EMBEDDINGS_DIR);
  const result: Record<string, number[]> = {};

  for (const filename of files) {
    if (!filename.endsWith(".json")) continue;
    const fullPath = path.join(EMBEDDINGS_DIR, filename);
    const raw = fs.readFileSync(fullPath, "utf-8");
    const parsed = JSON.parse(raw) as EmbeddingFile;
    result[parsed.rkey] = parsed.vector;
  }

  cache = result;
  return cache;
}

export async function GET(): Promise<Response> {
  const body = loadEmbeddings();

  // Use explicit `new Response(...)` rather than `Response.json()` so the
  // framework preserves our Cache-Control header verbatim. Next.js's
  // Response.json() helper can let default headers intercede.
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Corpus only changes when data/embeddings/ changes (offline, via
      // `npm run embed`). Immutable is semantically correct for this
      // endpoint — a new release with new embeddings should invalidate
      // via a fresh bundle, not a stale cache.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
