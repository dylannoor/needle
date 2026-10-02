import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Interests } from "../../bindings/Interests";
import { Button } from "../../components/ui/button";
import { Tag } from "../../components/ui/chip";
import { Input } from "../../components/ui/input";
import { Segmented } from "../../components/ui/segmented";
import { Bar, GhostRows, InlineError, SkeletonRows } from "../../components/ui/states";
import { num } from "../../lib/format";
import { api, errorText } from "../../lib/ipc";
import { useNav } from "../../lib/nav";
import { keys, useInterests } from "../../lib/queries";

export function InterestsView() {
  const qc = useQueryClient();
  const nav = useNav();
  const interests = useInterests();
  const [scope, setScope] = useState<"you" | "global">("you");
  const recs = useQuery({ queryKey: keys.recommendations(scope === "global"), queryFn: () => api.recommendations(scope === "global") });
  const similar = useQuery({ queryKey: keys.similar, queryFn: api.similarUsers });
  const set = (i: Interests) => {
    qc.setQueryData(keys.interests, i);
    void qc.invalidateQueries({ queryKey: ["recommendations"] });
  };
  const add = useMutation({ mutationFn: ({ item, like }: { item: string; like: boolean }) => api.interestAdd(item, like), onSuccess: set });
  const remove = useMutation({ mutationFn: ({ item, like }: { item: string; like: boolean }) => api.interestRemove(item, like), onSuccess: set });
  const err = add.error ?? remove.error;
  const row = () => (
    <div className="flex h-10 items-center justify-between">
      <Bar w="50%" />
      <Bar w="15%" />
    </div>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-12 py-6">
      <div className="flex flex-col gap-8">
        {err && <InlineError message={errorText(err)} />}
        {interests.isError ? (
          <InlineError message={errorText(interests.error)} onRetry={() => interests.refetch()} />
        ) : (
          <>
            <InterestList title="Things you like" hint="Used for recommendations and shown on your profile." items={interests.data?.likes ?? []} onAdd={(item) => add.mutate({ item, like: true })} onRemove={(item) => remove.mutate({ item, like: true })} />
            <InterestList title="Things you dislike" items={interests.data?.dislikes ?? []} onAdd={(item) => add.mutate({ item, like: false })} onRemove={(item) => remove.mutate({ item, like: false })} />
          </>
        )}
      </div>
      <div className="flex flex-col gap-8">
        <section>
          <div className="flex items-center justify-between pb-2">
            <h2 className="text-[15px]">Recommendations</h2>
            <Segmented
              aria-label="Recommendation scope"
              value={scope}
              onChange={setScope}
              options={[
                { value: "you", label: "For you" },
                { value: "global", label: "Everyone" },
              ]}
            />
          </div>
          {recs.isPending ? (
            <SkeletonRows row={row} count={5} />
          ) : recs.isError ? (
            <InlineError message={errorText(recs.error)} onRetry={() => recs.refetch()} />
          ) : !recs.data.length ? (
            <GhostRows row={row} count={5} label="Add some likes to get recommendations" />
          ) : (
            <ul className="m-0 list-none p-0">
              {recs.data.map((r) => (
                <li key={r.item} className="flex h-10 items-center gap-3 border-b border-selected">
                  <span className="grow">{r.item}</span>
                  <span className="text-[12px] text-faint">{num(r.score)}</span>
                  <Button size="sm" variant="ghost" disabled={interests.data?.likes.includes(r.item)} onClick={() => add.mutate({ item: r.item, like: true })} aria-label={`Like ${r.item}`}>
                    {interests.data?.likes.includes(r.item) ? "Liked" : "Like"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2 className="pb-2 text-[15px]">People with similar taste</h2>
          {similar.isPending ? (
            <SkeletonRows row={row} count={4} />
          ) : similar.isError ? (
            <InlineError message={errorText(similar.error)} onRetry={() => similar.refetch()} />
          ) : !similar.data.length ? (
            <GhostRows row={row} count={4} label="Nobody found yet" />
          ) : (
            <ul className="m-0 list-none p-0">
              {similar.data.map((u) => (
                <li key={u} className="flex h-10 items-center gap-3 border-b border-selected">
                  <button type="button" className="grow border-0 bg-transparent p-0 text-left text-text hover:underline" onClick={() => nav.openUser(u)}>
                    {u}
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => nav.browseUser(u)}>
                    Browse
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function InterestList({ title, hint, items, onAdd, onRemove }: { title: string; hint?: string; items: string[]; onAdd: (i: string) => void; onRemove: (i: string) => void }) {
  const [text, setText] = useState("");
  return (
    <section>
      <h2 className="text-[15px]">{title}</h2>
      {hint && <p className="mt-1 mb-0 text-[13px] text-faint">{hint}</p>}
      <div className="flex min-h-7 flex-wrap gap-1.5 py-3">
        {items.length ? items.map((i) => <Tag key={i} onRemove={() => onRemove(i)} removeLabel={`Remove ${i}`}>{i}</Tag>) : <span className="text-[13px] text-faint">Nothing yet</span>}
      </div>
      <form
        className="flex max-w-[420px] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onAdd(text.trim());
          setText("");
        }}
      >
        <Input aria-label={`Add to ${title.toLowerCase()}`} placeholder="Artist, genre, label" value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" disabled={!text.trim()}>
          Add
        </Button>
      </form>
    </section>
  );
}
