import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../bindings/SessionStatus";
import { mockBackend } from "../mocks/backend";

const runtime = vi.hoisted(() => ({ startExtensionRuntime: vi.fn(async () => {}) }));
vi.mock("../extensions-runtime", () => ({
  startExtensionRuntime: runtime.startExtensionRuntime,
  reloadExtensions: vi.fn(async () => {}),
  ExtensionPanel: () => null,
}));
const { App } = await import("../App");

const session = (s: Partial<SessionStatus>): SessionStatus => ({ state: "online", username: "nightshift", error: null, listenPort: 2234, portOpen: true, away: false, remembered: true, ...s });

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App session handling", () => {
  it("starts the extension runtime once after login", async () => {
    renderApp();
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(runtime.startExtensionRuntime).toHaveBeenCalledTimes(1);
  });

  it("stays in the app while reconnecting and shows why", async () => {
    renderApp();
    await screen.findByRole("navigation", { name: "Main" });
    act(() => mockBackend.emit("session", session({ state: "connecting", error: "Lost the connection to the server, trying again in 10 s" })));
    expect(await screen.findByText("Reconnecting")).toBeInTheDocument();
    expect(screen.getByText(/trying again in 10 s/)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();

    act(() => mockBackend.emit("session", session({ state: "online" })));
    expect(await screen.findByText("Online as nightshift")).toBeInTheDocument();
  });

  it("goes back to login when logged in elsewhere", async () => {
    renderApp();
    await screen.findByRole("navigation", { name: "Main" });
    act(() => mockBackend.emit("session", session({ state: "error", error: "Someone logged in with your username somewhere else." })));
    expect(await screen.findByRole("heading", { name: "Log in to Soulseek" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("somewhere else");
  });
});
