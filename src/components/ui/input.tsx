import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-control w-full rounded-ctl border border-line-strong bg-input px-3 text-[14px] text-text outline-none transition-colors duration-150 placeholder:text-faint focus:border-focus",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-none rounded-ctl border border-line-strong bg-input px-3 py-2 text-[14px] text-text outline-none placeholder:text-faint focus:border-focus",
        className,
      )}
      {...props}
    />
  );
});

/** Raised search field with a leading icon, as in the Search top bar. */
export const SearchField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; label: string }>(function SearchField(
  { icon, label, className, ...props },
  ref,
) {
  return (
    <div className={cn("flex h-[38px] min-w-0 items-center gap-2.5 rounded-lg border border-line-strong bg-raised px-3 focus-within:border-focus", className)}>
      <span className="text-faint">{icon}</span>
      <input ref={ref} type="search" aria-label={label} className="min-w-0 grow border-0 bg-transparent text-[15px] font-medium text-text outline-none placeholder:font-normal placeholder:text-faint" {...props} />
    </div>
  );
});
