import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { Settings } from "../../bindings/Settings";
import { Screen, TopBar } from "../../components/layout";
import { Button } from "../../components/ui/button";
import { Tag } from "../../components/ui/chip";
import { Field, SectionTitle } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Bar, InlineError, SkeletonRows } from "../../components/ui/states";
import { StatusDot } from "../../components/ui/status";
import { Stepper } from "../../components/ui/stepper";
import { Switch } from "../../components/ui/switch";
import { api, errorText } from "../../lib/ipc";
import { keys, useSaveSettings, useSession, useSettings } from "../../lib/queries";

/** Shared frame: top bar, loading and error handling, a single column of fields. */
function Page({ title, children }: { title: string; children: (s: Settings, save: (p: Partial<Settings>) => void) => ReactNode }) {
  const q = useSettings();
  const save = useSaveSettings();
  return (
    <Screen>
      <TopBar>
        <h1 data-tauri-drag-region>{title}</h1>
      </TopBar>
      <div className="min-h-0 grow overflow-auto px-11 py-8">
        <div className="flex max-w-[620px] flex-col">
          {save.isError && (
            <div className="pb-4">
              <InlineError message={errorText(save.error)} />
            </div>
          )}
          {q.isPending ? (
            <SkeletonRows count={5} row={() => <div className="py-5"><Bar w="50%" /></div>} />
          ) : q.isError ? (
            <InlineError message={errorText(q.error)} onRetry={() => q.refetch()} />
          ) : (
            children(q.data, (p) => save.mutate(p))
          )}
        </div>
      </div>
    </Screen>
  );
}

function FolderField({ label, hint, value, onChange, last }: { label: string; hint: string; value: string; onChange: (v: string) => void; last?: boolean }) {
  const pick = useMutation({ mutationFn: api.pickFolder, onSuccess: (p) => p && onChange(p) });
  return (
    <Field label={label} hint={hint} last={last}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="max-w-[260px] truncate text-[13px] text-muted" title={value} data-selectable>
          {value}
        </span>
        <Button size="sm" onClick={() => pick.mutate()} aria-label={`Change ${label.toLowerCase()}`}>
          Change
        </Button>
      </div>
    </Field>
  );
}

/** Editable list of short strings shown as tags. */
function TagList({ items, onChange, placeholder, label }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; label: string }) {
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex min-h-7 flex-wrap gap-1.5">
        {items.length ? items.map((i) => <Tag key={i} onRemove={() => onChange(items.filter((x) => x !== i))} removeLabel={`Remove ${i}`}>{i}</Tag>) : <span className="text-[13px] text-faint">None yet</span>}
      </div>
      <form
        className="flex max-w-[420px] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (t && !items.includes(t)) onChange([...items, t]);
          setText("");
        }}
      >
        <Input aria-label={label} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" disabled={!text.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}

export function DownloadsPage() {
  return (
    <Page title="Downloads">
      {(s, save) => (
        <>
          <SectionTitle>Folders</SectionTitle>
          <FolderField label="Download folder" hint="Finished releases go here, in the uploader's folder name" value={s.downloadDir} onChange={(downloadDir) => save({ downloadDir })} />
          <FolderField label="Incomplete files" hint="Where files wait while they download" value={s.incompleteDir} onChange={(incompleteDir) => save({ incompleteDir })} />
          <FolderField label="Rejected files" hint="Used when a profile moves failed files aside" value={s.rejectedDir} onChange={(rejectedDir) => save({ rejectedDir })} last />

          <SectionTitle className="pt-10">Speed</SectionTitle>
          <Field label="Download speed limit" htmlFor="dl-limit" hint="0 means no limit" last>
            <Stepper id="dl-limit" unit="MB/s" incLabel="Raise download limit" decLabel="Lower download limit" value={Math.round(s.downloadLimitKbps / 1000)} min={0} max={1000} onChange={(v) => save({ downloadLimitKbps: v * 1000 })} />
          </Field>

          <SectionTitle className="pt-10" hint="Results containing these words are left out of every search.">
            Search exclusions
          </SectionTitle>
          <TagList label="Add an exclusion" placeholder="live, karaoke, remix" items={s.searchExclusions} onChange={(searchExclusions) => save({ searchExclusions })} />
        </>
      )}
    </Page>
  );
}

export function NetworkPage() {
  const session = useSession().data;
  return (
    <Page title="Network">
      {(s, save) => {
        const open = session?.portOpen;
        const port = session?.listenPort ?? s.listenPort;
        return (
          <>
            <div className="flex items-start gap-2.5 pb-6 text-[13px]">
              <StatusDot tone={open === true ? "ok" : open === false ? "warn" : "idle"} className="mt-1.5" />
              <span className="text-muted">
                {open === true
                  ? `Other users can reach you directly on port ${port}.`
                  : open === false
                    ? `Port ${port} can't be reached from outside. Downloads still work, but some users can't connect to you. Turn on port mapping or forward the port in your router.`
                    : "Needle hasn't checked your port yet."}
              </span>
            </div>
            <Field label="Listening port" htmlFor="port" hint="Applies the next time you log in">
              <Stepper id="port" incLabel="Next port" decLabel="Previous port" value={s.listenPort} min={1024} max={65535} onChange={(listenPort) => save({ listenPort })} className="[&_input]:w-16" />
            </Field>
            <Field label="Open the port on my router automatically" labelId="upnp" hint="Uses UPnP or NAT-PMP" last>
              <Switch aria-labelledby="upnp" checked={s.portMapping} onCheckedChange={(portMapping) => save({ portMapping })} />
            </Field>
          </>
        );
      }}
    </Page>
  );
}

export function ChatPage() {
  return (
    <Page title="Chat">
      {(s, save) => (
        <>
          <SectionTitle hint="Needle joins these when you log in.">Rooms to join</SectionTitle>
          <TagList label="Add a room" placeholder="Room name" items={s.autoJoinRooms} onChange={(autoJoinRooms) => save({ autoJoinRooms })} />
          <SectionTitle className="pt-10">Notifications</SectionTitle>
          <Field label="Private messages" labelId="n-pm">
            <Switch aria-labelledby="n-pm" checked={s.notifyPrivateMessages} onCheckedChange={(notifyPrivateMessages) => save({ notifyPrivateMessages })} />
          </Field>
          <Field label="Wishlist finds something" labelId="n-wish" last>
            <Switch aria-labelledby="n-wish" checked={s.notifyWishlistHits} onCheckedChange={(notifyWishlistHits) => save({ notifyWishlistHits })} />
          </Field>
        </>
      )}
    </Page>
  );
}

export function AccountPage() {
  const qc = useQueryClient();
  const session = useSession().data;
  const away = useMutation({ mutationFn: api.setAway, onSuccess: (s) => qc.setQueryData(keys.session, s) });
  const logout = useMutation({ mutationFn: api.logout, onSuccess: (s) => qc.setQueryData(keys.session, s) });
  return (
    <Page title="Account">
      {() => (
        <>
          {(away.isError || logout.isError) && (
            <div className="pb-4">
              <InlineError message={errorText(away.error ?? logout.error)} />
            </div>
          )}
          <Field label="Username" hint={session?.remembered ? "Needle logs you in automatically on this computer" : undefined}>
            <span className="font-medium" data-selectable>
              {session?.username}
            </span>
          </Field>
          <Field label="Away" labelId="away" hint="Others see you as away">
            <Switch aria-labelledby="away" checked={session?.away ?? false} onCheckedChange={(a) => away.mutate(a)} />
          </Field>
          <Field label="Log out" hint="Disconnects from Soulseek on this computer" last>
            <Button variant="danger" onClick={() => logout.mutate()} disabled={logout.isPending}>
              Log out
            </Button>
          </Field>
        </>
      )}
    </Page>
  );
}
