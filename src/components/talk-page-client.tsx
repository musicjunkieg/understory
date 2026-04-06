"use client";

import { useState, useCallback, useRef } from "react";
import { VideoPlayer } from "./video-player";
import { TranscriptPanel } from "./transcript-panel";
import type { TranscriptSegment, Speaker, SeekTarget } from "@/lib/types";

interface TalkPageClientProps {
  hlsUrl: string;
  segments: TranscriptSegment[];
  speakers: Speaker[];
}

export function TalkPageClient({
  hlsUrl,
  segments,
  speakers,
}: TalkPageClientProps) {
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [seekTo, setSeekTo] = useState<SeekTarget | null>(null);
  const seekCounter = useRef(0);

  const handleTimeUpdate = useCallback((timeMs: number) => {
    setCurrentTimeMs(timeMs);
  }, []);

  const handleSeek = useCallback((timeMs: number) => {
    seekCounter.current += 1;
    setSeekTo({ timeMs, id: seekCounter.current });
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Video — sticky on desktop */}
      <div className="w-full lg:w-[60%] lg:sticky lg:top-20 lg:self-start">
        <VideoPlayer
          hlsUrl={hlsUrl}
          onTimeUpdate={handleTimeUpdate}
          seekTo={seekTo}
        />
      </div>

      {/* Transcript */}
      <div className="w-full lg:w-[40%] relative">
        <TranscriptPanel
          segments={segments}
          speakers={speakers}
          currentTimeMs={currentTimeMs}
          onSeek={handleSeek}
        />
      </div>
    </div>
  );
}
