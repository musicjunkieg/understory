import { type HTMLAttributes } from "react";

type ChipVariant = "default" | "friend";

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant;
}

const variantStyles: Record<ChipVariant, string> = {
  default: "bg-secondary-container text-on-secondary-container",
  friend: "bg-tertiary-fixed text-on-tertiary",
};

function Chip({
  variant = "default",
  className = "",
  children,
  ...props
}: ChipProps) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-3 py-1",
        "text-label-sm",
        variantStyles[variant],
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </span>
  );
}

export { Chip, type ChipProps, type ChipVariant };
