"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useCrawlData } from "@/hooks/useCrawlData";
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
          } as React.CSSProperties
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

export function ScoredTalksGrid({ talks }: ScoredTalksGridProps) {
  const { mentions, followCount, loading } = useCrawlData();

  const scoredTalks: { talk: TalkEntry; score: TalkScore | null }[] =
    useMemo(() => {
      if (!mentions) {
        // Not authenticated or crawl not loaded — unsorted, no scores
        return talks.map((talk) => ({ talk, score: null }));
      }
      const scores = rankTalks({ talks, mentions, followCount });
      const talksByRkey = new Map(talks.map((t) => [t.rkey, t]));
      return scores.map((score) => ({
        talk: talksByRkey.get(score.rkey)!,
        score,
      }));
    }, [talks, mentions, followCount]);

  // Hold the grid behind a loader until the crawl resolves so users don't
  // see a flash of unscored cards re-sort into the scored layout. Once
  // loading is false the grid renders, regardless of whether mentions came
  // back populated (auth) or null (unauthenticated / 504).
  if (loading) {
    return <CrawlLoadingState />;
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
