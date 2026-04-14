"use client";

import { useState, useEffect } from "react";

export interface TalkEmbeddingsData {
  /** Talk embeddings keyed by rkey. Null until the fetch resolves (or if
   *  the fetch failed). #24's computeLayer2 consumer falls back to
   *  interestScore: 0 when a talk's rkey is not present. */
  embeddings: Record<string, number[]> | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the talk embedding corpus from /api/embeddings on mount.
 *
 * The endpoint sets Cache-Control: public, max-age=31536000, immutable,
 * so the browser's HTTP cache handles cross-session persistence for free
 * — the first mount pays the ~400 KB gzipped cost once, and every
 * subsequent mount in the same session (or across sessions, within the
 * immutable window) is a cache hit.
 *
 * Mirrors useCrawlData's structure exactly, including the cancellation
 * pattern for unmount during fetch.
 */
export function useTalkEmbeddings(): TalkEmbeddingsData {
  const [data, setData] = useState<TalkEmbeddingsData>({
    embeddings: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchEmbeddings() {
      try {
        const res = await fetch("/api/embeddings");
        if (!res.ok) {
          if (!cancelled) {
            setData({
              embeddings: null,
              loading: false,
              error: `Embeddings fetch failed: ${res.status} ${res.statusText}`,
            });
          }
          return;
        }
        const json = (await res.json()) as Record<string, number[]>;
        if (!cancelled) {
          setData({
            embeddings: json,
            loading: false,
            error: null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setData({
            embeddings: null,
            loading: false,
            error:
              err instanceof Error ? err.message : "Embeddings fetch failed",
          });
        }
      }
    }

    fetchEmbeddings();
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
