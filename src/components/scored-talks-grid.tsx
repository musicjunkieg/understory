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

export function ScoredTalksGrid({ talks }: ScoredTalksGridProps) {
  const { mentions, followCount } = useCrawlData();

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
