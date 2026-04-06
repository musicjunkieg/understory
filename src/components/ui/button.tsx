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
        className={[
          "inline-flex items-center justify-center gap-2",
          "rounded-lg px-5 py-2.5 text-body-md",
          "transition-all duration-200",
          "active:scale-[0.98]",
          "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-fixed",
          variantStyles[variant],
          className,
        ].join(" ")}
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

export { Button, type ButtonProps, type ButtonVariant };
