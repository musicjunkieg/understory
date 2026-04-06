import type { Speaker } from "./types";

/**
 * Format milliseconds as "MM:SS".
 */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Format duration in ms as "X min". Under 1 minute shows "< 1 min".
 */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "< 1 min";
  return `${minutes} min`;
}

/**
 * Resolve a diarization speaker label ("A", "B") to a speaker name.
 * Falls back to "Speaker A" if no match.
 */
export function resolveSpeaker(
  label: string,
  speakers: Speaker[],
): string {
  const index = label.charCodeAt(0) - "A".charCodeAt(0);
  if (index >= 0 && index < speakers.length && speakers[index].name) {
    return speakers[index].name;
  }
  return `Speaker ${label}`;
}

/**
 * Format a date string as "Mar 27, 4:15 PM".
 */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Vancouver",
  });
}
