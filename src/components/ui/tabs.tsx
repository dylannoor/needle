import { Tabs as R } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export const Tabs = R.Root;
export const TabsContent = R.Content;

/** Underlined text tabs for sub-views inside a screen. */
export function TabsList({ items, className }: { items: { value: string; label: ReactNode }[]; className?: string }) {
  return (
    <R.List className={cn("flex gap-5 border-b border-line", className)}>
      {items.map((i) => (
        <R.Trigger
          key={i.value}
          value={i.value}
          className="-mb-px h-10 border-0 border-b-2 border-transparent bg-transparent px-0 text-[14px] font-medium text-muted transition-colors duration-150 hover:text-text data-[state=active]:border-text data-[state=active]:text-text"
        >
          {i.label}
        </R.Trigger>
      ))}
    </R.List>
  );
}
