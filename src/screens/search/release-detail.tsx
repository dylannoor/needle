import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Release } from "../../bindings/Release";
import { AsideTitle } from "../../components/layout";
import { Button } from "../../components/ui/button";
import { Check } from "../../components/ui/input";
import { InlineError } from "../../components/ui/states";
import { bytes } from "../../lib/format";
import { api, errorText } from "../../lib/ipc";
import { useNav } from "../../lib/nav";
import { keys, upsertJob } from "../../lib/queries";
import { audioFiles, trackTitle } from "../../lib/releases";
import type { JobView } from "../../bindings/JobView";

const PREVIEW = 8;

export function ReleaseDetail({ searchId, release }: { searchId: string; release: Release }) {
  const qc = useQueryClient();
  const nav = useNav();
  const tracks = audioFiles(release);
  const [expanded, setExpanded] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const download = useMutation({
    mutationFn: (files: string[] | null) => api.downloadRelease(searchId, release.id, files),
    onSuccess: (job) => {
      qc.setQueryData<JobView[]>(keys.jobs, (l) => upsertJob(l, job));
      setPicking(false);
    },
  });

  const visible = expanded || picking ? tracks : tracks.slice(0, PREVIEW);
  const backups = release.alternates.length;
  const toggle = (path: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  return (
    <div className="flex min-h-0 grow flex-col px-7 py-6">
      <AsideTitle>{release.title}</AsideTitle>
      <div className="pt-0.5 text-muted">{[release.artist, release.formatLabel, bytes(release.best.totalSize)].filter(Boolean).join(" · ")}</div>
      <p className="mt-4 mb-6 text-[13px] text-muted">
        From {release.best.source.username}.{" "}
        {backups > 0
          ? `If it stalls or a file fails the check, Needle switches to one of ${backups} identical ${backups === 1 ? "source" : "sources"}.`
          : "Nobody else has an identical copy, so there is no backup source."}
      </p>

      <div className="min-h-0 grow overflow-auto">
        <ol className="m-0 list-none p-0" aria-label="Tracks">
          {visible.map((f, i) => (
            <li key={f.path} className="flex h-[30px] items-center gap-3.5 text-[13px]">
              {picking ? (
                <label className="flex min-w-0 items-center gap-3.5">
                  <Check checked={picked.has(f.path)} onChange={() => toggle(f.path)} aria-label={`Pick ${trackTitle(f.path)}`} />
                  <span className="truncate">{trackTitle(f.path)}</span>
                </label>
              ) : (
                <>
                  <span className="w-[18px] shrink-0 text-right text-faint">{i + 1}</span>
                  <span className="truncate">{trackTitle(f.path)}</span>
                </>
              )}
            </li>
          ))}
        </ol>
        {!picking && tracks.length > PREVIEW && (
          <button type="button" className="link pt-2 pl-8 text-[13px]" onClick={() => setExpanded((e) => !e)}>
            {expanded ? "Show fewer" : `All ${tracks.length} tracks`}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 pt-5">
        {download.isError && <InlineError message={errorText(download.error)} />}
        {download.isSuccess && !picking && (
          <p className="m-0 text-[13px] text-muted" role="status">
            Added to your downloads.{" "}
            <button type="button" className="link" onClick={() => nav.go("transfers")}>
              Open Transfers
            </button>
          </p>
        )}
        {picking ? (
          <div className="flex gap-2">
            <Button className="justify-center" size="lg" onClick={() => setPicking(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" className="grow" disabled={!picked.size || download.isPending} onClick={() => download.mutate([...picked])}>
              {picked.size ? `Download ${picked.size} ${picked.size === 1 ? "file" : "files"}` : "Pick some files"}
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="lg" onClick={() => setPicking(true)}>
              Pick files
            </Button>
            <Button variant="primary" size="lg" className="grow" disabled={download.isPending} onClick={() => download.mutate(null)}>
              Download release
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
