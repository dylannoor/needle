import { Select as R } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { ChevronDown, Check } from "./icons";

interface SelectProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string }[];
  /** Muted text shown before the value inside the trigger ("Profile"). */
  prefix?: ReactNode;
  size?: "md" | "sm";
  id?: string;
  "aria-label"?: string;
  className?: string;
  /** Extra items at the end of the list (actions), rendered after a separator. */
  footer?: ReactNode;
}

export function Select<T extends string>({ value, onValueChange, options, prefix, size = "md", className, footer, ...rest }: SelectProps<T>) {
  return (
    <R.Root value={value} onValueChange={(v) => onValueChange(v as T)}>
      <R.Trigger
        id={rest.id}
        aria-label={rest["aria-label"]}
        className={cn(
          "inline-flex shrink-0 items-center gap-2 rounded-ctl border border-line-strong bg-transparent font-medium text-text outline-none transition-colors duration-150 hover:bg-hover-btn focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-hover-btn",
          size === "md" ? "h-control px-3.5 text-[14px]" : "h-[30px] px-2.5 text-[13px]",
          className,
        )}
      >
        {prefix && <span className="text-muted">{prefix}</span>}
        <R.Value />
        <R.Icon>
          <ChevronDown size={size === "md" ? 14 : 13} />
        </R.Icon>
      </R.Trigger>
      <R.Portal>
        <R.Content position="popper" sideOffset={6} align="start" className={menuSurface}>
          <R.Viewport className="p-1">
            {options.map((o) => (
              <R.Item key={o.value} value={o.value} className={menuItem}>
                <R.ItemText>{o.label}</R.ItemText>
                <R.ItemIndicator className="ml-auto pl-4">
                  <Check size={14} />
                </R.ItemIndicator>
              </R.Item>
            ))}
            {footer}
          </R.Viewport>
        </R.Content>
      </R.Portal>
    </R.Root>
  );
}

export const menuSurface =
  "z-50 min-w-[var(--radix-select-trigger-width,180px)] overflow-hidden rounded-lg border border-line-strong bg-raised text-[13px] text-text shadow-[0_12px_32px_rgba(0,0,0,0.45)]";
export const menuItem =
  "relative flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2.5 outline-none select-none data-[highlighted]:bg-raised-hi data-[disabled]:pointer-events-none data-[disabled]:opacity-45";
