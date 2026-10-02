import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../../lib/ipc";
import { jobs } from "../../../mocks/fixtures";
import { renderWithProviders } from "../../../test/render";
import { TransfersScreen } from "..";
import { JobDetail } from "../job-detail";

const larry = () => jobs().find((j) => j.id === "j2")!;

describe("JobDetail", () => {
  it("explains a rejected file with the reason, the cutoff and the spectrum", () => {
    renderWithProviders(<JobDetail job={larry()} onRemoved={() => {}} />);
    expect(screen.getByText("Why 03 - Washing Machine.flac was rejected")).toBeInTheDocument();
    expect(screen.getByText("Cutoff at 16 kHz")).toBeInTheDocument();
    expect(screen.getByText(/the signature of a 128 to 192 kbps MP3 saved as FLAC/)).toBeInTheDocument();
    const chart = screen.getByRole("img", { name: /stops at 16 kHz out of 22.1 kHz/ });
    // 64 bands plus the cutoff marker, placed at 16000 / 22050 of the width.
    expect(chart.querySelectorAll(".grow")).toHaveLength(64);
    expect(within(chart).getByTestId("cutoff").style.left).toBe(`${(16000 / 22050) * 100}%`);
  });

  it("dims bands above the cutoff and keeps the ones below lit", () => {
    renderWithProviders(<JobDetail job={larry()} onRemoved={() => {}} />);
    const bars = [...screen.getByRole("img").querySelectorAll(".grow")];
    const lit = bars.filter((b) => b.classList.contains("bg-spectrum")).length;
    expect(lit).toBe(Math.floor((16000 / 22050) * 64 - 0.5) + 1);
    expect(bars.at(-1)).toHaveClass("bg-line-strong");
  });

  it("keeps a rejected file when asked and shows it as kept", async () => {
    const spy = vi.spyOn(api, "jobKeepFile");
    const { user } = renderWithProviders(<TransfersScreen />);
    const aside = await screen.findByRole("complementary", { name: "Transfer details" });
    await user.click(await within(aside).findByRole("button", { name: "Keep 03 - Washing Machine.flac anyway" }));
    expect(spy).toHaveBeenCalledWith("j2", "03 - Washing Machine.flac");
    await waitFor(() => expect(within(aside).queryByRole("button", { name: /anyway/ })).not.toBeInTheDocument());
    expect(within(aside).getByText("Why 03 - Washing Machine.flac was flagged")).toBeInTheDocument();
    expect(within(aside).getByText("Kept anyway")).toBeInTheDocument();
  });

  it("has no spectrum section when every file passed", () => {
    const job = jobs().find((j) => j.id === "j5")!;
    renderWithProviders(<JobDetail job={job} onRemoved={() => {}} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /anyway/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove from list" })).toBeInTheDocument();
  });

  it("pauses and then offers resume", async () => {
    const { user } = renderWithProviders(<TransfersScreen />);
    const aside = await screen.findByRole("complementary", { name: "Transfer details" });
    await user.click(await within(aside).findByRole("button", { name: "Pause" }));
    expect(await within(aside).findByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("shows a failed action inline", async () => {
    vi.spyOn(api, "jobCancel").mockRejectedValueOnce("That download no longer exists.");
    const { user } = renderWithProviders(<TransfersScreen />);
    const aside = await screen.findByRole("complementary", { name: "Transfer details" });
    await user.click(await within(aside).findByRole("button", { name: "Cancel" }));
    expect(await within(aside).findByRole("alert")).toHaveTextContent("That download no longer exists.");
  });
});
