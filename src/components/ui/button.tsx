import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "tertiary";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: [
    "bg-primary-fixed text-on-primary",
    "hover:brightness-110 hover:biolume-glow-strong",
    "biolume-glow",
  ].join(" "),
  secondary: [
    "bg-transparent text-on-surface",
    "outline outline-1 outline-outline/20",
    "hover:bg-surface-container-high",
  ].join(" "),
  tertiary: [
    "bg-transparent text-tertiary-fixed-dim font-label",
    "hover:underline hover:underline-offset-4",
  ].join(" "),
};

/**
 * Static class composition for the Button visual. Exported so non-button
 * elements (e.g. Next.js `<Link>`) can render with the same look without
 * nesting a `<button>` inside an `<a>` (which is invalid HTML and confuses
 * assistive tech). The `disabled:` modifiers are inert on non-interactive
 * elements but harmless to leave in.
 */
function buttonClassName(variant: ButtonVariant = "primary"): string {
  return [
    "inline-flex items-center justify-center gap-2",
    "rounded-lg px-5 py-2.5 text-body-md",
    "transition-all duration-200",
    "active:scale-[0.98]",
    "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-fixed",
    variantStyles[variant],
  ].join(" ");
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      loading = false,
      disabled,
      className = "",
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={[buttonClassName(variant), className].join(" ")}
        {...props}
      >
        {loading ? (
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          children
        )}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonClassName, type ButtonProps, type ButtonVariant };
