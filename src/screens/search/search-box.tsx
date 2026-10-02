import { useId, useState } from "react";
import { History, Search } from "../../components/ui/icons";
import { cn } from "../../lib/cn";

/** Query field with a recent-search dropdown (combobox pattern). */
export function SearchBox({ value, onChange, onSubmit, history }: { value: string; onChange: (v: string) => void; onSubmit: (q: string) => void; history: string[] }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const listId = useId();
  const q = value.trim().toLowerCase();
  const items = history.filter((h) => h.toLowerCase() !== q && h.toLowerCase().includes(q)).slice(0, 8);
  const show = open && items.length > 0;
  const pick = (h: string) => {
    onChange(h);
    setOpen(false);
    onSubmit(h);
  };

  return (
    <div className="relative min-w-0 grow">
      <div className="flex h-[38px] items-center gap-2.5 rounded-lg border border-line-strong bg-raised px-3 focus-within:border-focus">
        <Search size={17} className="text-faint" />
        <input
          type="search"
          role="combobox"
          aria-label="Search the network"
          aria-expanded={show}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={show && hi >= 0 ? `${listId}-${hi}` : undefined}
          placeholder="Artist, album or track"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setHi(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && items.length) {
              e.preventDefault();
              setOpen(true);
              setHi((h) => (h + 1) % items.length);
            } else if (e.key === "ArrowUp" && items.length) {
              e.preventDefault();
              setHi((h) => (h <= 0 ? items.length - 1 : h - 1));
            } else if (e.key === "Escape") {
              setOpen(false);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (show && hi >= 0) pick(items[hi]);
              else {
                setOpen(false);
                onSubmit(value);
              }
            }
          }}
          className="min-w-0 grow border-0 bg-transparent text-[15px] font-medium text-text outline-none placeholder:font-normal placeholder:text-faint"
        />
      </div>
      {show && (
        <ul id={listId} role="listbox" aria-label="Recent searches" className="absolute top-[44px] right-0 left-0 z-30 m-0 list-none rounded-lg border border-line-strong bg-raised p-1 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
          {items.map((h, i) => (
            <li
              key={h}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(h);
              }}
              onMouseEnter={() => setHi(i)}
              className={cn("flex h-8 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-[13px]", i === hi && "bg-raised-hi")}
            >
              <History size={14} className="text-faint" />
              {h}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
