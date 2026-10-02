// Code that runs inside extension sandboxes, kept as plain JS strings because
// it is injected into a Web Worker or a srcdoc iframe, not bundled.
import tokens from "../styles/tokens.css?raw";

/** Defines the global `needle` API inside an extension worker. */
export const WORKER_BOOTSTRAP = `
const pending = new Map();
const handlers = new Map();
let seq = 0;
const report = (e) => self.postMessage({ type: "error", message: String((e && e.stack) || e) });
const call = (method, args) =>
  new Promise((resolve, reject) => {
    const rid = ++seq;
    pending.set(rid, { resolve, reject });
    self.postMessage({ type: "call", rid, method, args: args === undefined ? null : args });
  });
self.addEventListener("message", (m) => {
  const d = m.data;
  if (!d) return;
  if (d.type === "result") {
    const p = pending.get(d.rid);
    if (!p) return;
    pending.delete(d.rid);
    if (d.ok) p.resolve(d.value);
    else p.reject(new Error(d.error));
  } else if (d.type === "event") {
    for (const h of handlers.get(d.event.name) || []) {
      try {
        Promise.resolve(h(d.event.payload, d.event)).catch(report);
      } catch (e) {
        report(e);
      }
    }
  }
});
self.addEventListener("unhandledrejection", (e) => report(e.reason));
globalThis.needle = Object.freeze({
  on(name, handler) {
    if (typeof handler !== "function") throw new TypeError("needle.on needs a function");
    const list = handlers.get(name) || [];
    list.push(handler);
    handlers.set(name, list);
  },
  fs: Object.freeze({
    readText: (path) => call("fs.readText", { path }),
    writeText: (path, text) => call("fs.writeText", { path, text }),
    exists: (path) => call("fs.exists", { path }),
    mkdir: (path) => call("fs.mkdir", { path }),
  }),
  storage: Object.freeze({
    get: (key) => call("storage.get", { key }),
    set: (key, value) => call("storage.set", { key, value: value === undefined ? null : value }),
  }),
  settings: Object.freeze({
    get: () => call("settings.get"),
    set: (value) => call("storage.set", { key: "settings", value }),
  }),
  notify: (title, body) => call("notify", { title, body: body || "" }),
});
`;

/** Defines `needle.storage` and `needle.settings` inside a panel iframe and
 * reports the document height so the frame can fit its content. */
export const PANEL_BRIDGE = `
(() => {
  const pending = new Map();
  let seq = 0;
  const call = (method, args) =>
    new Promise((resolve, reject) => {
      const rid = ++seq;
      pending.set(rid, { resolve, reject });
      parent.postMessage({ __needle: "call", rid, method, args: args === undefined ? null : args }, "*");
    });
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (e.source !== parent || !d || d.__needle !== "result") return;
    const p = pending.get(d.rid);
    if (!p) return;
    pending.delete(d.rid);
    if (d.ok) p.resolve(d.value);
    else p.reject(new Error(d.error));
  });
  window.needle = Object.freeze({
    storage: Object.freeze({
      get: (key) => call("storage.get", { key }),
      set: (key, value) => call("storage.set", { key, value: value === undefined ? null : value }),
    }),
    settings: Object.freeze({
      get: () => call("settings.get"),
      set: (value) => call("storage.set", { key: "settings", value }),
    }),
  });
  const size = () => parent.postMessage({ __needle: "size", height: document.documentElement.scrollHeight }, "*");
  addEventListener("load", () => {
    size();
    new ResizeObserver(size).observe(document.documentElement);
  });
})();
`;

const PANEL_BASE_CSS = `${tokens}
html, body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 var(--font); color-scheme: dark; }
body { padding: 2px; }
a { color: var(--focus); }
label { display: block; color: var(--muted); font-size: 13px; margin: 0 0 6px; }
input, select, textarea, button { font: inherit; color: inherit; box-sizing: border-box; }
input:not([type=checkbox]):not([type=radio]), select, textarea {
  width: 100%; min-height: var(--control); padding: 0 10px; background: var(--input);
  border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
}
textarea { padding: 8px 10px; }
input[type=checkbox] { accent-color: var(--focus); }
button { height: var(--control); padding: 0 14px; background: var(--raised-hi); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); cursor: pointer; }
button:hover { background: var(--seg-on); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
code { background: var(--raised); padding: 1px 5px; border-radius: 4px; }
p, ol, ul { color: var(--muted); }
`;

/** The srcdoc for a panel: base styles and the bridge go first in <head>. */
export function panelDocument(html: string): string {
  const inject = `<meta charset="utf-8"><style>${PANEL_BASE_CSS}</style><script>${PANEL_BRIDGE}</script>`;
  const head = /<head[^>]*>/i;
  if (head.test(html)) return html.replace(head, (m) => m + inject);
  return `<!doctype html><html><head>${inject}</head><body>${html}</body></html>`;
}
