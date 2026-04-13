"use client";

import { useState, useEffect } from "react";
import type { TalkMentions } from "@/lib/scoring";

export interface CrawlData {
  mentions: TalkMentions | null;
  followCount: number;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches crawl data from `/api/crawl` on mount.
 *
 * - If authenticated: returns `{ mentions, followCount }` from the crawler.
 * - If not authenticated (401): returns `mentions: null` — not an error.
 * - If the crawl fails or times out: returns `error` string.
 *
 * The hook fires one fetch on mount and does not retry. The crawl endpoint
 * has its own caching (30-minute TTL) and concurrent-request coalescing.
 */
export function useCrawlData(): CrawlData {
  const [data, setData] = useState<CrawlData>({
    mentions: null,
    followCount: 0,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchCrawl() {
      try {
        const res = await fetch("/api/crawl");
        if (!res.ok) {
          if (!cancelled) {
            if (res.status === 401 || res.status === 504) {
              // Not authenticated or timeout — treat as "no data"
              setData({
                mentions: null,
                followCount: 0,
                loading: false,
                error: null,
              });
            } else {
              setData({
                mentions: null,
                followCount: 0,
                loading: false,
                error: `Crawl failed: ${res.status} ${res.statusText}`,
              });
            }
          }
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          setData({
            mentions: json.talkMentions,
            followCount: json.followCount,
            loading: false,
            error: null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setData({
            mentions: null,
            followCount: 0,
            loading: false,
            error: err instanceof Error ? err.message : "Crawl failed",
          });
        }
      }
    }

    fetchCrawl();
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
