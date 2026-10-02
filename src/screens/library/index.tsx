import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ScanStatus } from "../../bindings/ScanStatus";
import type { SharesView } from "../../bindings/SharesView";
import type { Visibility } from "../../bindings/Visibility";
import { Aside, Body, Screen, Spacer, TableHead, TopBar } from "../../components/layout";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioItems, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Field } from "../../components/ui/field";
import { ChevronDown, Warning } from "../../components/ui/icons";
import { Bar, GhostRows, InlineError, SkeletonRows } from "../../components/ui/states";
import { ProgressBar, StatusDot, type Tone } from "../../components/ui/status";
import { Stepper } from "../../components/ui/stepper";
import { Switch } from "../../components/ui/switch";
import { cn } from "../../lib/cn";
import { ago, bytes, num, plural, speed } from "../../lib/format";
import { api, errorText } from "../../lib/ipc";
import { keys, useSaveSettings, useSettings, useShares, useUploads } from "../../lib/queries";

const cols = "grid grid-cols-[minmax(0,1fr)_80px_80px_150px_170px] items-center gap-4 px-3";

export const visibilityLabel: Record<Visibility, string> = { everyone: "Everyone", buddies: "Buddies only", nobody: "Nobody" };
const visibilityOptions = (Object.keys(visibilityLabel) as Visibility[]).map((v) => ({ value: v, label: visibilityLabel[v] }));

function scanText(s: ScanStatus): { tone: Tone; text: string } {
  switch (s.kind) {
    case "scanned":
      return { tone: "ok", text: `Scanned ${ago(s.at_ms)}` };
    case "scanning":
      return { tone: "busy", text: `Scanning, ${Math.round(s.percent)}%` };
    case "error":
      return { tone: "bad", text: s.message };
    case "notShared":
      return { tone: "idle", text: "Not shared" };
  }
}

export function LibraryScreen() {
  const qc = useQueryClient();
  const shares = useShares();
  const [review, setReview] = useState(false);
  const set = (v: SharesView) => qc.setQueryData(keys.shares, v);
  const add = useMutation({
    mutationFn: async () => {
      const path = await api.pickFolder();
      return path ? api.shareAdd(path, "everyone") : null;
    },
    onSuccess: (v) => v && set(v),
  });
  const rescan = useMutation({ mutationFn: api.sharesRescan, onSuccess: set });
  const visibility = useMutation({ mutationFn: ({ path, v }: { path: string; v: Visibility }) => api.shareSetVisibility(path, v), onSuccess: set });
  const remove = useMutation({ mutationFn: api.shareRemove, onSuccess: set });
  const err = add.error ?? rescan.error ?? visibility.error ?? remove.error;
  const data = shares.data;

  const ghost = () => (
    <div className={cn(cols, "h-[54px] border-b border-line-soft")}>
      <Bar w="50%" />
      <Bar w="80%" className="justify-self-end" />
      <Bar w="80%" className="justify-self-end" />
      <Bar w="60%" />
      <Bar w="70%" />
    </div>
  );

  return (
    <Screen>
      <TopBar>
        <h1 data-tauri-drag-region>Library &amp; shares</h1>
        <Spacer />
        <Button onClick={() => rescan.mutate()} disabled={rescan.isPending || !data?.folders.length}>
          Rescan
        </Button>
        <Button variant="primary" onClick={() => add.mutate()} disabled={add.isPending}>
          Add folder
        </Button>
      </TopBar>
      <Body>
        <div className="flex min-w-0 grow flex-col overflow-auto px-4 py-6">
          <p className="m-0 px-3 pb-6 text-muted">
            {data ? (
              data.folders.length ? (
                <>
                  <span className="font-semibold text-text">{plural(data.sharedFiles, "file")}</span> in {plural(data.sharedFolders, "folder")} are searchable by others. {num(data.ownedFiles)} of them show up as "you have this" in your own searches.
                </>
              ) : (
                "Add the folders with your music. Others can search them, and Needle uses them to mark releases you already have."
              )
            ) : (
              " "
            )}
          </p>
          {err && (
            <div className="px-3 pb-4">
              <InlineError message={errorText(err)} />
            </div>
          )}
          <TableHead className={cols}>
            <span>Folder</span>
            <span className="text-right">Files</span>
            <span className="text-right">Size</span>
            <span>Who can see it</span>
            <span>Status</span>
          </TableHead>
          {shares.isPending ? (
            <SkeletonRows row={ghost} />
          ) : shares.isError ? (
            <div className="p-3">
              <InlineError message={errorText(shares.error)} onRetry={() => shares.refetch()} />
            </div>
          ) : !data?.folders.length ? (
            <GhostRows row={ghost} label="No shared folders yet" action={<Button size="sm" onClick={() => add.mutate()}>Add folder</Button>} />
          ) : (
            data.folders.map((f) => {
              const st = scanText(f.status);
              return (
                <div key={f.path} className={cn(cols, "h-[54px] border-b border-line-soft")}>
                  <span className={cn("truncate", f.visibility === "nobody" ? "text-faint" : "text-text")} title={f.path}>
                    {f.path}
                  </span>
                  <span className="text-right">{num(f.files)}</span>
                  <span className="text-right text-muted">{bytes(f.bytes)}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" className="justify-self-start" aria-label={`Who can see ${f.path}: ${visibilityLabel[f.visibility]}`}>
                        {visibilityLabel[f.visibility]}
                        <ChevronDown size={13} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuRadioItems value={f.visibility} onValueChange={(v) => visibility.mutate({ path: f.path, v })} options={visibilityOptions} />
                      <DropdownMenuSeparator />
                      <DropdownMenuItem danger onSelect={() => remove.mutate(f.path)}>
                        Remove from library
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span className="flex min-w-0 items-center gap-2 text-[13px]">
                    <StatusDot tone={st.tone} />
                    <span className="truncate text-muted">{st.text}</span>
                  </span>
                </div>
              );
            })
          )}
          {data && data.unreadable.length > 0 && (
            <div className="flex items-center gap-2.5 px-3 py-[18px] text-[13px]">
              <Warning size={16} className="text-warn" />
              <span className="text-muted">{plural(data.unreadable.length, "file")} can't be read, so nobody can find them.</span>
              <button type="button" className="link" onClick={() => setReview(true)}>
                Review
              </button>
            </div>
          )}
        </div>
        <Aside label="Uploads">
          <div className="flex min-h-0 grow flex-col overflow-auto px-7 py-6">
            <UploadingNow />
            <UploadRules />
          </div>
        </Aside>
      </Body>
      <Dialog open={review} onOpenChange={setReview} title="Files Needle can't read" description="They may be damaged, still copying, or not readable by your user. Fix or remove them, then rescan." width={560} footer={<Button onClick={() => setReview(false)}>Close</Button>}>
        <ul className="m-0 max-h-[320px] list-none overflow-auto rounded-ctl border border-line-strong p-2 text-[13px] text-muted" data-selectable>
          {data?.unreadable.map((p) => (
            <li key={p} className="truncate py-1">
              {p}
            </li>
          ))}
        </ul>
      </Dialog>
    </Screen>
  );
}

function UploadingNow() {
  const q = useUploads();
  const active = (q.data?.uploads ?? []).filter((u) => u.state.kind === "uploading");
  const ghost = () => (
    <div className="flex flex-col gap-2 border-b border-selected py-3.5">
      <Bar w="40%" />
      <Bar w="80%" />
      <Bar w="100%" className="h-[3px]" />
    </div>
  );
  return (
    <section aria-label="Uploading now">
      <h2>
        Uploading now{" "}
        {q.data && (
          <span className="font-normal text-faint">
            {q.data.slotsUsed} of {q.data.slots} slots · {q.data.waiting} waiting
          </span>
        )}
      </h2>
      {q.isPending ? (
        <SkeletonRows row={ghost} count={2} />
      ) : !active.length ? (
        <GhostRows row={ghost} count={2} label="Nobody is downloading from you" />
      ) : (
        active.map((u) => (
          <div key={`${u.username}/${u.path}`} className="flex flex-col gap-1.5 border-b border-selected py-3.5">
            <div className="flex justify-between">
              <span className="font-medium">{u.username}</span>
              <span className="text-[13px] text-faint">{speed(u.speed)}</span>
            </div>
            <span className="truncate text-[12px] text-faint">{u.path}</span>
            <ProgressBar value={u.size ? u.bytes / u.size : 0} label={`Upload to ${u.username}`} />
          </div>
        ))
      )}
    </section>
  );
}

function UploadRules() {
  const settings = useSettings().data;
  const save = useSaveSettings();
  if (!settings) return null;
  return (
    <section aria-label="Upload rules" className="pt-9">
      <h2 className="pb-1">Upload rules</h2>
      <Field label="Upload slots" htmlFor="slots">
        <Stepper id="slots" value={settings.uploadSlots} min={0} max={20} incLabel="More slots" decLabel="Fewer slots" onChange={(uploadSlots) => save.mutate({ uploadSlots })} />
      </Field>
      <Field label="Upload speed limit" htmlFor="limit" hint="0 means no limit">
        <Stepper id="limit" unit="MB/s" value={Math.round(settings.uploadLimitKbps / 1000)} min={0} max={100} incLabel="Raise limit" decLabel="Lower limit" onChange={(v) => save.mutate({ uploadLimitKbps: v * 1000 })} />
      </Field>
      <Field label="Buddies go first in the queue" labelId="buddies-first" last>
        <Switch aria-labelledby="buddies-first" checked={settings.buddiesFirst} onCheckedChange={(buddiesFirst) => save.mutate({ buddiesFirst })} />
      </Field>
      {save.isError && <InlineError message={errorText(save.error)} />}
    </section>
  );
}
