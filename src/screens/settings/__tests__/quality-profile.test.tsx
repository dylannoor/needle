import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QualityProfile } from "../../../bindings/QualityProfile";
import { api } from "../../../lib/ipc";
import { renderWithProviders } from "../../../test/render";
import { QualityProfilePage } from "../quality-profile";

const lastSaved = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.at(-1)?.[0] as QualityProfile;
const tierNames = () => within(screen.getByRole("list", { name: "Tiers, best first" })).getAllByRole("button").map((b) => b.getAttribute("aria-label"));

describe("Quality profile", () => {
  it("shows the strictness hint for the picked level", async () => {
    const { user } = renderWithProviders(<QualityProfilePage />);
    expect(await screen.findByText(/stop below 19 kHz/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Strict" }));
    expect(screen.getByText(/Expect some false alarms on old masters/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Relaxed" }));
    expect(screen.getByText("Only rejects files whose header lies about the format.")).toBeInTheDocument();
  });

  it("saves changes automatically and confirms", async () => {
    const spy = vi.spyOn(api, "profileSave");
    const { user } = renderWithProviders(<QualityProfilePage />);
    await user.click(await screen.findByRole("button", { name: "Raise queue limit" }));
    await user.click(screen.getByRole("radio", { name: /Move it to a Rejected folder/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(lastSaved(spy)).toMatchObject({ maxQueue: 51, verify: { onFail: "moveToRejected" } });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("stores stuck rules in seconds", async () => {
    const spy = vi.spyOn(api, "profileSave");
    const { user } = renderWithProviders(<QualityProfilePage />);
    const field = await screen.findByLabelText("Switch source after no data for");
    await user.clear(field);
    await user.type(field, "5{Enter}");
    await waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 2000 });
    expect(lastSaved(spy).stuck.noDataSecs).toBe(300);
  });

  it("reorders tiers with Alt and the arrow keys", async () => {
    const spy = vi.spyOn(api, "profileSave");
    const { user } = renderWithProviders(<QualityProfilePage />);
    const first = await screen.findByRole("button", { name: /^Tier 1: FLAC 24-bit/ });
    first.focus();
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(tierNames()[0]).toMatch(/^Tier 1: FLAC 16-bit/);
    expect(tierNames()[1]).toMatch(/^Tier 2: FLAC 24-bit/);
    await waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 2000 });
    expect(lastSaved(spy).tiers.map((t) => t.label)).toEqual(["FLAC 16-bit", "FLAC 24-bit", "MP3 320 kbps"]);
  });

  it("does not move the top tier further up", async () => {
    const { user } = renderWithProviders(<QualityProfilePage />);
    (await screen.findByRole("button", { name: /^Tier 1: FLAC 24-bit/ })).focus();
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(tierNames()[0]).toMatch(/^Tier 1: FLAC 24-bit/);
  });

  it("adds a tier and needs a name and a format first", async () => {
    const spy = vi.spyOn(api, "profileSave");
    const { user } = renderWithProviders(<QualityProfilePage />);
    await user.click(await screen.findByRole("button", { name: "Add a tier" }));
    const dialog = screen.getByRole("dialog", { name: "Add a tier" });
    const add = within(dialog).getByRole("button", { name: "Add tier" });
    expect(add).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Name"), "MP3 V0");
    await user.click(within(dialog).getByRole("button", { name: "FLAC", pressed: true }));
    expect(add).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "MP3", pressed: false }));
    await user.click(add);
    expect(tierNames()).toHaveLength(4);
    await waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 2000 });
    expect(lastSaved(spy).tiers[3]).toMatchObject({ label: "MP3 V0", codecs: ["mp3"] });
  });

  it("removes a tier from its edit dialog", async () => {
    const { user } = renderWithProviders(<QualityProfilePage />);
    await user.click(await screen.findByRole("button", { name: /^Tier 3: MP3 320/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove tier" }));
    expect(tierNames()).toHaveLength(2);
  });

  it("previews how many results the profile would show", async () => {
    await api.searchStart("Daft Punk Homework", null);
    renderWithProviders(<QualityProfilePage />);
    expect(await screen.findByText("Your last search would show 6 of 1,284 results")).toBeInTheDocument();
  });

  it("shows a save error inline", async () => {
    vi.spyOn(api, "profileSave").mockRejectedValueOnce("Couldn't write the profile to disk.");
    const { user } = renderWithProviders(<QualityProfilePage />);
    await user.click(await screen.findByRole("button", { name: "Raise queue limit" }));
    expect(await screen.findByRole("alert", undefined, { timeout: 2000 })).toHaveTextContent("Couldn't write the profile to disk.");
  });
});
