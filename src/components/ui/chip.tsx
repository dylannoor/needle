import type { ButtonHTMLAttributes } from "react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

/** Toggle filter chip. */
export function Chip({ pressed, onPressedChange, className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "h-7 shrink-0 rounded-[6px] border px-2.5 text-[13px] font-medium transition-colors duration-150",
        pressed ? "border-chip-on-line bg-chip-on text-text" : "border-line-strong text-muted hover:text-text",
        className,
      )}
      {...props}
    />
  );
}

/** Static label chip, e.g. an interest or exclusion with a remove button. */
export function Tag({ children, onRemove, removeLabel }: { children: ReactNode; onRemove?: () => void; removeLabel?: string }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-line-strong pr-1 pl-2.5 text-[13px] text-text">
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel ?? "Remove"}
          onClick={onRemove}
          className="grid h-5 w-5 place-items-center rounded-[4px] text-faint hover:bg-raised-hi hover:text-text"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
          </svg>
        </button>
      )}
    </span>
  );
}
