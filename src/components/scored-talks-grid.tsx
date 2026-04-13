"use client";

import { type CSSProperties, useEffect, useMemo } from "react";
import Link from "next/link";
import { useCrawlData } from "@/hooks/useCrawlData";
import { useTalkEmbeddings } from "@/hooks/useTalkEmbeddings";
import { rankTalks, type TalkScore } from "@/lib/scoring";
import { LumeCard } from "@/components/ui/lume-card";
import { Chip } from "@/components/ui/chip";
import { formatDuration } from "@/lib/format";
import type { TalkEntry } from "@/lib/types";

interface ScoredTalksGridProps {
  talks: TalkEntry[];
}

/**
 * Bioluminescent loading state for the talks grid. Shown while the crawl
 * is in flight so users see deliberate loading instead of a flash of
 * unscored cards followed by a re-sort. The visual borrows the breathing
 * + glow vocabulary from LumeCard so it feels like part of the same world.
 */
function CrawlLoadingState() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-6 text-center">
      <div
        className="h-16 w-16 rounded-full bg-primary-fixed/10 animate-breathe"
        style={
          {
            "--glow": 0.9,
            "--tile-index": 0,
          } as CSSProperties
        }
        aria-hidden="true"
      />
      <div>
        <p className="text-headline-sm text-on-surface mb-1">
          Reading the forest floor
        </p>
        <p className="text-body-md text-on-surface-variant">
          Crawling your network for what they did and didn&apos;t mention.
        </p>
      </div>
    </div>
  );
}

/**
 * Error state for when the crawl fails outright (network failure, 5xx,
 * etc — not the 401/504 paths that useCrawlData treats as "no auth").
 * Surfaces the failure in plain language instead of silently rendering an
 * unscored grid.
 */
function CrawlErrorState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
      <div>
        <p className="text-headline-sm text-on-surface mb-1">
          We couldn&apos;t reach your network
        </p>
        <p className="text-body-md text-on-surface-variant max-w-md">
          The crawl that builds your scoring failed. Showing the talks
          unscored — refresh to try again.
        </p>
        <p className="text-label-sm text-on-surface-variant/70 mt-2 font-mono">
          {message}
        </p>
      </div>
    </div>
  );
}

export function ScoredTalksGrid({ talks }: ScoredTalksGridProps) {
  const {
    mentions,
    followCount,
    interestVector,
    loading: crawlLoading,
    error: crawlError,
  } = useCrawlData();

  const {
    embeddings,
    loading: embeddingsLoading,
    error: embeddingsError,
  } = useTalkEmbeddings();

  // Surface crawl errors in the console for diagnostics. The visible UI
  // gets a CrawlErrorState below; this is so future debugging from a user
  // bug report has a stack trace to point at.
  useEffect(() => {
    if (crawlError) {
      console.error("[scored-talks-grid] crawl failed:", crawlError);
    }
  }, [crawlError]);

  useEffect(() => {
    if (embeddingsError) {
      console.error("[scored-talks-grid] embeddings fetch failed:", embeddingsError);
    }
  }, [embeddingsError]);

  const scoredTalks: { talk: TalkEntry; score: TalkScore | null }[] =
    useMemo(() => {
      if (!mentions) {
        // Not authenticated or crawl not loaded — unsorted, no scores
        return talks.map((talk) => ({ talk, score: null }));
      }
      const scores = rankTalks({
        talks,
        mentions,
        followCount,
        interestVector,
        embeddings: embeddings ?? {},
        active: { layer2: true, layer3: false },
      });
      const talksByRkey = new Map(talks.map((t) => [t.rkey, t]));
      return scores.map((score) => ({
        talk: talksByRkey.get(score.rkey)!,
        score,
      }));
    }, [talks, mentions, followCount, interestVector, embeddings]);

  // Unauth visitors resolve the crawl quickly (401 → mentions: null) and
  // the memo body short-circuits on !mentions without touching embeddings.
  // Only block on embeddingsLoading when we actually need the data (i.e.,
  // the crawl succeeded and we're about to run the full layer-1 + layer-2
  // scoring pass). This preserves the "no flash of unscored then re-sort"
  // guarantee on the auth path while letting the unauth path render
  // immediately.
  if (crawlLoading) {
    return <CrawlLoadingState />;
  }
  if (mentions && embeddingsLoading) {
    return <CrawlLoadingState />;
  }

  // Hard failure (not the 401/504 "no auth" path that useCrawlData
  // converts to a clean null mentions). Show explicit error UI rather
  // than pretending the unscored grid is the right state.
  if (crawlError || embeddingsError) {
    // Show whichever error fired first; both are independent, and the
    // practical distinction matters less than "something failed, here's
    // the message." The user-visible copy inside CrawlErrorState doesn't
    // distinguish which hook failed.
    return (
      <CrawlErrorState message={crawlError ?? embeddingsError ?? "unknown"} />
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {scoredTalks.map(({ talk, score }, index) => (
        <Link
          key={talk.rkey}
          href={`/talk/${talk.rkey}`}
          className="group/card block rounded-lg focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-fixed"
        >
          <LumeCard
            className="h-full"
            glowIntensity={score?.intensity ?? 0}
            tileIndex={index}
            score={score}
          >
            <div className="p-5">
              {talk.speakers.length > 0 && (
                <p className="text-label-md text-primary-fixed-dim mb-2">
                  {talk.speakers.map((s) => s.name).join(", ")}
                </p>
              )}
              <h2 className="text-headline-sm text-on-surface mb-3">
                {talk.title}
              </h2>
              <div className="flex flex-wrap gap-2">
                {talk.room && <Chip>{talk.room}</Chip>}
                <Chip>{formatDuration(talk.durationMs)}</Chip>
              </div>
            </div>
          </LumeCard>
        </Link>
      ))}
    </div>
  );
}
