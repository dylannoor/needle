import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ExtensionInfo } from "../../bindings/ExtensionInfo";

const { api } = vi.hoisted(() => ({
  api: { extensionsList: vi.fn(), extensionSource: vi.fn(), extensionCall: vi.fn() },
}));

vi.mock("../../lib/ipc", () => ({
  api,
  on: () => () => {},
  errorText: (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong."),
}));

import { ExtensionPanel } from "../index";

function ext(panel: string | null): ExtensionInfo {
  return {
    manifest: { id: "rekordbox", name: "Rekordbox", version: "1.0.0", description: "", author: null, main: "worker.js", panel, permissions: [] },
    enabled: true,
    dir: "/ext/rekordbox",
    error: null,
    builtin: true,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ExtensionPanel id="rekordbox" />
    </QueryClientProvider>,
  );
}

async function mounted() {
  const view = renderPanel();
  await waitFor(() => expect(view.container.querySelector("iframe")).not.toBeNull());
  const frame = view.container.querySelector("iframe")!;
  const post = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
  const send = (data: unknown, source: MessageEventSource | null = frame.contentWindow) =>
    act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data, source }));
    });
  return { view, frame, post, send };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.extensionsList.mockResolvedValue([ext("panel.html")]);
  api.extensionSource.mockResolvedValue("<p>Settings</p>");
});

afterEach(() => cleanup());

describe("ExtensionPanel", () => {
  it("renders the panel in a scripts-only sandbox with the bridge injected", async () => {
    const { frame } = await mounted();
    expect(api.extensionSource).toHaveBeenCalledWith("rekordbox", "panel.html");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    const doc = frame.getAttribute("srcdoc")!;
    expect(doc).toContain("<p>Settings</p>");
    expect(doc).toContain("window.needle");
  });

  it("renders nothing when the extension has no panel", async () => {
    api.extensionsList.mockResolvedValue([ext(null)]);
    const view = renderPanel();
    await waitFor(() => expect(api.extensionsList).toHaveBeenCalled());
    expect(view.container.innerHTML).toBe("");
    expect(api.extensionSource).not.toHaveBeenCalled();
  });

  it("shows the error when the panel cannot load", async () => {
    api.extensionSource.mockRejectedValue('"panel.html" does not exist');
    const view = renderPanel();
    await waitFor(() => expect(view.container.textContent).toContain('"panel.html" does not exist'));
  });

  it("proxies storage calls from its own frame and replies to that frame", async () => {
    api.extensionCall.mockResolvedValue({ path: "~/Music/Needle/rekordbox.xml" });
    const { post, send } = await mounted();
    await send({ __needle: "call", rid: 3, method: "settings.get", args: null });
    expect(api.extensionCall).toHaveBeenCalledWith("rekordbox", "settings.get", null);
    expect(post).toHaveBeenCalledWith(
      { __needle: "result", rid: 3, ok: true, value: { path: "~/Music/Needle/rekordbox.xml" } },
      "*",
    );
  });

  it("returns host errors to the frame", async () => {
    api.extensionCall.mockRejectedValue("extension storage is full (5 MB)");
    const { post, send } = await mounted();
    await send({ __needle: "call", rid: 1, method: "storage.set", args: { key: "a", value: 1 } });
    expect(post).toHaveBeenCalledWith({ __needle: "result", rid: 1, ok: false, error: "extension storage is full (5 MB)" }, "*");
  });

  it("refuses methods panels may not use", async () => {
    const { post, send } = await mounted();
    for (const method of ["fs.writeText", "fs.readText", "notify"]) {
      await send({ __needle: "call", rid: 1, method, args: { path: "/etc/x", text: "x" } });
    }
    expect(api.extensionCall).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith({ __needle: "result", rid: 1, ok: false, error: '"fs.writeText" is not available in panels' }, "*");
  });

  it("ignores messages from any other source", async () => {
    const { post, send } = await mounted();
    await send({ __needle: "call", rid: 1, method: "settings.get" }, window);
    await send({ __needle: "call", rid: 1, method: "settings.get" }, null);
    expect(api.extensionCall).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("ignores malformed calls", async () => {
    const { send } = await mounted();
    for (const data of [null, "x", { __needle: "call", method: "settings.get" }, { __needle: "call", rid: 1 }, { rid: 1, method: "settings.get" }]) {
      await send(data);
    }
    expect(api.extensionCall).not.toHaveBeenCalled();
  });

  it("sizes the frame to the reported content height within bounds", async () => {
    const { frame, send } = await mounted();
    await send({ __needle: "size", height: 512.4 });
    expect(frame.getAttribute("height")).toBe("513");
    await send({ __needle: "size", height: 99999 });
    expect(frame.getAttribute("height")).toBe("2000");
    await send({ __needle: "size", height: 0 });
    expect(frame.getAttribute("height")).toBe("40");
    await send({ __needle: "size", height: "big" });
    expect(frame.getAttribute("height")).toBe("40");
  });
});
