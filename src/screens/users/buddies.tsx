import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Buddy } from "../../bindings/Buddy";
import { TableHead } from "../../components/layout";
import { PresenceDot } from "../../components/presence";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Bar, GhostRows, InlineError, SkeletonRows } from "../../components/ui/states";
import { cn } from "../../lib/cn";
import { ago, num } from "../../lib/format";
import { api, errorText } from "../../lib/ipc";
import { useNav } from "../../lib/nav";
import { keys, useBuddies } from "../../lib/queries";

const grid = "grid grid-cols-[220px_110px_minmax(0,1fr)_250px] items-center gap-4 px-3";

export function BuddyList() {
  const qc = useQueryClient();
  const q = useBuddies();
  const [name, setName] = useState("");
  const set = (l: Buddy[]) => qc.setQueryData(keys.buddies, l);
  const add = useMutation({
    mutationFn: api.buddyAdd,
    onSuccess: (l) => {
      set(l);
      setName("");
    },
  });
  const remove = useMutation({ mutationFn: api.buddyRemove, onSuccess: set });
  const note = useMutation({ mutationFn: ({ u, n }: { u: string; n: string }) => api.buddyNote(u, n), onSuccess: set });
  const err = add.error ?? remove.error ?? note.error;

  const ghost = () => (
    <div className={cn(grid, "h-row")}>
      <Bar w="60%" />
      <Bar w="60%" />
      <Bar w="50%" />
      <Bar w="70%" className="justify-self-end" />
    </div>
  );

  return (
    <div className="flex h-full flex-col pt-5">
      <form
        className="flex max-w-[460px] gap-2 pb-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate(name.trim());
        }}
      >
        <Input aria-label="Add a buddy" placeholder="Username to add as buddy" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!name.trim() || add.isPending}>
          Add buddy
        </Button>
      </form>
      {err && (
        <div className="pb-3">
          <InlineError message={errorText(err)} />
        </div>
      )}
      <TableHead className={cn(grid, "mb-1")}>
        <span>Buddy</span>
        <span>Files</span>
        <span>Note</span>
        <span />
      </TableHead>
      {q.isPending ? (
        <SkeletonRows row={ghost} />
      ) : q.isError ? (
        <InlineError message={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <GhostRows row={ghost} label="No buddies yet. Buddies can get your upload slots first." />
      ) : (
        <div className="min-h-0 grow overflow-auto pb-4">
          {[...q.data]
            .sort((a, b) => Number(b.presence === "online") - Number(a.presence === "online") || a.username.localeCompare(b.username))
            .map((b) => (
              <BuddyRow key={b.username} b={b} onNote={(n) => note.mutate({ u: b.username, n })} onRemove={() => remove.mutate(b.username)} />
            ))}
        </div>
      )}
    </div>
  );
}

function BuddyRow({ b, onNote, onRemove }: { b: Buddy; onNote: (n: string) => void; onRemove: () => void }) {
  const nav = useNav();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(b.note);
  return (
    <div className={cn(grid, "group h-row rounded-ctl hover:bg-raised")}>
      <span className="flex min-w-0 items-center gap-2.5">
        <PresenceDot presence={b.presence} />
        <button type="button" className="truncate border-0 bg-transparent p-0 text-left font-semibold text-text hover:underline" onClick={() => nav.openUser(b.username)}>
          {b.username}
        </button>
        {b.presence === "offline" && b.lastSeenMs && <span className="shrink-0 text-[12px] text-faint">seen {ago(b.lastSeenMs)}</span>}
      </span>
      <span className="text-muted">{b.files !== null ? num(b.files) : "Unknown"}</span>
      {editing ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onNote(draft.trim());
            setEditing(false);
          }}
        >
          <Input autoFocus aria-label={`Note for ${b.username}`} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} className="h-[30px] text-[13px]" />
          <Button type="submit" size="sm">
            Save
          </Button>
        </form>
      ) : (
        <button type="button" onClick={() => (setDraft(b.note), setEditing(true))} className={cn("truncate border-0 bg-transparent p-0 text-left text-[13px] hover:text-text", b.note ? "text-muted" : "text-faint")} aria-label={`Edit note for ${b.username}`}>
          {b.note || "Add a note"}
        </button>
      )}
      <span className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => nav.messageUser(b.username)}>
          Message
        </Button>
        <Button size="sm" variant="ghost" onClick={() => nav.browseUser(b.username)}>
          Browse
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${b.username} from buddies`}>
          Remove
        </Button>
      </span>
    </div>
  );
}
