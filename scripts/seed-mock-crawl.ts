/**
 * Generates mock crawl data with a realistic spread of mention counts.
 * Output: data/mock-crawl.json
 *
 * Usage: npx tsx scripts/seed-mock-crawl.ts
 */

import * as fs from "fs";
import * as path from "path";
import type { TalkMention, TalkMentions } from "@/lib/crawl/types";

interface TalkEntry {
  rkey: string;
  eventUri: string | null;
  transcriptFile: string | null;
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const talks: TalkEntry[] = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "talks.json"), "utf-8"),
);

const scoredTalks = talks.filter((t) => t.eventUri && t.transcriptFile);

// Simulate 150 follows, ~25 of whom discussed any talk
const TOTAL_FOLLOWS = 150;
const ENGAGED_POOL = Array.from(
  { length: 25 },
  (_, i) => `did:plc:mock${String(i).padStart(3, "0")}`,
);

// Distribute mention counts with a power-law-ish spread:
// - ~10% of talks: heavily discussed (8-20 engaged follows)
// - ~30% of talks: moderately discussed (2-7 engaged follows)
// - ~30% of talks: lightly discussed (1 engaged follow)
// - ~30% of talks: completely missed (0 engaged follows)
function assignMentionCount(index: number, total: number): number {
  const pct = index / total;
  if (pct < 0.1) return Math.floor(Math.random() * 13) + 8; // 8-20
  if (pct < 0.4) return Math.floor(Math.random() * 6) + 2;  // 2-7
  if (pct < 0.7) return 1;
  return 0;
}

// Shuffle to randomize which talks get high/low mentions
const shuffled = [...scoredTalks].sort(() => Math.random() - 0.5);

const talkMentions: TalkMentions = {};
for (let i = 0; i < shuffled.length; i++) {
  const count = assignMentionCount(i, shuffled.length);
  // Pick `count` random follows from the engaged pool
  const pool = [...ENGAGED_POOL].sort(() => Math.random() - 0.5);
  const follows = pool.slice(0, count);
  const mention: TalkMention = {
    count: follows.length,
    follows,
    posts: follows.map(
      (did) => `at://${did}/app.bsky.feed.post/mock${Date.now()}`,
    ),
    rsvps: [],
  };
  talkMentions[shuffled[i].rkey] = mention;
}

const mockCrawl = {
  talkMentions,
  followCount: TOTAL_FOLLOWS,
  postsScanned: 1200,
  crawledAt: Date.now(),
};

const outPath = path.join(DATA_DIR, "mock-crawl.json");
fs.writeFileSync(outPath, JSON.stringify(mockCrawl, null, 2));

// Stats
const counts = Object.values(talkMentions).map((m) => m.follows.length);
const missed = counts.filter((c) => c === 0).length;
const light = counts.filter((c) => c === 1).length;
const moderate = counts.filter((c) => c >= 2 && c <= 7).length;
const heavy = counts.filter((c) => c >= 8).length;

console.log(`Wrote ${outPath}`);
console.log(`${counts.length} talks: ${heavy} heavy, ${moderate} moderate, ${light} light, ${missed} missed`);
console.log(`Engaged follow pool: ${ENGAGED_POOL.length} / ${TOTAL_FOLLOWS} total`);
