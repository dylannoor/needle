import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";

interface Option<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  /** "radio" for a setting, "tab" for switching views. */
  kind?: "radio" | "tab";
  "aria-label"?: string;
  /** Stretch options to equal widths. */
  fill?: boolean;
  className?: string;
}

/** Segmented control with roving focus and arrow-key navigation. */
export function Segmented<T extends string>({ value, onChange, options, kind = "radio", fill, className, ...rest }: SegmentedProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + d + options.length) % options.length];
    onChange(next.value);
    ref.current?.querySelectorAll<HTMLButtonElement>("button")[options.indexOf(next)]?.focus();
  };
  return (
    <div
      ref={ref}
      role={kind === "radio" ? "radiogroup" : "tablist"}
      aria-label={rest["aria-label"]}
      onKeyDown={onKey}
      className={cn("flex gap-0.5 rounded-lg border border-line-strong bg-raised p-[3px]", fill && "grid auto-cols-fr grid-flow-col", className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={kind === "radio" ? "radio" : "tab"}
            aria-checked={kind === "radio" ? on : undefined}
            aria-selected={kind === "tab" ? on : undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-7 rounded-sm border-0 px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150",
              on ? "bg-seg-on text-text" : "bg-transparent text-muted hover:text-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
