import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ExtensionInfo } from "../../bindings/ExtensionInfo";
import { ExtensionPanel, reloadExtensions } from "../../extensions-runtime";
import { Aside, AsideTitle, Body, Screen, Spacer, TopBar } from "../../components/layout";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Bar, GhostRows, InlineError, SkeletonRows } from "../../components/ui/states";
import { Switch } from "../../components/ui/switch";
import { cn } from "../../lib/cn";
import { api, errorText } from "../../lib/ipc";
import { describePermissions } from "../../lib/permissions";
import { keys, useExtensions } from "../../lib/queries";

export function ExtensionsScreen() {
  const qc = useQueryClient();
  const q = useExtensions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ExtensionInfo | null>(null);
  const [uninstall, setUninstall] = useState<ExtensionInfo | null>(null);
  const list = q.data ?? [];
  const selected = list.find((e) => e.manifest.id === selectedId) ?? list[0] ?? null;

  const apply = async (l: ExtensionInfo[]) => {
    qc.setQueryData(keys.extensions, l);
    await reloadExtensions();
  };
  const toggle = useMutation({ mutationFn: ({ id, on }: { id: string; on: boolean }) => api.extensionSetEnabled(id, on), onSuccess: apply });
  const install = useMutation({
    mutationFn: async () => {
      const dir = await api.pickFolder();
      return dir ? api.extensionInstall(dir) : null;
    },
    onSuccess: async (l) => {
      if (l) await apply(l);
    },
  });
  const remove = useMutation({ mutationFn: api.extensionUninstall, onSuccess: apply });
  const err = toggle.error ?? install.error ?? remove.error;

  const ghost = () => (
    <div className="flex flex-col gap-2 border-b border-line-soft px-3 py-4">
      <Bar w="30%" />
      <Bar w="70%" />
    </div>
  );

  return (
    <Screen>
      <TopBar>
        <h1 data-tauri-drag-region>Extensions</h1>
        <Spacer />
        <Button variant="primary" onClick={() => install.mutate()} disabled={install.isPending}>
          Install from folder
        </Button>
      </TopBar>
      <Body>
        <div className="flex min-w-0 grow flex-col overflow-auto px-4 py-6">
          <p className="m-0 px-3 pb-5 text-muted">Extensions run in their own sandbox and can only do what you allow. They stay off until you turn them on.</p>
          {err && (
            <div className="px-3 pb-4">
              <InlineError message={errorText(err)} />
            </div>
          )}
          {q.isPending ? (
            <SkeletonRows row={ghost} count={3} />
          ) : q.isError ? (
            <InlineError message={errorText(q.error)} onRetry={() => q.refetch()} />
          ) : !list.length ? (
            <GhostRows row={ghost} count={3} label="No extensions installed" />
          ) : (
            <ul className="m-0 list-none p-0" aria-label="Installed extensions">
              {list.map((e) => (
                <li
                  key={e.manifest.id}
                  className={cn("flex cursor-pointer items-start gap-4 rounded-ctl px-3 py-4 transition-colors duration-150", e.manifest.id === selected?.manifest.id ? "bg-selected" : "hover:bg-raised")}
                  onClick={() => setSelectedId(e.manifest.id)}
                >
                  <div className="min-w-0 grow">
                    <div className="flex items-baseline gap-2">
                      <button type="button" className="border-0 bg-transparent p-0 text-left font-semibold text-text" onClick={() => setSelectedId(e.manifest.id)}>
                        {e.manifest.name}
                      </button>
                      <span className="text-[12px] text-faint">
                        {e.manifest.version}
                        {e.builtin ? " · built in" : e.manifest.author ? ` · by ${e.manifest.author}` : ""}
                      </span>
                    </div>
                    <p className="mt-0.5 mb-0 text-[13px] text-muted">{e.manifest.description}</p>
                    {e.error && <p className="mt-1.5 mb-0 text-[13px] text-bad">{e.error}</p>}
                    <ul className="m-0 mt-2 list-none p-0 text-[12px] text-faint">
                      {describePermissions(e.manifest.permissions).map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                  <div onClick={(ev) => ev.stopPropagation()} className="pt-0.5">
                    <Switch
                      aria-label={`${e.enabled ? "Turn off" : "Turn on"} ${e.manifest.name}`}
                      checked={e.enabled}
                      disabled={toggle.isPending}
                      onCheckedChange={(on) => (on ? setConfirm(e) : toggle.mutate({ id: e.manifest.id, on: false }))}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Aside label="Extension details" wide>
          {selected ? (
            <div className="flex min-h-0 grow flex-col px-7 py-6">
              <AsideTitle>{selected.manifest.name}</AsideTitle>
              <div className="pt-1 text-[13px] break-all text-faint" data-selectable>
                {selected.dir}
              </div>
              <div className="min-h-0 grow overflow-auto pt-6">
                {selected.enabled ? (
                  selected.manifest.panel ? (
                    <ExtensionPanel id={selected.manifest.id} />
                  ) : (
                    <p className="m-0 text-[13px] text-muted">This extension has no settings. It works in the background.</p>
                  )
                ) : (
                  <p className="m-0 text-[13px] text-muted">Turn it on to see its settings.</p>
                )}
              </div>
              {!selected.builtin && (
                <Button variant="danger" className="justify-center" onClick={() => setUninstall(selected)}>
                  Uninstall
                </Button>
              )}
            </div>
          ) : (
            <GhostRows className="px-7 py-6" count={5} row={() => <div className="py-2"><Bar w="70%" /></div>} label="Select an extension" />
          )}
        </Aside>
      </Body>

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Turn on ${confirm?.manifest.name ?? ""}?`}
        description="It will be allowed to:"
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (confirm) toggle.mutate({ id: confirm.manifest.id, on: true });
                setConfirm(null);
              }}
            >
              Turn on
            </Button>
          </>
        }
      >
        <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[14px]">
          {confirm && describePermissions(confirm.manifest.permissions).map((p) => <li key={p}>{p}</li>)}
          {confirm && !confirm.manifest.permissions.length && <li>Nothing beyond its own storage</li>}
        </ul>
      </Dialog>

      <Dialog
        open={uninstall !== null}
        onOpenChange={(o) => !o && setUninstall(null)}
        title={`Uninstall ${uninstall?.manifest.name ?? ""}?`}
        description="Needle stops loading it. You can install it again from its folder later."
        footer={
          <>
            <Button onClick={() => setUninstall(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (uninstall) remove.mutate(uninstall.manifest.id);
                setUninstall(null);
                setSelectedId(null);
              }}
            >
              Uninstall
            </Button>
          </>
        }
      />
    </Screen>
  );
}
