import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ChatMessage } from "../../bindings/ChatMessage";
import type { Conversation } from "../../bindings/Conversation";
import { ChatLog, Composer } from "../../components/chat";
import { Body, Screen, Spacer, TopBar } from "../../components/layout";
import { PresenceDot } from "../../components/presence";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Bar, GhostRows, InlineError, SkeletonRows } from "../../components/ui/states";
import { cn } from "../../lib/cn";
import { ago } from "../../lib/format";
import { api, errorText } from "../../lib/ipc";
import { useNav } from "../../lib/nav";
import { keys, useConversation, useConversations } from "../../lib/queries";

export function MessagesScreen() {
  const nav = useNav();
  const convos = useConversations();
  const [to, setTo] = useState("");
  const list = convos.data ?? [];
  const active = nav.conversation ?? list[0]?.username ?? null;

  const ghost = () => (
    <div className="flex h-[60px] flex-col justify-center gap-2 px-3">
      <Bar w="45%" />
      <Bar w="75%" />
    </div>
  );

  return (
    <Screen>
      <TopBar>
        <h1 data-tauri-drag-region>Messages</h1>
        <Spacer />
      </TopBar>
      <Body>
        <div className="flex w-[300px] shrink-0 flex-col border-r border-line">
          <form
            className="flex gap-2 p-4 pb-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (to.trim()) {
                nav.messageUser(to.trim());
                setTo("");
              }
            }}
          >
            <Input aria-label="Message a user" placeholder="Message a user" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button type="submit" disabled={!to.trim()}>
              Open
            </Button>
          </form>
          <div className="min-h-0 grow overflow-auto px-2 pb-4">
            {convos.isPending ? (
              <SkeletonRows row={ghost} count={5} />
            ) : convos.isError ? (
              <InlineError message={errorText(convos.error)} onRetry={() => convos.refetch()} />
            ) : !list.length && !nav.conversation ? (
              <GhostRows row={ghost} count={5} label="No conversations yet" />
            ) : (
              <ul className="m-0 list-none p-0" aria-label="Conversations">
                {list.map((c) => (
                  <ConversationRow key={c.username} c={c} active={c.username === active} onOpen={() => nav.messageUser(c.username)} />
                ))}
              </ul>
            )}
          </div>
        </div>
        {convos.isPending ? <SkeletonRows className="grow px-7 py-4" count={6} row={() => <div className="py-2"><Bar w="55%" /></div>} /> : active ? <Thread key={active} username={active} presence={list.find((c) => c.username === active)?.presence} /> : <ChatLog messages={[]} onUser={() => undefined} emptyLabel="Pick a conversation or message someone new" />}
      </Body>
    </Screen>
  );
}

function ConversationRow({ c, active, onOpen }: { c: Conversation; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} aria-current={active || undefined} className={cn("flex h-[60px] w-full flex-col justify-center gap-0.5 rounded-ctl border-0 px-3 text-left transition-colors duration-150", active ? "bg-selected" : "bg-transparent hover:bg-raised")}>
        <span className="flex w-full items-center gap-2">
          <PresenceDot presence={c.presence} />
          <span className={cn("min-w-0 grow truncate", c.unread ? "font-semibold text-text" : "text-text")}>{c.username}</span>
          {c.last && <span className="text-[12px] text-faint">{ago(c.last.atMs)}</span>}
          {c.unread > 0 && (
            <span aria-label={`${c.unread} unread`} className="min-w-[18px] rounded-full bg-text px-1.5 text-center text-[11px] leading-[18px] font-semibold text-bg">
              {c.unread}
            </span>
          )}
        </span>
        <span className="w-full truncate pl-[15px] text-[13px] text-faint">{c.last ? `${c.last.own ? "You: " : ""}${c.last.text}` : "No messages yet"}</span>
      </button>
    </li>
  );
}

function Thread({ username, presence }: { username: string; presence?: Conversation["presence"] }) {
  const qc = useQueryClient();
  const nav = useNav();
  const thread = useConversation(username);
  const unread = useConversations().data?.find((c) => c.username === username)?.unread ?? 0;
  const count = thread.data?.length ?? 0;

  // Opening a conversation (or a new message arriving in it) marks it read.
  useEffect(() => {
    if (!unread) return;
    void api.pmMarkRead(username).then(() =>
      qc.setQueryData<Conversation[]>(keys.conversations, (l) => l?.map((c) => (c.username === username ? { ...c, unread: 0 } : c))),
    );
  }, [username, unread, count, qc]);

  const send = useMutation({
    mutationFn: (text: string) => api.pmSend(username, text),
    onSuccess: (m) => {
      qc.setQueryData<ChatMessage[]>(keys.conversation(username), (l) => [...(l ?? []), m]);
      void qc.invalidateQueries({ queryKey: keys.conversations });
    },
  });

  return (
    <div className="flex min-w-0 grow flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-7">
        {presence && <PresenceDot presence={presence} />}
        <button type="button" className="link font-semibold no-underline hover:underline" onClick={() => nav.openUser(username)}>
          {username}
        </button>
        <div className="grow" />
        <Button size="sm" variant="ghost" onClick={() => nav.browseUser(username)}>
          Browse files
        </Button>
        <Button size="sm" onClick={() => nav.openUser(username)}>
          Profile
        </Button>
      </div>
      {thread.isPending ? (
        <SkeletonRows className="px-7 py-4" count={6} row={() => <div className="py-2"><Bar w="55%" /></div>} />
      ) : thread.isError ? (
        <div className="p-7"><InlineError message={errorText(thread.error)} onRetry={() => thread.refetch()} /></div>
      ) : (
        <ChatLog messages={thread.data} onUser={nav.openUser} emptyLabel={`Say hello to ${username}`} />
      )}
      {send.isError && <div className="px-7"><InlineError message={errorText(send.error)} /></div>}
      <Composer placeholder={`Message ${username}`} onSend={(t) => send.mutateAsync(t)} />
    </div>
  );
}
