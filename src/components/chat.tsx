import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../bindings/ChatMessage";
import { cn } from "../lib/cn";
import { timeOfDay } from "../lib/format";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Bar, GhostRows } from "./ui/states";

const ghost = (i: number) => (
  <div className="flex items-center gap-3.5 py-2">
    <Bar w="38px" />
    <Bar w="90px" />
    <Bar w={`${30 + ((i * 23) % 50)}%`} />
  </div>
);

/** Chat transcript that sticks to the bottom as messages arrive. */
export function ChatLog({ messages, onUser, emptyLabel }: { messages: ChatMessage[]; onUser: (u: string) => void; emptyLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (!messages.length) {
    return (
      <div className="grow px-7 py-4">
        <GhostRows count={8} row={ghost} label={emptyLabel} />
      </div>
    );
  }
  return (
    <div ref={ref} role="log" aria-live="polite" className="flex min-h-0 grow flex-col gap-1 overflow-auto px-7 py-4" data-selectable>
      {messages.map((m, i) => (
        <div key={`${m.atMs}-${i}`} className="flex gap-3.5 py-1 text-[14px]">
          <span className="w-[38px] shrink-0 pt-px text-[12px] text-faint">{timeOfDay(m.atMs)}</span>
          <div className="min-w-0">
            {m.action ? (
              <span className="text-muted italic">
                <button type="button" className="border-0 bg-transparent p-0 font-semibold text-text not-italic hover:underline" onClick={() => onUser(m.username)}>
                  {m.username}
                </button>{" "}
                {m.text}
              </span>
            ) : (
              <>
                <button type="button" className={cn("border-0 bg-transparent p-0 pr-2.5 font-semibold hover:underline", m.own ? "text-muted" : "text-text")} onClick={() => onUser(m.username)}>
                  {m.username}
                </button>
                <span className="break-words">{m.text}</span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Message box. Enter sends, Shift+Enter is not needed for one-line chat. */
export function Composer({ onSend, placeholder, disabled }: { onSend: (text: string) => Promise<unknown> | void; placeholder: string; disabled?: boolean }) {
  const [text, setText] = useState("");
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await onSend(t);
  };
  return (
    <form
      className="flex gap-2 border-t border-line px-7 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <Input aria-label={placeholder} placeholder={placeholder} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} className="h-[38px] min-w-0 grow rounded-lg bg-raised" />
      <Button type="submit" variant="primary" disabled={disabled || !text.trim()} className="h-[38px]">
        Send
      </Button>
    </form>
  );
}
