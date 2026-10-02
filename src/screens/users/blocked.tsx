import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Bar, GhostRows, InlineError, SkeletonRows } from "../../components/ui/states";
import { api, errorText } from "../../lib/ipc";
import { useNav } from "../../lib/nav";
import { keys, useBlocked } from "../../lib/queries";

export function BlockedLists() {
  const qc = useQueryClient();
  const q = useBlocked();
  const [name, setName] = useState("");
  const act = useMutation({
    mutationFn: (fn: () => Promise<void>) => fn(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.blocked });
      setName("");
    },
  });
  const u = name.trim();
  return (
    <div className="flex flex-col py-6">
      <div className="flex max-w-[520px] gap-2 pb-6">
        <Input aria-label="Username to ban or ignore" placeholder="Username" value={name} onChange={(e) => setName(e.target.value)} />
        <Button disabled={!u} onClick={() => act.mutate(() => api.userIgnore(u))}>
          Ignore
        </Button>
        <Button variant="danger" disabled={!u} onClick={() => act.mutate(() => api.userBan(u))}>
          Ban
        </Button>
      </div>
      {act.isError && (
        <div className="max-w-[520px] pb-4">
          <InlineError message={errorText(act.error)} />
        </div>
      )}
      {q.isError ? (
        <InlineError message={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-12">
          <UserList title="Banned" hint="They can't download from you or browse your shares." loading={q.isPending} users={q.data?.banned ?? []} action="Unban" onAction={(x) => act.mutate(() => api.userUnban(x))} />
          <UserList title="Ignored" hint="Their messages are hidden everywhere." loading={q.isPending} users={q.data?.ignored ?? []} action="Stop ignoring" onAction={(x) => act.mutate(() => api.userUnignore(x))} />
        </div>
      )}
    </div>
  );
}

function UserList({ title, hint, users, loading, action, onAction }: { title: string; hint: string; users: string[]; loading: boolean; action: string; onAction: (u: string) => void }) {
  const nav = useNav();
  const row = () => (
    <div className="flex h-11 items-center justify-between">
      <Bar w="40%" />
      <Bar w="20%" />
    </div>
  );
  return (
    <section>
      <h2 className="text-[15px]">{title}</h2>
      <p className="mt-1 mb-3 text-[13px] text-faint">{hint}</p>
      {loading ? (
        <SkeletonRows row={row} count={3} />
      ) : !users.length ? (
        <GhostRows row={row} count={3} label={`Nobody ${title.toLowerCase()}`} />
      ) : (
        <ul className="m-0 list-none p-0">
          {users.map((x) => (
            <li key={x} className="flex h-11 items-center gap-3 border-b border-selected">
              <button type="button" className="grow border-0 bg-transparent p-0 text-left text-text hover:underline" onClick={() => nav.openUser(x)}>
                {x}
              </button>
              <Button size="sm" variant="ghost" onClick={() => onAction(x)}>
                {action}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
