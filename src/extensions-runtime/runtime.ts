// Runs one module Web Worker per enabled extension and brokers its host calls.
// The worker never sees Tauri: it posts { type: "call" } messages, the host
// forwards them to `extension_call` under the worker's own id.
import { api, errorText, on } from "../lib/ipc";
import type { ExtensionInfo } from "../bindings/ExtensionInfo";
import type { JsonValue } from "../bindings/serde_json/JsonValue";
import { WORKER_BOOTSTRAP } from "./bootstrap";

export type ExtensionStatus =
  | { state: "running" }
  | { state: "error"; error: string };

interface Running {
  worker: Worker;
  urls: string[];
}

const running = new Map<string, Running>();
let status: Record<string, ExtensionStatus> = {};
const statusListeners = new Set<() => void>();
let unlisten: (() => void) | null = null;
let chain: Promise<void> = Promise.resolve();

function setStatus(id: string, next: ExtensionStatus | null) {
  status = { ...status };
  if (next) status[id] = next;
  else delete status[id];
  statusListeners.forEach((l) => l());
}

function fail(id: string, error: string) {
  console.error(`[extension ${id}] ${error}`);
  setStatus(id, { state: "error", error });
}

export const statusStore = {
  get: () => status,
  subscribe(listener: () => void) {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
  },
};

/** Run tasks one at a time so a reload never overlaps a start. */
function queue(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task, task);
  return chain;
}

export function start(): Promise<void> {
  if (!unlisten) {
    unlisten = on("ext:event", ({ id, event }) => {
      running.get(id)?.worker.postMessage({ type: "event", event });
    });
  }
  return queue(spawnAll);
}

export function reload(): Promise<void> {
  return queue(async () => {
    stopAll();
    await spawnAll();
  });
}

export function stopAll() {
  for (const [id, r] of running) {
    r.worker.terminate();
    r.urls.forEach((u) => URL.revokeObjectURL(u));
    setStatus(id, null);
  }
  running.clear();
}

async function spawnAll() {
  if (typeof Worker === "undefined") return;
  let list: ExtensionInfo[];
  try {
    list = await api.extensionsList();
  } catch (e) {
    console.error("[extensions] could not list extensions", e);
    return;
  }
  for (const ext of list) {
    if (!ext.enabled || ext.error || running.has(ext.manifest.id)) continue;
    try {
      await spawn(ext);
    } catch (e) {
      fail(ext.manifest.id, errorText(e));
    }
  }
}

async function spawn(ext: ExtensionInfo) {
  const id = ext.manifest.id;
  const urls: string[] = [];
  const blobUrl = (code: string) => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    urls.push(url);
    return url;
  };
  try {
    const bootstrap = blobUrl(WORKER_BOOTSTRAP);
    const main = await loadModule(id, ext.manifest.main, blobUrl, `import ${JSON.stringify(bootstrap)};\n`);
    const worker = new Worker(main, { type: "module", name: id });
    worker.onmessage = (m) => void handleMessage(id, worker, m.data);
    worker.onerror = (e) => {
      e.preventDefault();
      fail(id, e.message || "worker failed to start");
    };
    running.set(id, { worker, urls });
    setStatus(id, { state: "running" });
  } catch (e) {
    urls.forEach((u) => URL.revokeObjectURL(u));
    throw e;
  }
}

/** Calls are made under the id the host gave the worker, never one it sends. */
export async function handleMessage(id: string, worker: Worker, data: unknown) {
  if (!data || typeof data !== "object") return;
  const msg = data as { type?: unknown; rid?: unknown; method?: unknown; args?: unknown; message?: unknown };
  if (msg.type === "error") {
    fail(id, String(msg.message));
    return;
  }
  if (msg.type !== "call" || typeof msg.rid !== "number" || typeof msg.method !== "string") return;
  try {
    const value = await api.extensionCall(id, msg.method, (msg.args ?? null) as JsonValue);
    worker.postMessage({ type: "result", rid: msg.rid, ok: true, value });
  } catch (e) {
    worker.postMessage({ type: "result", rid: msg.rid, ok: false, error: errorText(e) });
  }
}

// `import x from "./a.js"`, `export * from "../b.js"`, `import "./c.js"`, `import("./d.js")`.
const RELATIVE_IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.{1,2}\/[^"'\n]+)\2/g;

/** Resolve `spec` against the folder of `from`, inside the extension root. */
export function resolveSpecifier(from: string, spec: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "..") {
      if (!parts.length) throw new Error(`import "${spec}" in ${from} leaves the extension folder`);
      parts.pop();
    } else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** Fetch a module and, depth first, the relative modules it imports, each as
 * a blob URL, since blob modules cannot resolve relative specifiers. */
export async function loadModule(
  id: string,
  file: string,
  blobUrl: (code: string) => string,
  prefix = "",
  seen = new Map<string, Promise<string>>(),
  stack: string[] = [],
): Promise<string> {
  if (stack.includes(file)) throw new Error(`circular import: ${[...stack, file].join(" -> ")}`);
  const cached = seen.get(file);
  if (cached) return cached;
  const promise = (async () => {
    const source = await api.extensionSource(id, file);
    const deps = new Map<string, string>();
    for (const m of source.matchAll(RELATIVE_IMPORT)) {
      const target = resolveSpecifier(file, m[3]);
      if (!deps.has(target)) {
        deps.set(target, await loadModule(id, target, blobUrl, "", seen, [...stack, file]));
      }
    }
    const rewritten = source.replace(RELATIVE_IMPORT, (_all, lead: string, quote: string, spec: string) => {
      return `${lead}${quote}${deps.get(resolveSpecifier(file, spec))}${quote}`;
    });
    return blobUrl(prefix + rewritten);
  })();
  seen.set(file, promise);
  return promise;
}

/** For tests. */
export function resetRuntime() {
  stopAll();
  unlisten?.();
  unlisten = null;
  status = {};
  chain = Promise.resolve();
}
