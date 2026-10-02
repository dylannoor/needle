import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FileInfo } from "../../bindings/FileInfo";
import type { JobView } from "../../bindings/JobView";
import type { SharedDir } from "../../bindings/SharedDir";
import { TableHead } from "../../components/layout";
import { Button } from "../../components/ui/button";
import { ChevronRight, Folder, Lock } from "../../components/ui/icons";
import { Check } from "../../components/ui/input";
import { Bar, GhostRows, InlineError, SkeletonRows } from "../../components/ui/states";
import { cn } from "../../lib/cn";
import { baseName, bytes, clock, codecName, plural } from "../../lib/format";
import { api, errorText } from "../../lib/ipc";
import { useNav } from "../../lib/nav";
import { keys, upsertJob } from "../../lib/queries";
import { BackLink } from "./back-link";

export interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  dir: SharedDir | null;
  locked: boolean;
}

/** Turn flat `a\b\c` folder paths into a tree. */
export function buildTree(dirs: SharedDir[], locked: SharedDir[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [], dir: null, locked: false };
  const add = (d: SharedDir, isLocked: boolean) => {
    let node = root;
    const parts = d.path.split("\\").filter(Boolean);
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("\\");
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, children: [], dir: null, locked: isLocked };
        node.children.push(child);
      }
      if (!isLocked) child.locked = false;
      node = child;
    });
    node.dir = d;
  };
  dirs.forEach((d) => add(d, false));
  locked.forEach((d) => add(d, true));
  return root.children;
}

const fileGrid = "grid grid-cols-[24px_minmax(0,1fr)_120px_90px_70px] items-center gap-3 px-3";
const fmt = (f: FileInfo) =>
  f.codec === "other" ? "" : [codecName[f.codec], f.bitDepth && f.sampleRate ? `${f.bitDepth}/${f.sampleRate / 1000}` : f.bitrateKbps ? `${f.bitrateKbps}${f.vbr ? " VBR" : ""}` : null].filter(Boolean).join(" ");

export function BrowseView({ username }: { username: string }) {
  const qc = useQueryClient();
  const nav = useNav();
  const q = useQuery({ queryKey: keys.browse(username), queryFn: () => api.browseUser(username), staleTime: 5 * 60_000 });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const download = useMutation({
    mutationFn: ({ folder, files }: { folder: string; files: FileInfo[] }) => api.downloadFiles(username, folder, files),
    onSuccess: (job) => {
      qc.setQueryData<JobView[]>(keys.jobs, (l) => upsertJob(l, job));
      setPicked(new Set());
    },
  });

  const tree = q.data ? buildTree(q.data.dirs, q.data.lockedDirs) : [];
  const files = selected?.dir?.files ?? [];
  const toggle = (path: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  const renderNode = (n: TreeNode, depth: number) => {
    const isOpen = open.has(n.path);
    return (
      <li key={n.path}>
        <button
          type="button"
          aria-expanded={n.children.length ? isOpen : undefined}
          onClick={() => {
            if (n.children.length) toggle(n.path);
            if (n.dir) {
              setSelected(n);
              setPicked(new Set());
            }
          }}
          style={{ paddingLeft: 8 + depth * 14 }}
          className={cn("flex h-8 w-full items-center gap-1.5 rounded-sm border-0 pr-2 text-left text-[13px] text-text", selected?.path === n.path ? "bg-selected" : "bg-transparent hover:bg-raised")}
        >
          <span className={cn("w-3.5 text-faint transition-transform duration-150", isOpen && "rotate-90", !n.children.length && "invisible")}>
            <ChevronRight size={14} />
          </span>
          {n.locked ? <Lock size={14} className="text-faint" /> : <Folder size={14} className="text-faint" />}
          <span className="truncate">{n.name}</span>
        </button>
        {isOpen && n.children.length > 0 && <ul className="m-0 list-none p-0">{n.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  const ghost = () => (
    <div className={cn(fileGrid, "h-10")}>
      <span />
      <Bar w="60%" />
      <Bar w="70%" />
      <Bar w="60%" />
      <Bar w="60%" />
    </div>
  );

  return (
    <div className="flex min-w-0 grow flex-col px-7 py-5">
      <div className="flex items-center gap-3 pb-4">
        <BackLink />
        <div className="grow" />
        <Button size="sm" variant="ghost" onClick={() => nav.openUser(username)}>
          {username}'s profile
        </Button>
      </div>
      <h2 className="pb-4 text-[17px]">{username}'s files</h2>
      {q.isPending ? (
        <div>
          <p className="m-0 pb-4 text-[13px] text-muted">Getting {username}'s file list. Big shares can take up to a minute.</p>
          <SkeletonRows row={ghost} count={8} />
        </div>
      ) : q.isError || q.data.error ? (
        <div className="max-w-[640px]">
          <InlineError message={q.isError ? errorText(q.error) : (q.data.error ?? "")} onRetry={() => q.refetch()} />
        </div>
      ) : (
        <div className="flex min-h-0 grow gap-6">
          <nav aria-label="Folders" className="w-[300px] shrink-0 overflow-auto border-r border-line pr-3">
            <ul className="m-0 list-none p-0">{tree.map((n) => renderNode(n, 0))}</ul>
          </nav>
          <div className="flex min-w-0 grow flex-col">
            {selected?.dir ? (
              <>
                <div className="flex items-center gap-3 pb-3">
                  <span className="min-w-0 grow truncate font-semibold" title={selected.path}>
                    {baseName(selected.path)}
                  </span>
                  {selected.locked ? (
                    <span className="flex items-center gap-1.5 text-[13px] text-faint">
                      <Lock size={13} /> Only {username}'s buddies can download this
                    </span>
                  ) : (
                    <>
                      <Button size="sm" disabled={!picked.size || download.isPending} onClick={() => download.mutate({ folder: selected.path, files: files.filter((f) => picked.has(f.path)) })}>
                        {picked.size ? `Download ${plural(picked.size, "file")}` : "Pick files"}
                      </Button>
                      <Button size="sm" variant="primary" disabled={download.isPending} onClick={() => download.mutate({ folder: selected.path, files })}>
                        Download folder
                      </Button>
                    </>
                  )}
                </div>
                {download.isError && <InlineError message={errorText(download.error)} />}
                {download.isSuccess && (
                  <p role="status" className="m-0 pb-2 text-[13px] text-muted">
                    Added to your downloads.{" "}
                    <button type="button" className="link" onClick={() => nav.go("transfers")}>
                      Open Transfers
                    </button>
                  </p>
                )}
                <TableHead className={fileGrid}>
                  <span />
                  <span>File</span>
                  <span>Format</span>
                  <span>Size</span>
                  <span>Length</span>
                </TableHead>
                <div className="min-h-0 grow overflow-auto">
                  {files.map((f) => (
                    <label key={f.path} className={cn(fileGrid, "h-10 cursor-pointer rounded-sm hover:bg-raised")}>
                      <Check
                        disabled={selected.locked}
                        checked={picked.has(f.path)}
                        aria-label={`Pick ${baseName(f.path)}`}
                        onChange={() =>
                          setPicked((p) => {
                            const n = new Set(p);
                            if (n.has(f.path)) n.delete(f.path);
                            else n.add(f.path);
                            return n;
                          })
                        }
                      />
                      <span className="truncate text-[13px]">{baseName(f.path)}</span>
                      <span className="text-[13px] text-muted">{fmt(f)}</span>
                      <span className="text-[13px] text-muted">{bytes(f.size)}</span>
                      <span className="text-[13px] text-muted">{f.durationSecs ? clock(f.durationSecs) : ""}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <GhostRows row={ghost} count={8} label="Pick a folder on the left" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
