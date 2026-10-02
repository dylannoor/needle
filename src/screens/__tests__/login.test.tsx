import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { keys } from "../../lib/queries";
import { mockBackend } from "../../mocks/backend";
import { renderWithProviders } from "../../test/render";
import { LoginScreen } from "../login";

describe("Login", () => {
  beforeEach(async () => {
    await api.logout();
  });

  it("keeps the button disabled until both fields are filled", async () => {
    const { user } = renderWithProviders(<LoginScreen />);
    const button = await screen.findByRole("button", { name: "Log in" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Username"), "dj");
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Password"), "pw");
    expect(button).toBeEnabled();
  });

  it("shows connecting until the session event says online", async () => {
    const spy = vi.spyOn(api, "login");
    const { user, client } = renderWithProviders(<LoginScreen />);
    await user.type(await screen.findByLabelText("Username"), " dj ");
    await user.type(screen.getByLabelText("Password"), "pw");
    await user.click(screen.getByRole("checkbox", { name: "Remember me on this computer" }));
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(spy).toHaveBeenCalledWith("dj", "pw", false);
    await waitFor(() => expect(client.getQueryData(keys.session)).toMatchObject({ state: "online", username: "dj" }));
  });

  it("disables the form while connecting", async () => {
    const { client } = renderWithProviders(<LoginScreen />);
    await waitFor(() => expect(client.getQueryData(keys.session)).toBeDefined());
    act(() => client.setQueryData(keys.session, { state: "connecting", username: "dj", error: null, listenPort: 2234, portOpen: null, away: false, remembered: false }));
    expect(await screen.findByRole("button", { name: "Connecting" })).toBeDisabled();
  });

  it("shows a failed login from the session event in plain language", async () => {
    const { user } = renderWithProviders(<LoginScreen />);
    await user.type(await screen.findByLabelText("Username"), "dj");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That password doesn't match this username.");
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("shows an error the backend reports while offline", async () => {
    renderWithProviders(<LoginScreen />);
    await screen.findByRole("button", { name: "Log in" });
    act(() => mockBackend.emit("session", { state: "error", username: "dj", error: "You logged in somewhere else.", listenPort: 2234, portOpen: null, away: false, remembered: false }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You logged in somewhere else.");
  });

  it("shows a command error inline", async () => {
    vi.spyOn(api, "login").mockRejectedValueOnce("Enter your username and password.");
    const { user } = renderWithProviders(<LoginScreen />);
    await user.type(await screen.findByLabelText("Username"), "dj");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter your username and password.");
  });
});
