import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
import type { JobView } from "../../bindings/JobView";
import type { UploadView } from "../../bindings/UploadView";
import { Aside, Body, Screen, Spacer, TopBar } from "../../components/layout";
import { Button } from "../../components/ui/button";
import { Segmented } from "../../components/ui/segmented";
import { Bar, GhostRows, InlineError, SkeletonRows } from "../../components/ui/states";
import { ProgressBar, StatusDot, type Tone } from "../../components/ui/status";
import { cn } from "../../lib/cn";
import { bytes, speed } from "../../lib/format";
import { api, errorText } from "../../lib/ipc";
import { isFinished, jobMeta, jobStatus, progress, rejectedItem } from "../../lib/jobs";
import { keys, useJobs, useUploads } from "../../lib/queries";
import { JobDetail } from "./job-detail";

type Tab = "downloads" | "uploads";

export function TransfersScreen() {
  const [tab, setTab] = useState<Tab>("downloads");
  const jobs = useJobs();
  const uploads = useUploads();
  const list = jobs.data ?? [];
  const active = list.filter((j) => !isFinished(j));
  const up = uploads.data?.uploads ?? [];
  const upActive = up.filter((u) => u.state.kind === "uploading" || u.state.kind === "queued");
  const down = active.reduce((a, j) => a + j.speed, 0);
  const upSpeed = up.reduce((a, u) => a + u.speed, 0);

  return (
    <Screen>
      <TopBar>
        <h1 data-tauri-drag-region>Transfers</h1>
        <Segmented
          kind="tab"
          aria-label="Transfer direction"
          className="ml-3.5"
          value={tab}
          onChange={setTab}
          options={[
            { value: "downloads", label: `Downloads ${active.length || ""}`.trim() },
            { value: "uploads", label: `Uploads ${upActive.length || ""}`.trim() },
          ]}
        />
        <Spacer />
        <span className="text-[13px] text-muted">
          Down {speed(down)} · Up {speed(upSpeed)}
        </span>
      </TopBar>
      <Body>{tab === "downloads" ? <Downloads query={jobs} /> : <Uploads />}</Body>
    </Screen>
  );
}

const jobGhost = () => (
  <div className="flex flex-col gap-[9px] px-3 py-3.5">
    <div className="flex justify-between">
      <Bar w="40%" />
      <Bar w="20%" />
    </div>
    <Bar w="100%" className="h-[3px]" />
    <Bar w="30%" />
  </div>
);

function Downloads({ query }: { query: ReturnType<typeof useJobs> }) {
  const qc = useQueryClient();
  const list = query.data ?? [];
  const active = list.filter((j) => !isFinished(j));
  const finished = list.filter(isFinished);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = list.find((j) => j.id === selectedId) ?? active.find((j) => rejectedItem(j)) ?? active[0] ?? finished[0] ?? null;
  const clear = useMutation({
    mutationFn: api.jobsClearFinished,
    onSuccess: () => qc.setQueryData<JobView[]>(keys.jobs, (l) => l?.filter((j) => !isFinished(j))),
  });

  if (query.isError) {
    return (
      <div className="grow p-7">
        <InlineError message={errorText(query.error)} onRetry={() => query.refetch()} />
      </div>
    );
  }

  return (
    <>
      <div className="flex min-w-0 grow flex-col overflow-auto px-4 py-5">
        <h2 className="px-3 pb-1.5">Active</h2>
        {query.isPending ? (
          <SkeletonRows row={jobGhost} count={3} />
        ) : active.length === 0 ? (
          <GhostRows row={jobGhost} count={3} label="Nothing downloading. Find a release in Search and download it." />
        ) : (
          <div role="listbox" aria-label="Active downloads">
            {active.map((j) => (
              <ActiveJob key={j.id} job={j} selected={j.id === selected?.id} onSelect={() => setSelectedId(j.id)} />
            ))}
          </div>
        )}

        {finished.length > 0 && (
          <>
            <div className="flex items-center px-3 pt-7 pb-1.5">
              <h2>Finished</h2>
              <div className="grow" />
              <Button size="sm" variant="ghost" onClick={() => clear.mutate()} disabled={clear.isPending}>
                Clear finished
              </Button>
            </div>
            <div role="listbox" aria-label="Finished downloads">
              {finished.map((j) => (
                <FinishedJob key={j.id} job={j} selected={j.id === selected?.id} onSelect={() => setSelectedId(j.id)} />
              ))}
            </div>
          </>
        )}
      </div>
      <Aside label="Transfer details" wide>
        {selected ? (
          <JobDetail key={selected.id} job={selected} onRemoved={() => setSelectedId(null)} />
        ) : (
          <GhostRows className="px-7 py-6" count={6} label="Select a download to see what happened" row={() => <div className="py-2"><Bar w="70%" /></div>} />
        )}
      </Aside>
    </>
  );
}

function selectKeys(onSelect: () => void) {
  return {
    tabIndex: 0,
    onClick: onSelect,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
  };
}

function ActiveJob({ job, selected, onSelect }: { job: JobView; selected: boolean; onSelect: () => void }) {
  const st = jobStatus(job);
  return (
    <div role="option" aria-selected={selected} {...selectKeys(onSelect)} className={cn("flex cursor-pointer flex-col gap-[9px] rounded-ctl px-3 py-3.5 transition-colors duration-150", selected ? "bg-selected" : "hover:bg-raised")}>
      <div className="flex items-baseline gap-3">
        <div className="min-w-0 grow truncate">
          <span className="font-semibold">{job.title}</span>
          {job.artist && <span className="text-muted">{"  "}{job.artist}</span>}
        </div>
        <span className="shrink-0 text-[13px] text-faint">{jobMeta(job)}</span>
      </div>
      <ProgressBar value={progress(job)} tone={st.tone} label={`${job.title} progress`} />
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <StatusDot tone={st.tone} />
        <span className="shrink-0">{st.text}</span>
        <span className="truncate text-faint">{st.sub}</span>
      </div>
    </div>
  );
}

function FinishedJob({ job, selected, onSelect }: { job: JobView; selected: boolean; onSelect: () => void }) {
  const st = jobStatus(job);
  return (
    <div role="option" aria-selected={selected} {...selectKeys(onSelect)} className={cn("flex h-11 cursor-pointer items-center gap-3 rounded-ctl px-3 transition-colors duration-150", selected ? "bg-selected" : "hover:bg-raised")}>
      <StatusDot tone={st.tone} />
      <div className="min-w-0 grow truncate">
        <span className="font-semibold">{job.title}</span>
        {job.artist && <span className="text-muted">{"  "}{job.artist}</span>}
      </div>
      <span className="shrink-0 text-[13px] text-muted">{st.sub ? `${st.text}, ${st.sub}` : st.text}</span>
      {job.status.kind === "done" && (
        <button
          type="button"
          className="link ml-3 shrink-0 text-[13px]"
          onClick={(e) => {
            e.stopPropagation();
            void api.jobReveal(job.id);
          }}
        >
          Show in folder
        </button>
      )}
    </div>
  );
}

const uploadTone = (u: UploadView): { tone: Tone; text: string } => {
  switch (u.state.kind) {
    case "uploading":
      return { tone: "busy", text: speed(u.speed) };
    case "queued":
      return { tone: "idle", text: `Queued, position ${u.state.position}` };
    case "done":
      return { tone: "ok", text: "Sent" };
    case "failed":
      return { tone: "bad", text: u.state.reason };
    case "cancelled":
      return { tone: "idle", text: "Cancelled" };
  }
};

const upGrid = "grid grid-cols-[160px_minmax(0,1fr)_120px_150px_90px] items-center gap-4 px-3";

function Uploads() {
  const qc = useQueryClient();
  const q = useUploads();
  const cancel = useMutation({
    mutationFn: (u: UploadView) => api.uploadCancel(u.username, u.path),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.uploads }),
  });
  const ghost = () => (
    <div className={cn(upGrid, "h-row")}>
      <Bar w="70%" />
      <Bar w="80%" />
      <Bar w="50%" />
      <Bar w="60%" />
      <Bar w="50%" />
    </div>
  );
  return (
    <div className="flex min-w-0 grow flex-col px-4 py-5">
      <p className="m-0 px-3 pb-4 text-muted">
        {q.data ? (
          <>
            <span className="font-semibold text-text">
              {q.data.slotsUsed} of {q.data.slots} slots
            </span>{" "}
            in use, {q.data.waiting} waiting.
          </>
        ) : (
          " "
        )}
      </p>
      <div className={cn(upGrid, "h-8 border-b border-line text-[12px] text-faint")}>
        <span>User</span>
        <span>File</span>
        <span>Size</span>
        <span>Status</span>
        <span />
      </div>
      {cancel.isError && <InlineError message={errorText(cancel.error)} />}
      {q.isPending ? (
        <SkeletonRows row={ghost} />
      ) : q.isError ? (
        <InlineError message={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data.uploads.length ? (
        <GhostRows row={ghost} label="Nobody is downloading from you right now" />
      ) : (
        <div className="min-h-0 overflow-auto">
          {q.data.uploads.map((u) => {
            const st = uploadTone(u);
            return (
              <div key={`${u.username}/${u.path}`} className={cn(upGrid, "h-row border-b border-line-soft")}>
                <span className="truncate font-medium">
                  {u.username}
                  {u.buddy && <span className="pl-2 text-[12px] font-normal text-faint">buddy</span>}
                </span>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="truncate text-[13px] text-muted">{u.path}</span>
                  {u.state.kind === "uploading" && <ProgressBar value={u.size ? u.bytes / u.size : 0} label={`${u.path} progress`} />}
                </div>
                <span className="text-muted">{bytes(u.size)}</span>
                <span className="flex min-w-0 items-center gap-2 text-[13px]">
                  <StatusDot tone={st.tone} />
                  <span className="truncate text-muted">{st.text}</span>
                </span>
                <span className="flex justify-end">
                  {(u.state.kind === "uploading" || u.state.kind === "queued") && (
                    <Button size="sm" variant="ghost" onClick={() => cancel.mutate(u)} aria-label={`Cancel upload of ${u.path} to ${u.username}`}>
                      Cancel
                    </Button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
