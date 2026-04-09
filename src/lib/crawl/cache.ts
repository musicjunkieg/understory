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

export function getInFlightCrawl(did: string): Promise<CrawlResult> | null {
  return getInFlight().get(did) ?? null;
}

export function setInFlightCrawl(
  did: string,
  promise: Promise<CrawlResult>,
): void {
  const inFlight = getInFlight();
  inFlight.set(did, promise);
  promise.finally(() => inFlight.delete(did));
}
