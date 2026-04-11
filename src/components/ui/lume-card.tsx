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

function ScoreDetail({ score }: { score: TalkScore }) {
  if (score.state === "unknown") return null;

  if (score.state === "missed") {
    return (
      <div className="text-label-sm text-primary-fixed">
        Your network missed this
      </div>
    );
  }

  // engaged — show coverage among conference-active follows
  const covered = score.normalizedCoverage != null
    ? Math.round(score.normalizedCoverage * 100)
    : 0;
  return (
    <div className="text-label-sm text-on-surface-variant">
      Covered by {covered}% of active follows
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
  const glow = Math.min(Math.max(glowIntensity, 0), 1);
  const isUnderstory = glow > 0.3;
  const hasDetail = score && score.state !== "unknown";

  // Opacity fades covered talks into the background.
  // Range: 1.0 at intensity 1 → 0.5 at intensity 0.
  const opacity = 0.5 + glow * 0.5;

  return (
    <div
      className={[
        "group relative rounded-lg",
        "bg-surface-container-low/60 backdrop-blur-[20px]",
        "border-t-2",
        glow > 0.3
          ? "border-primary-fixed-dim"
          : glow > 0
            ? "border-primary-fixed-dim/50"
            : "border-primary-fixed-dim/20",
        "transition-all duration-500",
        "hover:biolume-glow-strong hover:!opacity-100",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-fixed",
        isUnderstory ? "animate-breathe" : "",
        className,
      ].join(" ")}
      style={{
        "--glow": glow,
        opacity,
        ...(tileIndex !== undefined
          ? { "--tile-index": tileIndex }
          : {}),
      } as React.CSSProperties}
      {...props}
    >
      {interestMatch && (
        <span
          className="absolute top-3 right-3 h-2.5 w-2.5 rounded-full bg-interest-match"
          aria-label="Matches your interests"
        />
      )}
      {children}

      {score && score.state !== "unknown" && score.normalizedCoverage != null && (
        <span className="absolute bottom-3 right-4 text-label-lg tabular-nums text-on-surface-variant/60">
          {Math.round(score.normalizedCoverage * 100)}%
        </span>
      )}

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
