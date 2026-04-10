import { type HTMLAttributes } from "react";
import type { TalkScore } from "@/lib/scoring";

interface LumeCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Understory score 0-1. Higher = more undiscovered = brighter glow. */
  glowIntensity?: number;
  /** Index for staggered breathing animation. */
  tileIndex?: number;
  /** Whether to show the interest match indicator. */
  interestMatch?: boolean;
  /** Score data for hover/tap detail strip. null = no detail. */
  score?: TalkScore | null;
}

function glowStyle(intensity: number): string {
  if (intensity > 0.7) return "biolume-glow-strong";
  if (intensity > 0.3) return "biolume-glow";
  return "";
}

function ScoreDetail({ score }: { score: TalkScore }) {
  if (score.state === "unknown") return null;

  if (score.state === "missed") {
    return (
      <div className="text-label-sm text-primary-fixed">
        Your network missed this
      </div>
    );
  }

  // engaged — show percentage
  const pct = Math.round(score.layer1.attentionInverse * 100);
  return (
    <div className="text-label-sm text-on-surface-variant">
      {pct}% of your network missed this
    </div>
  );
}

function LumeCard({
  glowIntensity = 0,
  tileIndex,
  interestMatch = false,
  score,
  className = "",
  children,
  ...props
}: LumeCardProps) {
  const isUnderstory = glowIntensity > 0.3;
  const hasDetail = score && score.state !== "unknown";

  return (
    <div
      className={[
        "group relative rounded-lg",
        "bg-surface-container-low/60 backdrop-blur-[20px]",
        "border-t-2",
        glowIntensity > 0.3
          ? "border-primary-fixed-dim"
          : glowIntensity > 0
            ? "border-primary-fixed-dim/50"
            : "border-primary-fixed-dim/20",
        "transition-all duration-500",
        "hover:biolume-glow-strong",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-fixed",
        glowStyle(glowIntensity),
        isUnderstory ? "animate-breathe" : "",
        className,
      ].join(" ")}
      style={
        tileIndex !== undefined
          ? ({ "--tile-index": tileIndex } as React.CSSProperties)
          : undefined
      }
      {...props}
    >
      {interestMatch && (
        <span
          className="absolute top-3 right-3 h-2.5 w-2.5 rounded-full bg-interest-match"
          aria-label="Matches your interests"
        />
      )}
      {children}

      {hasDetail && (
        <div
          className={[
            "px-5 pb-3 pt-0",
            // Mobile: always visible (no hover capability)
            "max-h-12 opacity-100",
            // Desktop (sm+): hidden by default, revealed on hover via group-hover
            "sm:max-h-0 sm:overflow-hidden sm:opacity-0",
            "sm:transition-all sm:duration-300",
            "sm:group-hover:max-h-12 sm:group-hover:opacity-100",
          ].join(" ")}
        >
          <div className="border-t border-primary-fixed-dim/20 pt-2">
            <ScoreDetail score={score} />
          </div>
        </div>
      )}
    </div>
  );
}

export { LumeCard, type LumeCardProps };
