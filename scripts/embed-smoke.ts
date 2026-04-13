import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { cosineSimilarity } from "@/lib/scoring/cosine";
import type { TalkEntry } from "@/lib/types";
import type {
  EmbeddingFile,
  VoyageEmbedRequest,
  VoyageEmbedResponse,
} from "./lib/embedding-types";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3.5-lite";
const DIMENSIONS = 1024;
const EMBEDDINGS_DIR = path.resolve(__dirname, "../data/embeddings");
const TALKS_PATH = path.resolve(__dirname, "../data/talks.json");

const TEST_QUERIES = [
  "decentralized identity and personal data sovereignty",
  "content moderation and trust and safety on social networks",
  "federated social media protocol design and ATProto architecture",
];

const SIM_FLOOR = 0.5; // at least one match per query must reach this
const SIM_TOP_FLOOR = 0.3; // every query's top match must clear this

interface LoadedEmbedding {
  rkey: string;
  title: string;
  vector: Float32Array;
}

function loadEmbeddings(): LoadedEmbedding[] {
  if (!fs.existsSync(EMBEDDINGS_DIR)) {
    console.error(`No embeddings found at ${EMBEDDINGS_DIR}. Run 'npm run embed' first.`);
    process.exit(1);
  }
  const files = fs.readdirSync(EMBEDDINGS_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.error(`No embeddings found in ${EMBEDDINGS_DIR}. Run 'npm run embed' first.`);
    process.exit(1);
  }

  const talks = JSON.parse(fs.readFileSync(TALKS_PATH, "utf-8")) as TalkEntry[];
  const titleByRkey = new Map(talks.map((t) => [t.rkey, t.title]));

  const loaded: LoadedEmbedding[] = [];
  for (const file of files) {
    const raw = JSON.parse(
      fs.readFileSync(path.join(EMBEDDINGS_DIR, file), "utf-8"),
    ) as EmbeddingFile;
    if (raw.model !== MODEL) {
      console.error(
        `Embedding ${file} has wrong model "${raw.model}", expected "${MODEL}". Re-run 'npm run embed'.`,
      );
      process.exit(1);
    }
    if (raw.dimensions !== DIMENSIONS) {
      console.error(
        `Embedding ${file} has wrong dimensions ${raw.dimensions}, expected ${DIMENSIONS}.`,
      );
      process.exit(1);
    }
    loaded.push({
      rkey: raw.rkey,
      title: titleByRkey.get(raw.rkey) ?? raw.rkey,
      vector: new Float32Array(raw.vector),
    });
  }

  return loaded;
}

async function embedQuery(apiKey: string, query: string): Promise<Float32Array> {
  const body: VoyageEmbedRequest = {
    input: [query],
    model: MODEL,
    input_type: "query",
  };

  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Voyage API ${res.status} ${res.statusText}`);
  }

  const response = (await res.json()) as VoyageEmbedResponse;
  if (!response.data?.[0]?.embedding) {
    throw new Error("Voyage response missing embedding");
  }
  return new Float32Array(response.data[0].embedding);
}

function rankByQuery(
  query: Float32Array,
  embeddings: LoadedEmbedding[],
): Array<{ rkey: string; title: string; sim: number }> {
  return embeddings
    .map((e) => ({
      rkey: e.rkey,
      title: e.title,
      sim: cosineSimilarity(query, e.vector),
    }))
    .sort((a, b) => b.sim - a.sim);
}

function printResult(query: string, ranked: ReturnType<typeof rankByQuery>): void {
  console.log(`── Query: "${query}" ──`);
  console.log("Top:");
  for (const r of ranked.slice(0, 5)) {
    console.log(`  ${r.sim.toFixed(2)}  ${r.title}`);
  }
  console.log("Bottom:");
  for (const r of ranked.slice(-5).reverse()) {
    console.log(`  ${r.sim.toFixed(2)}  ${r.title}`);
  }
  console.log();
}

async function main(): Promise<void> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.error("VOYAGE_API_KEY not set");
    process.exit(1);
  }

  const embeddings = loadEmbeddings();
  console.log(`Loaded ${embeddings.length} embeddings\n`);

  let anyMatchAboveFloor = false;
  let allTopsAboveFloor = true;

  for (const query of TEST_QUERIES) {
    const queryVector = await embedQuery(apiKey, query);
    const ranked = rankByQuery(queryVector, embeddings);
    printResult(query, ranked);

    const top = ranked[0];
    if (!top || top.sim < SIM_TOP_FLOOR) {
      console.error(
        `FAIL: top match for query "${query}" has similarity ${top?.sim.toFixed(2) ?? "n/a"}, below ${SIM_TOP_FLOOR}`,
      );
      allTopsAboveFloor = false;
    }
    if (ranked.some((r) => r.sim >= SIM_FLOOR)) {
      anyMatchAboveFloor = true;
    }
  }

  if (!anyMatchAboveFloor) {
    console.error(`FAIL: no query produced any match with similarity >= ${SIM_FLOOR}`);
  }

  if (anyMatchAboveFloor && allTopsAboveFloor) {
    console.log("All sanity gates passed.");
    process.exit(0);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
