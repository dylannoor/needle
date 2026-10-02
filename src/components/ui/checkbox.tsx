import { Checkbox as R } from "radix-ui";
import { useId, type ReactNode } from "react";
import { cn } from "../../lib/cn";

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible label; the whole row is clickable. Omit and pass aria-label for a bare box. */
  label?: ReactNode;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

/** 16px box: clear outline when off, solid light fill with a dark check when on. */
export const controlBox =
  "peer grid h-4 w-4 shrink-0 place-items-center border-[1.5px] border-control-line bg-transparent p-0 transition-colors duration-150 hover:border-control-line-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-40 data-[state=checked]:border-text data-[state=checked]:bg-text";

export function Checkbox({ checked, onCheckedChange, label, disabled, id, className, ...rest }: CheckboxProps) {
  const auto = useId();
  const boxId = id ?? auto;
  const box = (
    <R.Root id={boxId} checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} disabled={disabled} aria-label={rest["aria-label"]} className={cn(controlBox, "rounded-[4px]", !label && className)}>
      <R.Indicator>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--bg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1.75 5.25 4 7.5l4.25-5" />
        </svg>
      </R.Indicator>
    </R.Root>
  );
  if (!label) return box;
  return (
    <div className={cn("flex min-h-8 items-center gap-2.5", disabled && "opacity-60", className)}>
      {box}
      <label htmlFor={boxId} className="cursor-pointer select-none">
        {label}
      </label>
    </div>
  );
}
