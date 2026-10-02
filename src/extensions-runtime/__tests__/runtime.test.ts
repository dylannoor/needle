import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionInfo } from "../../bindings/ExtensionInfo";

const { api, listeners } = vi.hoisted(() => ({
  api: { extensionsList: vi.fn(), extensionSource: vi.fn(), extensionCall: vi.fn() },
  listeners: new Map<string, (payload: unknown) => void>(),
}));

vi.mock("../../lib/ipc", () => ({
  api,
  on: (name: string, cb: (payload: unknown) => void) => {
    listeners.set(name, cb);
    return () => listeners.delete(name);
  },
  errorText: (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong."),
}));

import { handleMessage, loadModule, reload, resetRuntime, resolveSpecifier, start, statusStore } from "../runtime";

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: unknown[] = [];
  terminated = false;
  onmessage: ((m: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string; preventDefault: () => void }) => void) | null = null;
  constructor(
    public url: string,
    public options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }
  postMessage(m: unknown) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
}

const blobs = new Map<string, Blob>();
const revoked: string[] = [];
const blobText = (url: string) => blobs.get(url)!.text();

function ext(id: string, extra: Partial<ExtensionInfo> = {}): ExtensionInfo {
  return {
    manifest: { id, name: id, version: "1.0.0", description: "", author: null, main: "worker.js", panel: null, permissions: [] },
    enabled: true,
    dir: `/ext/${id}`,
    error: null,
    builtin: true,
    ...extra,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.resetAllMocks();
  FakeWorker.instances = [];
  blobs.clear();
  revoked.length = 0;
  let n = 0;
  vi.stubGlobal("Worker", FakeWorker);
  vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
    const url = `blob:${++n}`;
    blobs.set(url, b as Blob);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => void revoked.push(u));
  vi.spyOn(console, "error").mockImplementation(() => {});
  api.extensionSource.mockResolvedValue("needle.on('x', () => {});");
});

afterEach(() => {
  resetRuntime();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("start", () => {
  it("starts a module worker only for enabled extensions without errors", async () => {
    api.extensionsList.mockResolvedValue([
      ext("on"),
      ext("off", { enabled: false }),
      ext("broken", { error: "manifest.json: bad" }),
    ]);
    await start();
    expect(FakeWorker.instances).toHaveLength(1);
    const w = FakeWorker.instances[0];
    expect(w.options).toEqual({ type: "module", name: "on" });
    expect(api.extensionSource).toHaveBeenCalledWith("on", "worker.js");
    expect(statusStore.get()).toEqual({ on: { state: "running" } });
  });

  it("prepends an import of the bootstrap to the main module", async () => {
    api.extensionsList.mockResolvedValue([ext("a")]);
    await start();
    const main = await blobText(FakeWorker.instances[0].url);
    const [first, ...rest] = main.split("\n");
    expect(first).toMatch(/^import "blob:\d+";$/);
    const bootstrapUrl = first.slice(8, -2);
    expect(await blobText(bootstrapUrl)).toContain("globalThis.needle");
    expect(rest.join("\n")).toBe("needle.on('x', () => {});");
  });

  it("rewrites relative imports to blob URLs of the imported files", async () => {
    api.extensionsList.mockResolvedValue([ext("a")]);
    api.extensionSource.mockImplementation(async (_id: string, file: string) =>
      file === "worker.js" ? 'import { build } from "./lib/xml.js";\nbuild();' : "export const build = () => 1;",
    );
    await start();
    expect(api.extensionSource).toHaveBeenCalledWith("a", "lib/xml.js");
    const main = await blobText(FakeWorker.instances[0].url);
    const dep = main.match(/from "(blob:\d+)"/)![1];
    expect(await blobText(dep)).toBe("export const build = () => 1;");
  });

  it("marks an extension as failed when its source cannot load and still starts the rest", async () => {
    api.extensionsList.mockResolvedValue([ext("bad"), ext("good")]);
    api.extensionSource.mockImplementation(async (id: string) => {
      if (id === "bad") throw "extension \"bad\" is disabled";
      return "";
    });
    await start();
    expect(FakeWorker.instances.map((w) => w.options.name)).toEqual(["good"]);
    expect(statusStore.get().bad).toEqual({ state: "error", error: 'extension "bad" is disabled' });
  });

  it("does nothing when listing fails", async () => {
    api.extensionsList.mockRejectedValue("host not ready");
    await start();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("does nothing where Web Workers are unavailable", async () => {
    vi.stubGlobal("Worker", undefined);
    api.extensionsList.mockResolvedValue([ext("a")]);
    await start();
    expect(api.extensionsList).not.toHaveBeenCalled();
  });

  it("records worker errors in the status map", async () => {
    api.extensionsList.mockResolvedValue([ext("a")]);
    await start();
    const preventDefault = vi.fn();
    FakeWorker.instances[0].onerror!({ message: "SyntaxError: nope", preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(statusStore.get().a).toEqual({ state: "error", error: "SyntaxError: nope" });
  });
});

describe("events", () => {
  it("routes ext:event only to the worker it is addressed to", async () => {
    api.extensionsList.mockResolvedValue([ext("a"), ext("b")]);
    await start();
    const [a, b] = FakeWorker.instances;
    const event = { name: "download.verified", payload: { title: "x" } };
    listeners.get("ext:event")!({ id: "b", event });
    listeners.get("ext:event")!({ id: "unknown", event });
    expect(a.posted).toEqual([]);
    expect(b.posted).toEqual([{ type: "event", event }]);
  });
});

describe("reload", () => {
  it("terminates old workers, revokes their blob URLs and starts the current set", async () => {
    api.extensionsList.mockResolvedValue([ext("a")]);
    await start();
    const old = FakeWorker.instances[0];
    api.extensionsList.mockResolvedValue([ext("a", { enabled: false }), ext("b")]);
    await reload();
    expect(old.terminated).toBe(true);
    expect(revoked).toHaveLength(2);
    expect(FakeWorker.instances.map((w) => w.options.name)).toEqual(["a", "b"]);
    expect(statusStore.get()).toEqual({ b: { state: "running" } });
  });
});

describe("handleMessage", () => {
  const worker = () => new FakeWorker("blob:x", {});

  it("forwards a call under the worker's own id and posts the result", async () => {
    const w = worker();
    api.extensionCall.mockResolvedValue("<xml/>");
    await handleMessage("rekordbox", w as unknown as Worker, {
      type: "call",
      rid: 7,
      method: "fs.readText",
      args: { path: "~/Music/a.xml" },
      id: "someone-else",
    });
    expect(api.extensionCall).toHaveBeenCalledWith("rekordbox", "fs.readText", { path: "~/Music/a.xml" });
    expect(w.posted).toEqual([{ type: "result", rid: 7, ok: true, value: "<xml/>" }]);
  });

  it("sends host errors back as failed results", async () => {
    const w = worker();
    api.extensionCall.mockRejectedValue("no permission to write /etc/x");
    await handleMessage("a", w as unknown as Worker, { type: "call", rid: 1, method: "fs.writeText" });
    expect(api.extensionCall).toHaveBeenCalledWith("a", "fs.writeText", null);
    expect(w.posted).toEqual([{ type: "result", rid: 1, ok: false, error: "no permission to write /etc/x" }]);
  });

  it("ignores malformed messages", async () => {
    const w = worker();
    for (const data of [null, "call", 3, { type: "call", method: "x" }, { type: "call", rid: "1", method: "x" }, { type: "call", rid: 1 }, { type: "other" }]) {
      await handleMessage("a", w as unknown as Worker, data);
    }
    expect(api.extensionCall).not.toHaveBeenCalled();
    expect(w.posted).toEqual([]);
  });

  it("records errors reported by the worker", async () => {
    await handleMessage("a", worker() as unknown as Worker, { type: "error", message: "TypeError: boom" });
    expect(statusStore.get().a).toEqual({ state: "error", error: "TypeError: boom" });
  });
});

describe("module loading", () => {
  it("resolves specifiers relative to the importing file", () => {
    expect(resolveSpecifier("worker.js", "./xml.js")).toBe("xml.js");
    expect(resolveSpecifier("lib/a.js", "./b.js")).toBe("lib/b.js");
    expect(resolveSpecifier("lib/deep/a.js", "../b.js")).toBe("lib/b.js");
    expect(resolveSpecifier("lib/a.js", "../b.js")).toBe("b.js");
  });

  it("refuses imports that leave the extension folder", () => {
    expect(() => resolveSpecifier("worker.js", "../other/x.js")).toThrow(/leaves the extension folder/);
    expect(() => resolveSpecifier("lib/a.js", "../../x.js")).toThrow();
  });

  it("rewrites every relative import form and leaves bare and absolute ones", async () => {
    const files: Record<string, string> = {
      "worker.js": [
        'import a from "./a.js";',
        "export * from './a.js';",
        'import "./b.js";',
        'const c = await import("./c.js");',
        'import x from "https://example.com/x.js";',
      ].join("\n"),
      "a.js": "export default 1;",
      "b.js": "",
      "c.js": "",
    };
    api.extensionSource.mockImplementation(async (_id: string, f: string) => files[f]);
    const url = await loadModule("e", "worker.js", (code) => URL.createObjectURL(new Blob([code])));
    const out = await blobText(url);
    expect(out).not.toMatch(/["']\.\//);
    expect(out).toContain('"https://example.com/x.js"');
    expect(api.extensionSource.mock.calls.filter(([, f]) => f === "a.js")).toHaveLength(1);
  });

  it("rejects circular imports", async () => {
    const files: Record<string, string> = { "a.js": 'import "./b.js";', "b.js": 'import "./a.js";' };
    api.extensionSource.mockImplementation(async (_id: string, f: string) => files[f]);
    await expect(loadModule("e", "a.js", () => "blob:x")).rejects.toThrow(/circular import: a.js -> b.js -> a.js/);
  });
});

describe("status store", () => {
  it("notifies subscribers on change", async () => {
    const listener = vi.fn();
    const off = statusStore.subscribe(listener);
    api.extensionsList.mockResolvedValue([ext("a")]);
    await start();
    await flush();
    expect(listener).toHaveBeenCalled();
    off();
  });
});
