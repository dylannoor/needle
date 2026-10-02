import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { UserProfile } from "../../bindings/UserProfile";
import { PresenceDot } from "../../components/presence";
import { Button } from "../../components/ui/button";
import { Tag } from "../../components/ui/chip";
import { Dialog } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Bar, InlineError, SkeletonRows } from "../../components/ui/states";
import { num, presenceLabel, speed } from "../../lib/format";
import { api, errorText } from "../../lib/ipc";
import { useNav } from "../../lib/nav";
import { keys, useUserProfile } from "../../lib/queries";
import { BackLink } from "./back-link";

export function ProfileView({ username }: { username: string }) {
  const q = useUserProfile(username);
  return (
    <div className="flex min-w-0 grow flex-col overflow-auto px-7 py-5">
      <BackLink />
      {q.isPending ? (
        <div className="pt-6">
          <p className="m-0 pb-4 text-[13px] text-muted">Asking {username} for their profile. This can take a few seconds.</p>
          <SkeletonRows count={4} row={(i) => <div className="py-2.5"><Bar w={`${60 - i * 10}%`} /></div>} />
        </div>
      ) : q.isError ? (
        <div className="max-w-[640px] pt-6">
          <InlineError message={errorText(q.error)} onRetry={() => q.refetch()} />
        </div>
      ) : (
        <Profile p={q.data} />
      )}
    </div>
  );
}

function Profile({ p }: { p: UserProfile }) {
  const qc = useQueryClient();
  const nav = useNav();
  const [searchOpen, setSearchOpen] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.user(p.username) });
    void qc.invalidateQueries({ queryKey: keys.buddies });
    void qc.invalidateQueries({ queryKey: keys.blocked });
  };
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });
  const stats = [
    p.avgSpeed !== null && speed(p.avgSpeed),
    p.files !== null && `${num(p.files)} files${p.folders !== null ? ` in ${num(p.folders)} folders` : ""}`,
    p.freeSlot === true ? "free upload slot" : p.queueLen ? `${num(p.queueLen)} in their queue` : null,
  ].filter(Boolean);

  return (
    <div className="flex max-w-[760px] flex-col pt-6">
      <div className="flex items-center gap-5">
        {p.picture ? (
          <img src={p.picture} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div aria-hidden="true" className="grid h-16 w-16 place-items-center rounded-full bg-raised-hi text-[24px] font-semibold text-muted">
            {p.username.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-[22px] font-[650] tracking-[-0.015em]">{p.username}</h2>
          <div className="flex items-center gap-2 pt-1 text-[13px] text-muted">
            <PresenceDot presence={p.presence} />
            {[presenceLabel[p.presence], ...stats].join(" · ")}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-6">
        <Button variant="primary" onClick={() => nav.messageUser(p.username)}>
          Message
        </Button>
        <Button onClick={() => nav.browseUser(p.username)}>Browse files</Button>
        <Button onClick={() => setSearchOpen(true)}>Search their files</Button>
        <Button onClick={() => act.mutate(() => (p.buddy ? api.buddyRemove(p.username) : api.buddyAdd(p.username)))}>{p.buddy ? "Remove buddy" : "Add buddy"}</Button>
        <Button variant="ghost" onClick={() => act.mutate(() => (p.ignored ? api.userUnignore(p.username) : api.userIgnore(p.username)))}>
          {p.ignored ? "Stop ignoring" : "Ignore"}
        </Button>
        <Button variant={p.banned ? "ghost" : "danger"} onClick={() => act.mutate(() => (p.banned ? api.userUnban(p.username) : api.userBan(p.username)))}>
          {p.banned ? "Unban" : "Ban"}
        </Button>
      </div>
      {act.isError && (
        <div className="pt-3">
          <InlineError message={errorText(act.error)} />
        </div>
      )}
      {(p.banned || p.ignored) && (
        <p className="m-0 pt-3 text-[13px] text-warn">
          {p.banned && "Banned: they can't download from you. "}
          {p.ignored && "Ignored: you won't see their messages."}
        </p>
      )}

      <section className="pt-8">
        <h3 className="m-0 pb-2 text-[13px] font-semibold">About</h3>
        <p className="m-0 text-muted whitespace-pre-line" data-selectable>
          {p.description || `${p.username} hasn't written anything about themselves.`}
        </p>
      </section>
      <div className="grid grid-cols-2 gap-8 pt-8">
        <section>
          <h3 className="m-0 pb-2.5 text-[13px] font-semibold">Likes</h3>
          <div className="flex flex-wrap gap-1.5">{p.likes.length ? p.likes.map((l) => <Tag key={l}>{l}</Tag>) : <span className="text-[13px] text-faint">Nothing listed</span>}</div>
        </section>
        <section>
          <h3 className="m-0 pb-2.5 text-[13px] font-semibold">Dislikes</h3>
          <div className="flex flex-wrap gap-1.5">{p.dislikes.length ? p.dislikes.map((l) => <Tag key={l}>{l}</Tag>) : <span className="text-[13px] text-faint">Nothing listed</span>}</div>
        </section>
      </div>
      <UserSearchDialog username={p.username} open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

function UserSearchDialog({ username, open, onOpenChange }: { username: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const nav = useNav();
  const [q, setQ] = useState("");
  const run = useMutation({
    mutationFn: () => api.searchUser(username, q.trim()),
    onSuccess: (id) => {
      onOpenChange(false);
      nav.openSearch({ id, label: `${username}: ${q.trim()}`, profileId: null });
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Search ${username}'s files`}
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
