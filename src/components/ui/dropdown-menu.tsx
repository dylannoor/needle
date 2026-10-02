import { DropdownMenu as R } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { menuItem, menuSurface } from "./select";
import { Tooltip } from "./tooltip";

export const DropdownMenu = R.Root;
export const DropdownMenuTrigger = R.Trigger;

export function DropdownMenuContent({ children, align = "start" }: { children: ReactNode; align?: "start" | "end" }) {
  return (
    <R.Portal>
      <R.Content sideOffset={6} align={align} className={cn(menuSurface, "min-w-[180px] p-1")}>
        {children}
      </R.Content>
    </R.Portal>
  );
}

interface ItemProps {
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Disables the item but keeps it hoverable and focusable so a tooltip can say why. */
  disabledReason?: string;
}

export function DropdownMenuItem({ children, onSelect, danger, disabled, disabledReason }: ItemProps) {
  if (disabledReason) {
    return (
      <Tooltip content={disabledReason}>
        <R.Item aria-disabled="true" onSelect={(e) => e.preventDefault()} className={cn(menuItem, "cursor-default opacity-45", danger && "text-bad")}>
          {children}
        </R.Item>
      </Tooltip>
    );
  }
  return (
    <R.Item onSelect={onSelect} disabled={disabled} className={cn(menuItem, danger && "text-bad")}>
      {children}
    </R.Item>
  );
}

export function DropdownMenuRadioItems<T extends string>({ value, onValueChange, options }: { value: T; onValueChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <R.RadioGroup value={value} onValueChange={(v) => onValueChange(v as T)}>
      {options.map((o) => (
        <R.RadioItem key={o.value} value={o.value} className={menuItem}>
          {o.label}
          <R.ItemIndicator className="ml-auto pl-4 text-text">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12 5 5 9-10" />
            </svg>
          </R.ItemIndicator>
        </R.RadioItem>
      ))}
    </R.RadioGroup>
  );
}

export const DropdownMenuSeparator = () => <R.Separator className="my-1 h-px bg-line-strong" />;
