import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../lib/ipc";
import { renderWithProviders } from "../../../test/render";

const runtime = vi.hoisted(() => ({ reloadExtensions: vi.fn(async () => {}) }));
vi.mock("../../../extensions-runtime", () => ({
  reloadExtensions: runtime.reloadExtensions,
  startExtensionRuntime: vi.fn(async () => {}),
  ExtensionPanel: ({ id }: { id: string }) => <div>panel for {id}</div>,
}));

const { ExtensionsScreen } = await import("..");

describe("Extensions", () => {
  beforeEach(() => runtime.reloadExtensions.mockClear());

  it("lists permissions in plain language", async () => {
    renderWithProviders(<ExtensionsScreen />);
    const list = await screen.findByRole("list", { name: "Installed extensions" });
    expect(within(list).getByText("Get told when a download passes the quality check")).toBeInTheDocument();
    expect(within(list).getByText("Read and write files in ~/Music/rekordbox")).toBeInTheDocument();
    // fs:read for the same folder is folded into the write line.
    expect(within(list).queryByText("Read files in ~/Music/rekordbox")).not.toBeInTheDocument();
  });

  it("asks before turning an extension on and lists what it may do", async () => {
    const spy = vi.spyOn(api, "extensionSetEnabled");
    const { user } = renderWithProviders(<ExtensionsScreen />);
    await user.click(await screen.findByRole("switch", { name: "Turn on Last.fm loved tracks" }));
    const dialog = screen.getByRole("dialog", { name: "Turn on Last.fm loved tracks?" });
    expect(within(dialog).getByText("See your downloads")).toBeInTheDocument();
    expect(within(dialog).getByText("Get told when a search finishes")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("lastfm", true));
    await waitFor(() => expect(runtime.reloadExtensions).toHaveBeenCalled());
    expect(await screen.findByRole("switch", { name: "Turn off Last.fm loved tracks" })).toBeChecked();
  });

  it("does nothing when the confirm is cancelled", async () => {
    const spy = vi.spyOn(api, "extensionSetEnabled");
    const { user } = renderWithProviders(<ExtensionsScreen />);
    await user.click(await screen.findByRole("switch", { name: "Turn on Last.fm loved tracks" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: "Turn on Last.fm loved tracks" })).not.toBeChecked();
  });

  it("turns off without asking", async () => {
    const spy = vi.spyOn(api, "extensionSetEnabled");
    const { user } = renderWithProviders(<ExtensionsScreen />);
    await user.click(await screen.findByRole("switch", { name: "Turn off Rekordbox" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalledWith("rekordbox", false));
  });

  it("shows the panel of an enabled extension and no uninstall for built-ins", async () => {
    renderWithProviders(<ExtensionsScreen />);
    expect(await screen.findByText("panel for rekordbox")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Uninstall" })).not.toBeInTheDocument();
  });

  it("uninstalls a community extension after confirming", async () => {
    const spy = vi.spyOn(api, "extensionUninstall");
    const { user } = renderWithProviders(<ExtensionsScreen />);
    await user.click(await screen.findByRole("button", { name: "Last.fm loved tracks" }));
    await user.click(screen.getByRole("button", { name: "Uninstall" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Uninstall" }));
    await waitFor(() => expect(spy.mock.calls[0]?.[0]).toBe("lastfm"));
    await waitFor(() => expect(screen.queryByText("Last.fm loved tracks")).not.toBeInTheDocument());
  });
});
