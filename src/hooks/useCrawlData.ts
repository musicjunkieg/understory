"use client";

import { useState, useEffect } from "react";
import type { TalkMentions } from "@/lib/scoring";
import type { InterestProfileStatus } from "@/lib/crawl/types";

export interface CrawlData {
  mentions: TalkMentions | null;
  followCount: number;
  loading: boolean;
  error: string | null;
  /** User interest profile vector from /api/crawl. Null while loading,
   *  on auth failure, on network failure, or when the profile build
   *  returned status: no-posts / error. #24 consumes this for layer-2
   *  cosine matching. */
  interestVector: number[] | null;
  /** Diagnostic state for the profile build. Null in the initial load
   *  and non-happy-path states (401/504/network error). Only populated
   *  with the server's status on a successful /api/crawl response. */
  interestProfileStatus: InterestProfileStatus | null;
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
    interestVector: null,
    interestProfileStatus: null,
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
                interestVector: null,
                interestProfileStatus: null,
              });
            } else {
              setData({
                mentions: null,
                followCount: 0,
                loading: false,
                error: `Crawl failed: ${res.status} ${res.statusText}`,
                interestVector: null,
                interestProfileStatus: null,
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
            interestVector: json.interestVector ?? null,
            interestProfileStatus: json.interestProfileStatus ?? null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setData({
            mentions: null,
            followCount: 0,
            loading: false,
            error: err instanceof Error ? err.message : "Crawl failed",
            interestVector: null,
            interestProfileStatus: null,
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
