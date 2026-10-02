import { Dialog as R } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Dialog({ open, onOpenChange, title, description, children, footer, width = 440 }: DialogProps) {
  return (
    <R.Root open={open} onOpenChange={onOpenChange}>
      <R.Portal>
        <R.Overlay className="fixed inset-0 z-40 bg-black/55" />
        <R.Content
          style={{ width }}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 max-h-[85vh] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[10px] border border-line-strong bg-raised p-6 text-text shadow-[0_24px_64px_rgba(0,0,0,0.5)] outline-none",
          )}
        >
          <R.Title className="m-0 text-[17px] font-[650] tracking-[-0.01em]">{title}</R.Title>
          {description ? (
            <R.Description className="mt-1.5 mb-0 text-[13px] text-muted">{description}</R.Description>
          ) : (
            <R.Description className="sr-only">{title}</R.Description>
          )}
          {children && <div className="pt-5">{children}</div>}
          {footer && <div className="flex justify-end gap-2 pt-6">{footer}</div>}
        </R.Content>
      </R.Portal>
    </R.Root>
  );
}
