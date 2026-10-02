import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../../lib/ipc";
import { renderWithProviders } from "../../../test/render";
import { SearchScreen } from "..";

async function searchHomework() {
  const r = renderWithProviders(<SearchScreen />);
  await r.user.type(screen.getByRole("combobox", { name: "Search the network" }), "Daft Punk Homework{Enter}");
  await screen.findByText("match your profile.", undefined, { timeout: 3000 });
  return r;
}

const rows = () => within(screen.getByRole("listbox", { name: "Releases" })).getAllByRole("option");

describe("Search results", () => {
  it("shows matching releases with a summary and owned marker", async () => {
    const spy = vi.spyOn(api, "ownedCheck");
    await searchHomework();
    expect(screen.getByText("6 releases")).toBeInTheDocument();
    expect(rows()).toHaveLength(6);
    expect((await screen.findAllByText("You have this")).length).toBe(2);
    // owned_check gets one {path, size} per release, the first audio file.
    const files = spy.mock.calls.at(-1)![0];
    expect(files).toHaveLength(6);
    expect(files[0]).toEqual({ path: expect.stringMatching(/01 - Daftendirekt\.flac$/), size: expect.any(Number) });
    // The first release is selected and detailed in the aside.
    const aside = screen.getByRole("complementary", { name: "Selected release" });
    expect(within(aside).getByText(/one of 4 identical sources/)).toBeInTheDocument();
  });

  it("shows hidden releases dimmed with the reason, and hides them again", async () => {
    const { user } = await searchHomework();
    const spy = vi.spyOn(api, "searchView");
    await user.click(screen.getByRole("button", { name: "Show 1,278 hidden files" }));
    await screen.findByText("Hidden by your profile");
    expect(spy).toHaveBeenLastCalledWith(expect.any(String), "lossless-first", true);
    expect(rows()).toHaveLength(10);
    // Reasons come from the backend's hiddenReason.
    expect(screen.getByText("AAC is not in any tier")).toBeInTheDocument();
    expect(screen.getByText("22.05 kHz, your FLAC tiers need 44.1 kHz or higher")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide the hidden files" }));
    await waitFor(() => expect(screen.queryByText("Hidden by your profile")).not.toBeInTheDocument());
    expect(rows()).toHaveLength(6);
  });

  it("filters by codec family and complete releases", async () => {
    const { user } = await searchHomework();
    await user.click(screen.getByRole("button", { name: "FLAC", pressed: true }));
    expect(rows().map((r) => within(r).getByText(/motorcity_wax|lowend_theory/).textContent)).toEqual(["motorcity_wax", "lowend_theory"]);

    await user.click(screen.getByRole("button", { name: "FLAC", pressed: false }));
    await user.click(screen.getByRole("button", { name: "Complete only" }));
    expect(rows()).toHaveLength(5);
    expect(screen.queryByText("planet_e_fan")).not.toBeInTheDocument();
  });

  it("shows a ghost state when the filters leave nothing", async () => {
    const { user } = await searchHomework();
    await user.click(screen.getByRole("button", { name: "FLAC" }));
    await user.click(screen.getByRole("button", { name: "MP3 320" }));
    expect(screen.getByText("No releases left with these filters")).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Releases" })).not.toBeInTheDocument();
  });

  it("downloads only the picked files", async () => {
    const { user } = await searchHomework();
    const spy = vi.spyOn(api, "downloadRelease");
    const aside = screen.getByRole("complementary", { name: "Selected release" });
    await user.click(within(aside).getByRole("button", { name: "Pick files" }));
    expect(within(aside).getByRole("button", { name: "Pick some files" })).toBeDisabled();
    await user.click(within(aside).getByRole("checkbox", { name: "Pick Da Funk" }));
    await user.click(within(aside).getByRole("checkbox", { name: "Pick Fresh" }));
    await user.click(within(aside).getByRole("button", { name: "Download 2 files" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [, releaseId, files] = spy.mock.calls[0];
    expect(releaseId).toBe("r0");
    expect(files).toHaveLength(2);
    expect(files![0]).toMatch(/04 - Da Funk\.flac$/);
    expect(await within(aside).findByText(/Added to your downloads/)).toBeInTheDocument();
  });

  it("shows the error inline when starting a search fails", async () => {
    vi.spyOn(api, "searchStart").mockRejectedValueOnce("Not connected to Soulseek.");
    const { user } = renderWithProviders(<SearchScreen />);
    await user.type(screen.getByRole("combobox", { name: "Search the network" }), "anything{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Not connected to Soulseek.");
  });

  it("ignores an empty query", async () => {
    const spy = vi.spyOn(api, "searchStart");
    const { user } = renderWithProviders(<SearchScreen />);
    await user.type(screen.getByRole("combobox", { name: "Search the network" }), "   {Enter}");
    expect(spy).not.toHaveBeenCalled();
  });
});
