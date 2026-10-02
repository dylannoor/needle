import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { JobView } from "../../bindings/JobView";
import { AsideTitle } from "../../components/layout";
import { Spectrum } from "../../components/spectrum";
import { Button } from "../../components/ui/button";
import { InlineError } from "../../components/ui/states";
import { StatusDot } from "../../components/ui/status";
import { timeOfDay } from "../../lib/format";
import { api, errorText } from "../../lib/ipc";
import { isFinished, itemStateText, rejectedItem } from "../../lib/jobs";
import { keys, upsertJob } from "../../lib/queries";

export function JobDetail({ job, onRemoved }: { job: JobView; onRemoved: () => void }) {
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: async (fn: () => Promise<JobView | void>) => fn(),
    onSuccess: (j) => {
      if (j) qc.setQueryData<JobView[]>(keys.jobs, (l) => upsertJob(l, j));
    },
  });
  const remove = useMutation({
    mutationFn: () => api.jobRemove(job.id),
    onSuccess: () => {
      qc.setQueryData<JobView[]>(keys.jobs, (l) => l?.filter((j) => j.id !== job.id));
      onRemoved();
    },
  });

  const rej = rejectedItem(job);
  const keepable = job.items.filter((i) => i.state.kind === "rejected");
  const finished = isFinished(job);
  const kind = job.status.kind;
  const cut = rej?.verdict?.cutoffHz;

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="min-h-0 grow overflow-auto px-7 py-6">
        <AsideTitle>{job.title}</AsideTitle>
        <div className="pt-1 text-muted">{[job.artist, job.formatLabel, job.sourceCount > 1 ? `source ${job.sourceIndex} of ${job.sourceCount}` : job.currentUser].filter(Boolean).join(" · ")}</div>

        {rej?.verdict && (
          <section aria-label="Rejected file">
            <div className="flex items-baseline justify-between gap-3 pt-8 pb-3">
              <span className="min-w-0 truncate font-semibold">Why {rej.name} was {rej.state.kind === "keptAnyway" ? "flagged" : "rejected"}</span>
              {cut ? <span className="shrink-0 text-[13px] text-warn">Cutoff at {Math.round(cut / 1000)} kHz</span> : null}
            </div>
            <Spectrum verdict={rej.verdict} />
            {rej.verdict.reason && <p className="mt-3.5 mb-0 text-[13px] text-muted">{rej.verdict.reason}</p>}
          </section>
        )}

        <section aria-label="Files" className="pt-7">
          <h3 className="m-0 pb-2 text-[13px] font-semibold">Files</h3>
          <ul className="m-0 list-none p-0">
            {job.items.map((it) => {
              const st = itemStateText(it.state);
              return (
                <li key={it.name} className="flex h-[30px] items-center gap-2.5 text-[13px]">
                  <StatusDot tone={st.tone} />
                  <span className="min-w-0 grow truncate">{it.name}</span>
                  <span className="shrink-0 text-faint">{st.text}</span>
                </li>
              );
            })}
          </ul>
        </section>

        {job.log.length > 0 && (
          <section aria-label="What happened" className="flex flex-col gap-2.5 pt-7">
            <h3 className="m-0 text-[13px] font-semibold">What happened</h3>
            {job.log.map((l, i) => (
              <div key={i} className="flex gap-3.5 text-[13px]">
                <span className="w-[38px] shrink-0 text-faint">{timeOfDay(l.atMs)}</span>
                <span className="text-muted">{l.text}</span>
              </div>
            ))}
          </section>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line px-7 py-4">
        {(act.isError || remove.isError) && <InlineError message={errorText(act.error ?? remove.error)} />}
        {keepable.map((it) => (
          <Button key={it.name} className="h-10 justify-center" onClick={() => act.mutate(() => api.jobKeepFile(job.id, it.name))}>
            Keep {it.name} anyway
          </Button>
        ))}
        <div className="flex flex-wrap gap-2">
          {kind === "paused" ? (
            <Button size="sm" onClick={() => act.mutate(() => api.jobResume(job.id))}>
              Resume
            </Button>
          ) : (
            !finished && (
              <Button size="sm" onClick={() => act.mutate(() => api.jobPause(job.id))}>
                Pause
              </Button>
            )
          )}
          {(kind === "failed" || kind === "cancelled") && (
            <Button size="sm" onClick={() => act.mutate(() => api.jobRetry(job.id))}>
              Retry
            </Button>
          )}
          <Button size="sm" onClick={() => act.mutate(() => api.jobReveal(job.id))}>
            Show in folder
          </Button>
          <div className="grow" />
          {finished ? (
            <Button size="sm" variant="ghost" onClick={() => remove.mutate()}>
              Remove from list
            </Button>
          ) : (
            <Button size="sm" variant="danger" onClick={() => act.mutate(() => api.jobCancel(job.id))}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
