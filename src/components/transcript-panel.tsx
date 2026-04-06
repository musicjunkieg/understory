"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { TranscriptSegment, Speaker } from "@/lib/types";
import { formatTimestamp, resolveSpeaker } from "@/lib/format";

interface TranscriptPanelProps {
  segments: TranscriptSegment[];
  speakers: Speaker[];
  currentTimeMs: number;
  onSeek: (timeMs: number) => void;
}

export function TranscriptPanel({
  segments,
  speakers,
  currentTimeMs,
  onSeek,
}: TranscriptPanelProps) {
  const [search, setSearch] = useState("");
  const [userScrolled, setUserScrolled] = useState(false);
  const activeRef = useRef<HTMLButtonElement>(null);
  const programmaticScroll = useRef(false);

  // Find active segment
  const activeIndex = useMemo(() => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (currentTimeMs >= segments[i].startMs) return i;
    }
    return -1;
  }, [segments, currentTimeMs]);

  // Filter by search
  const searchLower = search.toLowerCase();
  const filteredSegments = useMemo(() => {
    if (!search) return segments;
    return segments.filter((s) => s.text.toLowerCase().includes(searchLower));
  }, [segments, search, searchLower]);

  const matchCount = search ? filteredSegments.length : 0;

  // Auto-scroll to active segment
  useEffect(() => {
    if (userScrolled || search || !activeRef.current) return;
    programmaticScroll.current = true;
    activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      programmaticScroll.current = false;
    }, 500);
  }, [activeIndex, userScrolled, search]);

  // Detect manual scroll
  const handleScroll = useCallback(() => {
    if (programmaticScroll.current) return;
    setUserScrolled(true);
  }, []);

  // Click a segment to seek
  const handleSegmentClick = (startMs: number) => {
    setUserScrolled(false);
    onSeek(startMs);
  };

  // Highlight matching text
  function highlightText(text: string): React.ReactNode {
    if (!search) return text;
    const regex = new RegExp(
      `(${search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi",
    );
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark
          key={i}
          className="bg-primary-fixed/20 text-on-surface rounded-sm px-0.5"
        >
          {part}
        </mark>
      ) : (
        part
      ),
    );
  }

  return (
    <div className="flex flex-col bg-surface-container-low lg:h-[calc(100vh-5rem)] rounded-lg relative">
      {/* Search */}
      <div className="sticky top-0 z-10 p-3 bg-surface-container-low rounded-t-lg">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transcript..."
            aria-label="Search transcript"
            className="w-full rounded-lg bg-surface-container-highest px-4 py-2 text-body-md text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary-fixed focus:ring-offset-0"
          />
          {search && (
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2 text-label-sm text-on-surface-variant"
              aria-live="polite"
            >
              {matchCount} match{matchCount !== 1 ? "es" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Segments */}
      <div
        className="flex-1 overflow-y-auto px-3 pb-3"
        onScroll={handleScroll}
        role="region"
        aria-label="Transcript"
      >
        {filteredSegments.length === 0 && search && (
          <p className="text-body-md text-on-surface-variant py-8 text-center">
            No matches
          </p>
        )}
        {filteredSegments.map((segment, idx) => {
          const isActive = segments[activeIndex]?.id === segment.id;
          const prevSegment = idx > 0 ? filteredSegments[idx - 1] : null;
          const showSpeaker =
            !prevSegment || prevSegment.speaker !== segment.speaker;

          return (
            <button
              key={segment.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => handleSegmentClick(segment.startMs)}
              aria-label={`${resolveSpeaker(segment.speaker, speakers)}, ${formatTimestamp(segment.startMs)}: ${segment.text.slice(0, 50)}`}
              className={[
                "w-full text-left px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer",
                "hover:bg-surface-container-high",
                isActive
                  ? "border-l-2 border-primary-fixed bg-surface-container-high"
                  : "border-l-2 border-transparent",
              ].join(" ")}
            >
              {showSpeaker && (
                <span className="text-body-md font-bold text-primary-fixed-dim block mb-0.5">
                  {resolveSpeaker(segment.speaker, speakers)}
                </span>
              )}
              <span className="text-label-sm text-on-surface-variant mr-2">
                {formatTimestamp(segment.startMs)}
              </span>
              <span className="text-body-lg text-on-surface">
                {highlightText(segment.text)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Follow button */}
      {userScrolled && !search && (
        <button
          onClick={() => setUserScrolled(false)}
          aria-label="Resume auto-scroll"
          className="absolute bottom-4 right-4 rounded-full bg-primary-fixed text-on-primary px-3 py-1.5 text-label-sm biolume-glow hover:biolume-glow-strong transition-shadow"
        >
          ↓ Follow
        </button>
      )}
    </div>
  );
}
