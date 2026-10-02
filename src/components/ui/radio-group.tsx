import { RadioGroup as R } from "radix-ui";
import { useId } from "react";
import { cn } from "../../lib/cn";
import { controlBox } from "./checkbox";

interface RadioGroupProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string }[];
  "aria-labelledby"?: string;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
}

/** Radios styled like Checkbox: outlined ring when off, filled with a dark dot when on. */
export function RadioGroup<T extends string>({ value, onValueChange, options, disabled, className, ...rest }: RadioGroupProps<T>) {
  const base = useId();
  return (
    <R.Root value={value} onValueChange={(v) => onValueChange(v as T)} disabled={disabled} className={cn("flex flex-col", className)} {...rest}>
      {options.map((o, i) => (
        <div key={o.value} className="flex min-h-8 items-center gap-2.5">
          <R.Item id={`${base}-${i}`} value={o.value} className={cn(controlBox, "rounded-full")}>
            <R.Indicator className="block h-1.5 w-1.5 rounded-full bg-bg" />
          </R.Item>
          <label htmlFor={`${base}-${i}`} className="cursor-pointer select-none">
            {o.label}
          </label>
        </div>
      ))}
    </R.Root>
  );
}
