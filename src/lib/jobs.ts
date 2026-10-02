import type { ItemState } from "../bindings/ItemState";
import type { ItemView } from "../bindings/ItemView";
import type { JobView } from "../bindings/JobView";
import type { Tone } from "../components/ui/status";
import { clock, eta, speed } from "./format";

export const isFinished = (j: JobView) => ["done", "failed", "cancelled"].includes(j.status.kind);

const doneItems = (j: JobView) => j.items.filter((i) => i.state.kind === "verified" || i.state.kind === "keptAnyway").length;

const recentWarn = (j: JobView, now: number) => {
  const last = j.log.at(-1);
  return Boolean(last && last.tone === "warn" && now - last.atMs < 5 * 60_000);
};

/** Dot color, headline and the faint line after it, in plain language. */
export function jobStatus(j: JobView, now = Date.now()): { tone: Tone; text: string; sub: string } {
  const s = j.status;
  switch (s.kind) {
    case "downloading":
      if (j.sourceIndex > 1 && recentWarn(j, now)) return { tone: "warn", text: "Switched source", sub: j.detail };
      return { tone: "busy", text: `Downloading ${Math.min(doneItems(j) + 1, j.items.length)} of ${j.items.length}`, sub: j.detail };
    case "recovering":
      return { tone: "warn", text: s.reason, sub: j.detail };
    case "queued":
      return { tone: "idle", text: s.position !== null ? `Position ${s.position} in queue` : "Waiting in queue", sub: j.detail };
    case "waiting":
      return { tone: "idle", text: "Waiting for a reply", sub: j.detail };
    case "verifying":
      return { tone: "busy", text: "Checking files", sub: j.detail };
    case "paused":
      return { tone: "idle", text: "Paused", sub: j.detail };
    case "done":
      return { tone: "ok", text: j.detail || "Finished", sub: "" };
    case "failed":
      return { tone: "bad", text: "Failed", sub: s.reason };
    case "cancelled":
      return { tone: "idle", text: "Cancelled", sub: j.detail };
  }
}

export const progress = (j: JobView) => (j.total ? j.bytes / j.total : 0);

/** Right-aligned meta: "62% · 1.9 MB/s · 2 min left" or "next source in 7:40". */
export function jobMeta(j: JobView): string {
  const pct = `${Math.round(progress(j) * 100)}%`;
  if (j.status.kind === "queued" || j.status.kind === "waiting") return j.switchInSecs !== null ? `next source in ${clock(j.switchInSecs)}` : pct;
  if (j.status.kind === "recovering") return `${pct} · source ${j.sourceIndex} of ${j.sourceCount}`;
  if (j.status.kind === "paused") return `${pct} · paused`;
  if (j.speed > 0) {
    const parts = [pct, speed(j.speed)];
    if (j.total > j.bytes) parts.push(eta((j.total - j.bytes) / j.speed));
    return parts.join(" · ");
  }
  return pct;
}

export const itemStateText = (s: ItemState): { tone: Tone; text: string } => {
  switch (s.kind) {
    case "pending":
      return { tone: "idle", text: "Waiting" };
    case "queued":
      return { tone: "idle", text: s.position !== null ? `Queued, position ${s.position}` : "Queued" };
    case "downloading":
      return { tone: "busy", text: "Downloading" };
    case "verifying":
      return { tone: "busy", text: "Checking" };
    case "verified":
      return { tone: "ok", text: "Passed the check" };
    case "rejected":
      return { tone: "warn", text: "Failed the check" };
    case "keptAnyway":
      return { tone: "warn", text: "Kept anyway" };
    case "failed":
      return { tone: "bad", text: s.reason };
  }
};

/** The file whose spectrum the detail shows: the last one that failed verification. */
export const rejectedItem = (j: JobView): ItemView | undefined =>
  j.items.filter((i) => i.verdict && !i.verdict.ok && (i.state.kind === "rejected" || i.state.kind === "keptAnyway")).at(-1);
