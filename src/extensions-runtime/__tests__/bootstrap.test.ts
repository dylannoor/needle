import { describe, expect, it, vi } from "vitest";
// Vitest runs with css: false, which blanks CSS imports, so stand in for the tokens.
vi.mock("../../styles/tokens.css?raw", () => ({ default: ":root { --bg: #121314; }" }));

import { PANEL_BRIDGE, WORKER_BOOTSTRAP, panelDocument } from "../bootstrap";

type Listener = (e: { data?: unknown; source?: unknown; reason?: unknown }) => void;

/** Evaluate the worker bootstrap against a fake worker scope. */
function workerScope() {
  const listeners = new Map<string, Listener[]>();
  const posted: Array<Record<string, unknown>> = [];
  const self = {
    postMessage: (m: Record<string, unknown>) => posted.push(m),
    addEventListener: (type: string, l: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), l]),
  };
  const global: Record<string, unknown> = {};
  new Function("self", "globalThis", WORKER_BOOTSTRAP)(self, global);
  const deliver = (data: unknown) => listeners.get("message")!.forEach((l) => l({ data }));
  const needle = global.needle as {
    on: (name: string, h: (payload: unknown, event: unknown) => unknown) => void;
    fs: Record<string, (...a: unknown[]) => Promise<unknown>>;
    storage: Record<string, (...a: unknown[]) => Promise<unknown>>;
    settings: Record<string, (...a: unknown[]) => Promise<unknown>>;
    notify: (title: string, body?: string) => Promise<unknown>;
  };
  return { needle, posted, deliver, listeners };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("worker bootstrap", () => {
  it("turns API calls into call messages with increasing request ids", () => {
    const { needle, posted } = workerScope();
    void needle.fs.writeText("~/Music/a.xml", "<x/>");
    void needle.fs.readText("~/Music/a.xml");
    void needle.fs.exists("~/Music");
    void needle.fs.mkdir("~/Music/Needle");
    void needle.storage.get("lib");
    void needle.storage.set("lib", [1]);
    void needle.storage.set("gone");
    void needle.settings.get();
    void needle.settings.set({ a: 1 });
    void needle.notify("Added 3 tracks");
    expect(posted).toEqual([
      { type: "call", rid: 1, method: "fs.writeText", args: { path: "~/Music/a.xml", text: "<x/>" } },
      { type: "call", rid: 2, method: "fs.readText", args: { path: "~/Music/a.xml" } },
      { type: "call", rid: 3, method: "fs.exists", args: { path: "~/Music" } },
      { type: "call", rid: 4, method: "fs.mkdir", args: { path: "~/Music/Needle" } },
      { type: "call", rid: 5, method: "storage.get", args: { key: "lib" } },
      { type: "call", rid: 6, method: "storage.set", args: { key: "lib", value: [1] } },
      { type: "call", rid: 7, method: "storage.set", args: { key: "gone", value: null } },
      { type: "call", rid: 8, method: "settings.get", args: null },
      { type: "call", rid: 9, method: "storage.set", args: { key: "settings", value: { a: 1 } } },
      { type: "call", rid: 10, method: "notify", args: { title: "Added 3 tracks", body: "" } },
    ]);
  });

  it("resolves and rejects calls by request id", async () => {
    const { needle, deliver } = workerScope();
    const ok = needle.storage.get("a");
    const bad = needle.fs.readText("/etc/passwd");
    deliver({ type: "result", rid: 2, ok: false, error: "no permission to read /etc/passwd" });
    deliver({ type: "result", rid: 1, ok: true, value: 42 });
    deliver({ type: "result", rid: 99, ok: true, value: "stray" });
    await expect(ok).resolves.toBe(42);
    await expect(bad).rejects.toThrow(new Error("no permission to read /etc/passwd"));
  });

  it("delivers events to the handlers for that name only", async () => {
    const { needle, deliver } = workerScope();
    const verified = vi.fn();
    const other = vi.fn();
    needle.on("download.verified", verified);
    needle.on("download.verified", verified);
    needle.on("pm.received", other);
    const event = { name: "download.verified", payload: { title: "Song" } };
    deliver({ type: "event", event });
    expect(verified).toHaveBeenCalledTimes(2);
    expect(verified).toHaveBeenCalledWith({ title: "Song" }, event);
    expect(other).not.toHaveBeenCalled();
  });

  it("reports handler errors, sync and async, without stopping other handlers", async () => {
    const { needle, deliver, posted } = workerScope();
    const after = vi.fn();
    needle.on("e", () => {
      throw new Error("sync boom");
    });
    needle.on("e", async () => {
      throw new Error("async boom");
    });
    needle.on("e", after);
    deliver({ type: "event", event: { name: "e", payload: null } });
    await tick();
    expect(after).toHaveBeenCalled();
    const errors = posted.filter((m) => m.type === "error").map((m) => String(m.message));
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("sync boom");
    expect(errors[1]).toContain("async boom");
  });

  it("rejects non-function handlers and ignores empty messages", () => {
    const { needle, deliver } = workerScope();
    expect(() => needle.on("e", "nope" as never)).toThrow(TypeError);
    expect(() => deliver(null)).not.toThrow();
  });

  it("freezes the API so extensions cannot swap it out", () => {
    const { needle } = workerScope();
    expect(Object.isFrozen(needle)).toBe(true);
    expect(Object.isFrozen(needle.fs)).toBe(true);
  });
});

describe("panel bridge", () => {
  function panelScope() {
    const listeners: Listener[] = [];
    const sent: unknown[] = [];
    const parent = { postMessage: (m: unknown) => sent.push(m) };
    const win: Record<string, unknown> = {
      addEventListener: (type: string, l: Listener) => type === "message" && listeners.push(l),
    };
    new Function("window", "parent", "addEventListener", "document", "ResizeObserver", PANEL_BRIDGE)(
      win,
      parent,
      () => {},
      {},
      class {},
    );
    const needle = win.needle as { storage: Record<string, (...a: unknown[]) => Promise<unknown>>; settings: Record<string, (...a: unknown[]) => Promise<unknown>> };
    return { needle, sent, parent, deliver: (data: unknown, source: unknown) => listeners.forEach((l) => l({ data, source })) };
  }

  it("exposes storage and settings but no fs or events", () => {
    const { needle } = panelScope();
    expect(Object.keys(needle).sort()).toEqual(["settings", "storage"]);
  });

  it("sends calls to the parent and only accepts results from it", async () => {
    const { needle, sent, parent, deliver } = panelScope();
    const p = needle.settings.get();
    expect(sent).toEqual([{ __needle: "call", rid: 1, method: "settings.get", args: null }]);
    deliver({ __needle: "result", rid: 1, ok: true, value: { spoofed: true } }, {});
    deliver({ __needle: "result", rid: 1, ok: true, value: { path: "~/x" } }, parent);
    await expect(p).resolves.toEqual({ path: "~/x" });
  });

  it("maps settings.set onto the settings storage key and rejects errors", async () => {
    const { needle, sent, parent, deliver } = panelScope();
    const p = needle.settings.set({ a: 1 });
    expect(sent[0]).toEqual({ __needle: "call", rid: 1, method: "storage.set", args: { key: "settings", value: { a: 1 } } });
    deliver({ __needle: "result", rid: 1, ok: false, error: "storage is full" }, parent);
    await expect(p).rejects.toThrow("storage is full");
  });
});

describe("panelDocument", () => {
  it("wraps a fragment in a document with styles and the bridge first", () => {
    const doc = panelDocument("<form id=f></form>");
    expect(doc.startsWith("<!doctype html><html><head><meta charset=\"utf-8\"><style>")).toBe(true);
    expect(doc).toContain("--bg: #121314");
    expect(doc.indexOf("window.needle")).toBeLessThan(doc.indexOf("<form id=f>"));
  });

  it("injects right after an existing <head> so panel scripts see needle", () => {
    const doc = panelDocument('<!doctype html><html><head lang="en"><script src="x"></script></head><body></body></html>');
    expect(doc.indexOf('<head lang="en"><meta charset="utf-8">')).toBeGreaterThan(-1);
    expect(doc.indexOf("window.needle")).toBeLessThan(doc.indexOf('<script src="x">'));
  });
});
