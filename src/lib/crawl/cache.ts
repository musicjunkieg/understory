import type { CrawlResult, CacheEntry } from "./types";

const TTL_MS = 30 * 60 * 1000; // 30 minutes

declare global {
  var __crawlCache: Map<string, CacheEntry> | undefined;
  var __crawlInFlight: Map<string, Promise<CrawlResult>> | undefined;
}

function getCache(): Map<string, CacheEntry> {
  if (!globalThis.__crawlCache) {
    globalThis.__crawlCache = new Map();
  }
  return globalThis.__crawlCache;
}

function getInFlight(): Map<string, Promise<CrawlResult>> {
  if (!globalThis.__crawlInFlight) {
    globalThis.__crawlInFlight = new Map();
  }
  return globalThis.__crawlInFlight;
}

export function getCached(did: string): CrawlResult | null {
  const cache = getCache();
  const entry = cache.get(did);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL_MS) {
    cache.delete(did);
    return null;
  }
  return entry.data;
}

export function setCached(did: string, data: CrawlResult): void {
  getCache().set(did, { data, timestamp: Date.now() });
}

/**
 * Atomically register a crawl for a DID. If one is already in-flight, returns
 * the existing promise with `isNew: false`. Otherwise invokes the factory to
 * start a new crawl, stores it, and returns it with `isNew: true`.
 *
 * The cleanup only removes the entry if it still references this exact
 * promise (identity check), so a newer promise that replaced this one isn't
 * erased by a stale finally callback.
 */
export function registerCrawl(
  did: string,
  factory: () => Promise<CrawlResult>,
): { promise: Promise<CrawlResult>; isNew: boolean } {
  const inFlight = getInFlight();
  const existing = inFlight.get(did);
  if (existing) {
    return { promise: existing, isNew: false };
  }
  // Build a "settled" promise via .finally() for cleanup. We must store and
  // return THIS derived promise (not the original) so that the rejection is
  // observed by the caller that awaits it — otherwise the derived promise
  // becomes an orphan on rejection and surfaces as an unhandled rejection.
  const raw = factory();
  const settled = raw.finally(() => {
    if (inFlight.get(did) === settled) {
      inFlight.delete(did);
    }
  });
  inFlight.set(did, settled);
  return { promise: settled, isNew: true };
}
