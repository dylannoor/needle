import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "default" | "primary" | "ghost" | "danger";
type Size = "md" | "sm" | "lg" | "icon";

const variants: Record<Variant, string> = {
  default: "border-line-strong bg-transparent text-text hover:bg-hover-btn",
  primary: "border-text bg-text text-bg font-semibold hover:bg-white hover:border-white",
  ghost: "border-transparent bg-transparent text-muted hover:bg-raised hover:text-text",
  danger: "border-line-strong bg-transparent text-bad hover:bg-hover-btn",
};

const sizes: Record<Size, string> = {
  md: "h-control px-3.5 text-[14px]",
  sm: "h-[30px] px-2.5 text-[13px]",
  lg: "h-[42px] px-4 text-[14px] justify-center",
  icon: "h-[30px] w-[30px] justify-center p-0",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = "default", size = "md", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-ctl border font-medium whitespace-nowrap transition-colors duration-150 disabled:opacity-45 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
