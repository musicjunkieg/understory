import { type HTMLAttributes } from "react";

interface LumeCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Understory score 0-1. Higher = more undiscovered = brighter glow. */
  glowIntensity?: number;
  /** Index for staggered breathing animation. */
  tileIndex?: number;
  /** Whether to show the interest match indicator. */
  interestMatch?: boolean;
}

function glowStyle(intensity: number): string {
  if (intensity > 0.7) return "biolume-glow-strong";
  if (intensity > 0.3) return "biolume-glow";
  return "";
}

function LumeCard({
  glowIntensity = 0,
  tileIndex,
  interestMatch = false,
  className = "",
  children,
  ...props
}: LumeCardProps) {
  const isUnderstory = glowIntensity > 0.3;

  return (
    <div
      className={[
        "relative rounded-lg",
        "bg-surface-container-low/60 backdrop-blur-[20px]",
        "border-t-2 border-primary-fixed-dim",
        "transition-shadow duration-200",
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
    </div>
  );
}

export { LumeCard, type LumeCardProps };
