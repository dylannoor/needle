// Extension runtime: runs each enabled extension's worker, routes `ext:event`
// to it, and brokers its host calls through `extension_call`. Owned by the
// extensions work; the app uses the exports below.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "../lib/ipc";
import type { JsonValue } from "../bindings/serde_json/JsonValue";
import { panelDocument } from "./bootstrap";
import { reload, start, statusStore, type ExtensionStatus } from "./runtime";

export type { ExtensionStatus };

/** Start workers for all enabled extensions. Safe to call once at startup. */
export async function startExtensionRuntime(): Promise<void> {
  await start();
}

/** Restart workers after extensions were enabled, disabled or installed. */
export async function reloadExtensions(): Promise<void> {
  await reload();
}

/** Running/error state per extension id; ids without a worker are absent. */
export function useExtensionStatus(): Record<string, ExtensionStatus> {
  return useSyncExternalStore(statusStore.subscribe, statusStore.get);
}

const PANEL_METHODS = new Set(["storage.get", "storage.set", "settings.get"]);
const MAX_PANEL_HEIGHT = 2000;

/** The extension's own panel (sandboxed iframe), or nothing if it has none. */
export function ExtensionPanel({ id }: { id: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);
  const panel = useQuery({
    queryKey: ["extension-panel", id],
    queryFn: async () => {
      const ext = (await api.extensionsList()).find((e) => e.manifest.id === id);
      if (!ext?.manifest.panel) return null;
      return panelDocument(await api.extensionSource(id, ext.manifest.panel));
    },
  });

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (!target || e.source !== target) return;
      const d = e.data as { __needle?: unknown; rid?: unknown; method?: unknown; args?: unknown; height?: unknown };
      if (d?.__needle === "size" && typeof d.height === "number") {
        setHeight(Math.min(Math.max(Math.ceil(d.height), 40), MAX_PANEL_HEIGHT));
        return;
      }
      if (d?.__needle !== "call" || typeof d.rid !== "number" || typeof d.method !== "string") return;
      const reply = (r: { ok: true; value: JsonValue } | { ok: false; error: string }) =>
        target.postMessage({ __needle: "result", rid: d.rid, ...r }, "*");
      if (!PANEL_METHODS.has(d.method)) {
        reply({ ok: false, error: `"${d.method}" is not available in panels` });
        return;
      }
      try {
        reply({ ok: true, value: await api.extensionCall(id, d.method, (d.args ?? null) as JsonValue) });
      } catch (err) {
        reply({ ok: false, error: errorText(err) });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id]);

  if (panel.error) return <p className="text-sm text-bad">{errorText(panel.error)}</p>;
  if (!panel.data) return null;
  return (
    <iframe
      ref={frame}
      title={`${id} panel`}
      sandbox="allow-scripts"
      srcDoc={panel.data}
      height={height}
      className="block w-full rounded-ctl border border-line bg-bg"
    />
  );
}
