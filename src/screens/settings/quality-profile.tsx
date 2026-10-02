import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Codec } from "../../bindings/Codec";
import type { QualityProfile } from "../../bindings/QualityProfile";
import type { Strictness } from "../../bindings/Strictness";
import type { Tier } from "../../bindings/Tier";
import { Screen, Spacer, TopBar } from "../../components/layout";
import { Button } from "../../components/ui/button";
import { Chip } from "../../components/ui/chip";
import { Dialog } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioItems, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Field, SectionTitle } from "../../components/ui/field";
import { ChevronDown, DragHandle } from "../../components/ui/icons";
import { Input, Radio } from "../../components/ui/input";
import { Segmented } from "../../components/ui/segmented";
import { Select } from "../../components/ui/select";
import { Bar, InlineError, SkeletonRows } from "../../components/ui/states";
import { Stepper } from "../../components/ui/stepper";
import { Switch } from "../../components/ui/switch";
import { cn } from "../../lib/cn";
import { audioCodecs, codecName, losslessCodecs, num } from "../../lib/format";
import { api, errorText } from "../../lib/ipc";
import { keys, useProfiles, useSaveSettings, useSettings } from "../../lib/queries";
import { emptyTier, isLosslessTier, moveItem, tierDetail } from "../../lib/tiers";

export const strictnessHints: Record<Strictness, string> = {
  relaxed: "Only rejects files whose header lies about the format.",
  normal: "Rejects lossless files that stop below 19 kHz and MP3 320 files that stop below 16 kHz.",
  strict: "Also rejects files with lossy artifacts above the cutoff. Expect some false alarms on old masters.",
};

const SAVE_DELAY = 400;

export function QualityProfilePage() {
  const profiles = useProfiles();
  const settings = useSettings().data;
  const [editingId, setEditingId] = useState<string | null>(null);
  const list = profiles.data ?? [];
  const current = list.find((p) => p.id === editingId) ?? list.find((p) => p.id === settings?.activeProfileId) ?? list[0];

  if (profiles.isError) {
    return (
      <Screen>
        <TopBar>
          <h1>Quality profile</h1>
        </TopBar>
        <div className="p-11">
          <InlineError message={errorText(profiles.error)} onRetry={() => profiles.refetch()} />
        </div>
      </Screen>
    );
  }
  if (!current || !settings) {
    return (
      <Screen>
        <TopBar>
          <h1>Quality profile</h1>
        </TopBar>
        <SkeletonRows className="px-11 py-8" count={6} row={() => <div className="py-4"><Bar w="45%" /></div>} />
      </Screen>
    );
  }
  return <ProfileEditor key={current.id} initial={current} profiles={list} activeId={settings.activeProfileId} onPick={setEditingId} />;
}

function ProfileEditor({ initial, profiles, activeId, onPick }: { initial: QualityProfile; profiles: QualityProfile[]; activeId: string; onPick: (id: string) => void }) {
  const qc = useQueryClient();
  const saveSettings = useSaveSettings();
  const [draft, setDraft] = useState(initial);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [tierDialog, setTierDialog] = useState<{ index: number | null; tier: Tier } | null>(null);
  const [nameDialog, setNameDialog] = useState<"new" | "rename" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<QualityProfile | null>(null);

  const save = useMutation({
    mutationFn: api.profileSave,
    onSuccess: (l) => {
      qc.setQueryData(keys.profiles, l);
      setSavedAt(Date.now());
    },
  });
  const del = useMutation({
    mutationFn: () => api.profileDelete(draft.id),
    onSuccess: (l) => {
      qc.setQueryData(keys.profiles, l);
      onPick(activeId === draft.id ? l[0].id : activeId);
    },
  });
  const preview = useQuery({ queryKey: [...keys.preview, draft], queryFn: () => api.profilePreview(draft), placeholderData: (p) => p, staleTime: 0 });

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) save.mutate(pending.current);
    pending.current = null;
  };
  // Save what's pending when leaving the page or switching profile.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => () => flushRef.current(), []);

  // "Saved" fades out after a moment.
  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(null), 2000);
    return () => clearTimeout(t);
  }, [savedAt]);

  const update = (patch: Partial<QualityProfile>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  };

  const [shown, total] = preview.data ?? [null, null];

  return (
    <Screen>
      <TopBar>
        <h1 data-tauri-drag-region>Quality profile</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="ml-2.5" aria-label={`Profile: ${draft.name}`}>
              {draft.name}
              <ChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioItems
              value={draft.id}
              onValueChange={(id) => {
                flush();
                onPick(id);
              }}
              options={profiles.map((p) => ({ value: p.id, label: p.id === activeId ? `${p.name} (used for searches)` : p.name }))}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setNameDialog("new")}>New profile</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setNameDialog("rename")}>Rename</DropdownMenuItem>
            <DropdownMenuItem danger disabled={profiles.length < 2} onSelect={() => del.mutate()}>
              Delete profile
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {draft.id !== activeId && (
          <Button variant="ghost" size="sm" onClick={() => saveSettings.mutate({ activeProfileId: draft.id })}>
            Use for searches
          </Button>
        )}
        <span role="status" className={cn("text-[13px] text-ok transition-opacity duration-200", savedAt ? "opacity-100" : "opacity-0")}>
          Saved
        </span>
        <Spacer />
        <span className="text-[13px] text-faint">{shown !== null && total !== null ? `Your last search would show ${num(shown)} of ${num(total)} results` : "Search once to preview this profile"}</span>
      </TopBar>

      {(save.isError || del.isError) && (
        <div className="px-11 pt-4">
          <InlineError message={errorText(save.error ?? del.error)} onRetry={save.isError ? () => save.mutate(draft) : undefined} />
        </div>
      )}

      <div className="grid min-h-0 grow grid-cols-2 gap-16 overflow-auto px-11 py-8">
        <div className="flex flex-col">
          <SectionTitle className="pb-4" hint="Needle takes the highest tier it can find. Drag to reorder.">What counts as good enough</SectionTitle>
          <TierList
            tiers={draft.tiers}
            onReorder={(tiers) => update({ tiers })}
            onEdit={(index) => setTierDialog({ index, tier: draft.tiers[index] })}
          />
          <button type="button" className="link self-start pt-3 pl-3 text-[13px]" onClick={() => setTierDialog({ index: null, tier: emptyTier() })}>
            Add a tier
          </button>

          <h2 className="pt-12 pb-1 text-[15px]">Which source to pick</h2>
          <Field label="Skip users whose queue is longer than" htmlFor="mq">
            <Stepper id="mq" unit="people" incLabel="Raise queue limit" decLabel="Lower queue limit" value={draft.maxQueue} min={0} max={999} onChange={(maxQueue) => update({ maxQueue })} />
          </Field>
          <Field label="Prefer complete releases" labelId="pc" last>
            <Switch aria-labelledby="pc" checked={draft.preferComplete} onCheckedChange={(preferComplete) => update({ preferComplete })} />
          </Field>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center justify-between">
            <h2 id="sc" className="text-[15px]">
              Check every file after download
            </h2>
            <Switch aria-labelledby="sc" checked={draft.verify.enabled} onCheckedChange={(enabled) => update({ verify: { ...draft.verify, enabled } })} />
          </div>
          <p className="mt-1 mb-4 text-[13px] text-faint">Catches MP3s renamed to FLAC and upsampled lossy files by looking at the spectrum.</p>
          <div className={cn("flex flex-col transition-opacity duration-150", !draft.verify.enabled && "pointer-events-none opacity-45")} aria-disabled={!draft.verify.enabled}>
            <Segmented
              fill
              aria-label="Strictness"
              value={draft.verify.strictness}
              onChange={(strictness) => update({ verify: { ...draft.verify, strictness } })}
              options={[
                { value: "relaxed", label: "Relaxed" },
                { value: "normal", label: "Normal" },
                { value: "strict", label: "Strict" },
              ]}
            />
            <p className="mt-2.5 mb-0 text-[13px] text-muted">{strictnessHints[draft.verify.strictness]}</p>

            <div role="radiogroup" aria-labelledby="ff" className="flex flex-col pt-8">
              <div id="ff" className="pb-1.5 font-medium">
                When a file fails
              </div>
              <Radio name="fail" label="Delete it and get it from the next source" checked={draft.verify.onFail === "delete"} onChange={() => update({ verify: { ...draft.verify, onFail: "delete" } })} />
              <Radio name="fail" label="Move it to a Rejected folder, then try the next source" checked={draft.verify.onFail === "moveToRejected"} onChange={() => update({ verify: { ...draft.verify, onFail: "moveToRejected" } })} />
            </div>
          </div>

          <h2 className="pt-10 pb-1 text-[15px]">When a download gets stuck</h2>
          <Field label="Switch source after no data for" htmlFor="nd">
            <Stepper id="nd" unit="min" incLabel="Wait longer for data" decLabel="Wait less for data" value={Math.round(draft.stuck.noDataSecs / 60)} min={1} max={60} onChange={(m) => update({ stuck: { ...draft.stuck, noDataSecs: m * 60 } })} />
          </Field>
          <Field label="Switch source after waiting in a queue for" htmlFor="qw">
            <Stepper id="qw" unit="min" incLabel="Wait longer in queues" decLabel="Wait less in queues" value={Math.round(draft.stuck.queueWaitSecs / 60)} min={1} max={240} onChange={(m) => update({ stuck: { ...draft.stuck, queueWaitSecs: m * 60 } })} />
          </Field>
          <Field label="Sources to try before searching again" htmlFor="ms">
            <Stepper id="ms" incLabel="More sources" decLabel="Fewer sources" value={draft.stuck.maxSources} min={1} max={20} onChange={(maxSources) => update({ stuck: { ...draft.stuck, maxSources } })} />
          </Field>
          <Field label="Nothing left to try? Add it to the wishlist" labelId="wl" last>
            <Switch aria-labelledby="wl" checked={draft.stuck.wishlistWhenExhausted} onCheckedChange={(wishlistWhenExhausted) => update({ stuck: { ...draft.stuck, wishlistWhenExhausted } })} />
          </Field>
        </div>
      </div>

      {tierDialog && (
        <TierDialog
          initial={tierDialog.tier}
          isNew={tierDialog.index === null}
          canRemove={draft.tiers.length > 1}
          onClose={() => setTierDialog(null)}
          onSave={(t) => {
            const tiers = tierDialog.index === null ? [...draft.tiers, t] : draft.tiers.map((x, i) => (i === tierDialog.index ? t : x));
            update({ tiers });
            setTierDialog(null);
          }}
          onRemove={() => {
            update({ tiers: draft.tiers.filter((_, i) => i !== tierDialog.index) });
            setTierDialog(null);
          }}
        />
      )}
      {nameDialog && (
        <NameDialog
          title={nameDialog === "new" ? "New profile" : "Rename profile"}
          initial={nameDialog === "new" ? "" : draft.name}
          onClose={() => setNameDialog(null)}
          onSave={(name) => {
            if (nameDialog === "rename") update({ name });
            else {
              flush();
              const p: QualityProfile = { ...draft, id: `p-${Date.now().toString(36)}`, name };
              save.mutate(p, { onSuccess: () => onPick(p.id) });
            }
            setNameDialog(null);
          }}
        />
      )}
    </Screen>
  );
}

function TierList({ tiers, onReorder, onEdit }: { tiers: Tier[]; onReorder: (t: Tier[]) => void; onEdit: (i: number) => void }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <ol className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Tiers, best first" aria-describedby="tier-hint">
      <span id="tier-hint" className="sr-only">
        Press Alt with the up or down arrow to move a tier.
      </span>
      {tiers.map((t, i) => (
        <li key={`${t.label}-${i}`}>
          <button
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            draggable
            onDragStart={(e) => {
              setDragging(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(i);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null) onReorder(moveItem(tiers, dragging, i));
              setDragging(null);
              setOver(null);
            }}
            onKeyDown={(e) => {
              if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
              e.preventDefault();
              const to = i + (e.key === "ArrowUp" ? -1 : 1);
              if (to < 0 || to >= tiers.length) return;
              onReorder(moveItem(tiers, i, to));
              requestAnimationFrame(() => refs.current[to]?.focus());
            }}
            onClick={() => onEdit(i)}
            aria-label={`Tier ${i + 1}: ${t.label}, ${tierDetail(t)}. Edit`}
            className={cn(
              "flex h-12 w-full cursor-grab items-center gap-3.5 rounded-ctl border border-transparent bg-raised px-3 text-left text-text transition-colors duration-150 hover:bg-raised-hi active:cursor-grabbing",
              dragging === i && "opacity-50",
              over === i && dragging !== null && dragging !== i && "border-focus",
            )}
          >
            <DragHandle />
            <span className="w-3 text-faint">{i + 1}</span>
            <span className="grow font-medium">{t.label}</span>
            <span className="text-[13px] text-muted">{tierDetail(t)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

const sampleRates = [
  { value: "any", label: "Any" },
  { value: "44100", label: "44.1 kHz" },
  { value: "48000", label: "48 kHz" },
  { value: "88200", label: "88.2 kHz" },
  { value: "96000", label: "96 kHz" },
  { value: "192000", label: "192 kHz" },
];

function TierDialog({ initial, isNew, canRemove, onClose, onSave, onRemove }: { initial: Tier; isNew: boolean; canRemove: boolean; onClose: () => void; onSave: (t: Tier) => void; onRemove: () => void }) {
  const [t, setT] = useState(initial);
  const lossless = isLosslessTier(t);
  const anyLossy = t.codecs.some((c) => !losslessCodecs.includes(c));
  const valid = t.label.trim() && t.codecs.length;
  const toggleCodec = (c: Codec, on: boolean) => setT({ ...t, codecs: on ? [...t.codecs, c] : t.codecs.filter((x) => x !== c) });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? "Add a tier" : "Edit tier"}
      description="Files must match every rule in the tier to count."
      width={480}
      footer={
        <>
          {!isNew && canRemove && (
            <Button variant="danger" className="mr-auto" onClick={onRemove}>
              Remove tier
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={() => onSave({ ...t, label: t.label.trim() })}>
            {isNew ? "Add tier" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tier-label" className="text-[13px] text-muted">
            Name
          </label>
          <Input id="tier-label" autoFocus placeholder="FLAC 16-bit" value={t.label} onChange={(e) => setT({ ...t, label: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span id="tier-formats" className="text-[13px] text-muted">
            Formats
          </span>
          <div role="group" aria-labelledby="tier-formats" className="flex flex-wrap gap-1.5">
            {audioCodecs.map((c) => (
              <Chip key={c} pressed={t.codecs.includes(c)} onPressedChange={(on) => toggleCodec(c, on)}>
                {codecName[c]}
              </Chip>
            ))}
          </div>
        </div>
        {lossless && (
          <>
            <Field label="Minimum bit depth">
              <Segmented
                aria-label="Minimum bit depth"
                value={String(t.minBitDepth ?? "any")}
                onChange={(v) => setT({ ...t, minBitDepth: v === "any" ? null : Number(v) })}
                options={[
                  { value: "any", label: "Any" },
                  { value: "16", label: "16-bit" },
                  { value: "24", label: "24-bit" },
                ]}
              />
            </Field>
            <Field label="Minimum sample rate" last>
              <Select size="sm" aria-label="Minimum sample rate" value={t.minSampleRate ? String(t.minSampleRate) : "any"} onValueChange={(v) => setT({ ...t, minSampleRate: v === "any" ? null : Number(v) })} options={sampleRates} />
            </Field>
          </>
        )}
        {anyLossy && (
          <>
            <Field label="Minimum bitrate" htmlFor="tier-br" hint="0 accepts any bitrate">
              <Stepper id="tier-br" unit="kbps" incLabel="Raise minimum bitrate" decLabel="Lower minimum bitrate" value={t.minBitrateKbps ?? 0} min={0} max={1411} step={32} onChange={(v) => setT({ ...t, minBitrateKbps: v || null })} />
            </Field>
            <Field label="Accept VBR files that average this" labelId="tier-vbr" last>
              <Switch aria-labelledby="tier-vbr" checked={t.allowVbr} onCheckedChange={(allowVbr) => setT({ ...t, allowVbr })} />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

function NameDialog({ title, initial, onClose, onSave }: { title: string; initial: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), name.trim() && onSave(name.trim()))}>
        <Input autoFocus aria-label="Profile name" value={name} onChange={(e) => setName(e.target.value)} />
      </form>
    </Dialog>
  );
}
