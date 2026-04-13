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
  // Range: 1.0 at intensity 1 → 0.2 at intensity 0, with a quadratic curve so
  // low-glow (heavily covered) talks fall off fast — at glow 0.3 the card is
  // already near 0.27 opacity, at glow 0.7 it's at 0.59. Combined with the
  // translucent bg below, this lets covered cards visually recede into the
  // page background while missed talks stay vivid. The wider range and steeper
  // curve are deliberate: the previous linear 0.5–1.0 range left even fully
  // covered cards too solid to read as "faded."
  const opacity = 0.2 + glow * glow * 0.8;

  return (
    <div
      className={[
        "group relative rounded-lg lume-card-contain",
        // Translucent (no backdrop-blur — that was removed in #39 because
        // the compositor cost on 145 stacked cards killed scroll perf).
        // Plain alpha is virtually free at paint time and gives the fade
        // somewhere to dissolve into.
        "bg-surface-container-low/70",
        "border-t-2",
        glow > 0.3
          ? "border-primary-fixed-dim"
          : glow > 0
            ? "border-primary-fixed-dim/50"
            : "border-primary-fixed-dim/20",
        "transition-[box-shadow,border-color,opacity] duration-500",
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
