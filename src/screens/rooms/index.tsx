import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { RoomView } from "../../bindings/RoomView";
import { ChatLog, Composer } from "../../components/chat";
import { Aside, Body, Screen, Spacer, TopBar } from "../../components/layout";
import { PresenceDot } from "../../components/presence";
import { TabStrip } from "../../components/tab-strip";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Lock, Search } from "../../components/ui/icons";
import { Input, SearchField } from "../../components/ui/input";
import { Bar, GhostRows, InlineError, SkeletonRows } from "../../components/ui/states";
import { cn } from "../../lib/cn";
import { num } from "../../lib/format";
import { api, errorText } from "../../lib/ipc";
import { useNav } from "../../lib/nav";
import { keys, useRoom, useRooms } from "../../lib/queries";

export function RoomsScreen() {
  const qc = useQueryClient();
  const nav = useNav();
  const rooms = useRooms();
  const [filter, setFilter] = useState("");
  const joined = (rooms.data ?? []).filter((r) => r.joined);
  const active = joined.find((r) => r.name === nav.room)?.name ?? joined[0]?.name ?? null;

  const join = useMutation({
    mutationFn: api.roomJoin,
    onSuccess: (v) => {
      qc.setQueryData(keys.room(v.name), v);
      void qc.invalidateQueries({ queryKey: keys.rooms });
      nav.setRoom(v.name);
    },
  });
  const leave = useMutation({
    mutationFn: api.roomLeave,
    onSuccess: (_, room) => {
      qc.removeQueries({ queryKey: keys.room(room) });
      void qc.invalidateQueries({ queryKey: keys.rooms });
    },
  });

  const f = filter.trim().toLowerCase();
  const list = (rooms.data ?? []).filter((r) => r.name.toLowerCase().includes(f)).sort((a, b) => b.users - a.users);
  const exact = (rooms.data ?? []).some((r) => r.name.toLowerCase() === f);
  const ghost = () => (
    <div className="flex h-11 items-center justify-between px-3">
      <Bar w="50%" />
      <Bar w="15%" />
    </div>
  );

  return (
    <Screen>
      <TopBar>
        <h1 data-tauri-drag-region>Rooms</h1>
        <Spacer />
      </TopBar>
      <Body>
        <div className="flex w-[280px] shrink-0 flex-col border-r border-line">
          <div className="p-4 pb-2">
            <SearchField label="Find a room" placeholder="Find or create a room" icon={<Search size={16} />} value={filter} onChange={(e) => setFilter(e.target.value)} className="h-control" />
          </div>
          {(join.error || leave.error) && (
            <div className="px-4 pb-2">
              <InlineError message={errorText(join.error ?? leave.error)} />
            </div>
          )}
          <div className="min-h-0 grow overflow-auto px-2 pb-4">
            {f && !exact && (
              <button type="button" className="flex h-11 w-full items-center rounded-ctl border-0 bg-transparent px-3 text-left text-muted hover:bg-raised hover:text-text" onClick={() => join.mutate(filter.trim())}>
                Join or create “{filter.trim()}”
              </button>
            )}
            {rooms.isPending ? (
              <SkeletonRows row={ghost} count={8} />
            ) : rooms.isError ? (
              <InlineError message={errorText(rooms.error)} onRetry={() => rooms.refetch()} />
            ) : !list.length && !f ? (
              <GhostRows row={ghost} count={8} label="The room list is empty" />
            ) : (
              <ul className="m-0 list-none p-0" aria-label="All rooms">
                {list.map((r) => (
                  <li key={r.name} className={cn("group flex h-11 items-center gap-2 rounded-ctl px-3", r.name === active ? "bg-selected" : "hover:bg-raised")}>
                    {r.private && <Lock size={13} className="text-faint" aria-label="Private room" />}
                    <button type="button" className="min-w-0 grow truncate border-0 bg-transparent p-0 text-left text-text" onClick={() => (r.joined ? nav.setRoom(r.name) : join.mutate(r.name))}>
                      {r.name}
                    </button>
                    <span className="text-[12px] text-faint">{num(r.users)}</span>
                    {!r.joined && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[12px]" onClick={() => join.mutate(r.name)} aria-label={`Join ${r.name}`}>
                        Join
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex min-w-0 grow flex-col">
          <TabStrip
            label="Joined rooms"
            tabs={joined.map((r) => ({ id: r.name, label: r.name, icon: r.private ? <Lock size={12} /> : undefined }))}
            active={active}
            onSelect={nav.setRoom}
            onClose={(room) => leave.mutate(room)}
          />
          {rooms.isPending ? <SkeletonRows className="px-7 py-4" count={8} row={() => <div className="py-2"><Bar w="60%" /></div>} /> : active ? <RoomChat key={active} room={active} /> : <NoRoom />}
        </div>
      </Body>
    </Screen>
  );
}

function NoRoom() {
  return (
    <ChatLog messages={[]} onUser={() => undefined} emptyLabel="Join a room from the list to start chatting" />
  );
}

function RoomChat({ room }: { room: string }) {
  const nav = useNav();
  const view = useRoom(room);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tickerOpen, setTickerOpen] = useState(false);
  const say = useMutation({ mutationFn: (text: string) => api.roomSay(room, text) });

  if (view.isPending) return <SkeletonRows className="px-7 py-4" count={8} row={() => <div className="py-2"><Bar w="60%" /></div>} />;
  if (view.isError) return <div className="p-7"><InlineError message={errorText(view.error)} onRetry={() => view.refetch()} /></div>;
  const v = view.data;

  return (
    <div className="flex min-h-0 grow">
      <div className="flex min-w-0 grow flex-col">
        <Ticker v={v} onSet={() => setTickerOpen(true)} onSearch={() => setSearchOpen(true)} />
        <ChatLog messages={v.messages} onUser={nav.openUser} emptyLabel="No messages yet. Say hello." />
        {say.isError && <div className="px-7"><InlineError message={errorText(say.error)} /></div>}
        <Composer placeholder={`Message ${room}`} onSend={(t) => say.mutateAsync(t)} />
      </div>
      <Aside label="Members" className="w-[240px]">
        <h2 className="px-5 pt-4 pb-2">
          Members <span className="font-normal text-faint">{num(v.members.length)}</span>
        </h2>
        <ul className="m-0 min-h-0 grow list-none overflow-auto px-2 pb-4">
          {[...v.members]
            .sort((a, b) => Number(b.operator) - Number(a.operator) || a.username.localeCompare(b.username))
            .map((m) => (
              <li key={m.username}>
                <button type="button" onClick={() => nav.openUser(m.username)} className="flex h-9 w-full items-center gap-2.5 rounded-ctl border-0 bg-transparent px-3 text-left text-text hover:bg-raised">
                  <PresenceDot presence={m.presence} />
                  <span className="min-w-0 grow truncate">{m.username}</span>
                  {m.operator && <span className="text-[12px] text-faint">operator</span>}
                  {!m.operator && m.files !== null && <span className="text-[12px] text-faint">{num(m.files)}</span>}
                </button>
              </li>
            ))}
        </ul>
      </Aside>
      <RoomSearchDialog room={room} open={searchOpen} onOpenChange={setSearchOpen} />
      <TickerDialog room={room} open={tickerOpen} onOpenChange={setTickerOpen} />
    </div>
  );
}

function Ticker({ v, onSet, onSearch }: { v: RoomView; onSet: () => void; onSearch: () => void }) {
  const t = v.tickers.at(-1);
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-7 text-[13px]">
      <span className="min-w-0 grow truncate text-faint">
        {t ? (
          <>
            <span className="text-muted">{t[0]}</span> {t[1]}
          </>
        ) : (
          "No ticker set"
        )}
      </span>
      <Button size="sm" variant="ghost" onClick={onSet}>
        Set ticker
      </Button>
      <Button size="sm" onClick={onSearch}>
        Search this room
      </Button>
    </div>
  );
}

function RoomSearchDialog({ room, open, onOpenChange }: { room: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const nav = useNav();
  const [q, setQ] = useState("");
  const run = useMutation({
    mutationFn: () => api.searchRoom(room, q.trim()),
    onSuccess: (id) => {
      onOpenChange(false);
      nav.openSearch({ id, label: `${room}: ${q.trim()}`, profileId: null, query: q.trim(), scope: { room } });
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Search ${room}`}
      description="Only people in this room are asked."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!q.trim() || run.isPending} onClick={() => run.mutate()}>
            Search
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), q.trim() && run.mutate())}>
        <Input autoFocus aria-label="Search query" placeholder="Artist, album or track" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      {run.isError && <div className="pt-3"><InlineError message={errorText(run.error)} /></div>}
    </Dialog>
  );
}

function TickerDialog({ room, open, onOpenChange }: { room: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [text, setText] = useState("");
  const set = useMutation({ mutationFn: () => api.roomSetTicker(room, text.trim()), onSuccess: () => onOpenChange(false) });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Set your ticker"
      description={`A short line everyone in ${room} sees. Leave it empty to clear it.`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={set.isPending} onClick={() => set.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <Input autoFocus aria-label="Ticker text" maxLength={120} value={text} onChange={(e) => setText(e.target.value)} />
      {set.isError && <div className="pt-3"><InlineError message={errorText(set.error)} /></div>}
    </Dialog>
  );
}
