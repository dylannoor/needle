import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { TableHead } from "../../components/layout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Bar, GhostRows, InlineError, SkeletonRows } from "../../components/ui/states";
import { StatusDot } from "../../components/ui/status";
import { cn } from "../../lib/cn";
import { ago, plural } from "../../lib/format";
import { api, errorText } from "../../lib/ipc";
import { useNav } from "../../lib/nav";
import { keys, useWishlist } from "../../lib/queries";

const grid = "grid grid-cols-[minmax(0,1fr)_120px_130px_130px_190px] items-center gap-4 px-3";

export function WishlistPanel() {
  const qc = useQueryClient();
  const nav = useNav();
  const list = useWishlist();
  const [query, setQuery] = useState("");
  const add = useMutation({
    mutationFn: (q: string) => api.wishlistAdd(q),
    onSuccess: (l) => {
      qc.setQueryData(keys.wishlist, l);
      setQuery("");
    },
  });
  const remove = useMutation({ mutationFn: api.wishlistRemove, onSuccess: (l) => qc.setQueryData(keys.wishlist, l) });

  const ghost = () => (
    <div className={cn(grid, "h-row")}>
      <Bar w="60%" />
      <Bar w="60%" />
      <Bar w="70%" />
      <Bar w="50%" />
      <Bar w="40%" />
    </div>
  );

  return (
    <div className="flex min-w-0 grow flex-col p-4">
      <div className="px-3 pb-5">
        <h2 className="text-[15px]">Wishlist</h2>
        <p className="mt-1 mb-4 text-[13px] text-faint">Needle keeps searching for these in the background and tells you when a release matches your profile.</p>
        <form
          className="flex max-w-[560px] gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(query);
          }}
        >
          <Input aria-label="Add to wishlist" placeholder="Artist and album you're after" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit" disabled={!query.trim() || add.isPending}>
            Add
          </Button>
        </form>
        {add.isError && (
          <div className="max-w-[560px] pt-3">
            <InlineError message={errorText(add.error)} />
          </div>
        )}
      </div>
      <TableHead className={cn(grid, "mb-1")}>
        <span>Looking for</span>
        <span>Added</span>
        <span>Last run</span>
        <span>Matches</span>
        <span />
      </TableHead>
      {list.isPending ? (
        <SkeletonRows row={ghost} count={3} />
      ) : list.isError ? (
        <InlineError message={errorText(list.error)} onRetry={() => list.refetch()} />
      ) : !list.data.length ? (
        <GhostRows row={ghost} count={4} label="Nothing on your wishlist yet" />
      ) : (
        <div className="min-h-0 overflow-auto">
          {list.data.map((w) => (
            <div key={w.query} className={cn(grid, "h-row rounded-ctl hover:bg-raised")}>
              <span className="truncate font-semibold">{w.query}</span>
              <span className="text-muted">{ago(w.addedMs)}</span>
              <span className="text-muted">{w.lastRunMs ? ago(w.lastRunMs) : "Not run yet"}</span>
              <span className="flex items-center gap-2">
                <StatusDot tone={w.matches ? "ok" : "idle"} />
                <span className="text-muted">{w.matches ? plural(w.matches, "release") : "No matches"}</span>
              </span>
              <span className="flex justify-end gap-2">
                {w.searchId && (
                  <Button size="sm" onClick={() => nav.openSearch({ id: w.searchId as string, label: w.query, profileId: null })}>
                    Open results
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(w.query)} aria-label={`Remove ${w.query}`}>
                  Remove
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
