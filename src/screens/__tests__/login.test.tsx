import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { keys } from "../../lib/queries";
import { renderWithProviders } from "../../test/render";
import { LoginScreen } from "../login";

describe("Login", () => {
  it("keeps the button disabled until both fields are filled", async () => {
    const { user } = renderWithProviders(<LoginScreen status={null} />);
    const button = screen.getByRole("button", { name: "Log in" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Username"), "dj");
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Password"), "pw");
    expect(button).toBeEnabled();
  });

  it("logs in with remember me and stores the session", async () => {
    const spy = vi.spyOn(api, "login");
    const { user, client } = renderWithProviders(<LoginScreen status={null} />);
    await user.type(screen.getByLabelText("Username"), " dj ");
    await user.type(screen.getByLabelText("Password"), "pw");
    await user.click(screen.getByRole("checkbox", { name: "Remember me on this computer" }));
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(spy).toHaveBeenCalledWith("dj", "pw", false);
    await waitFor(() => expect(client.getQueryData(keys.session)).toMatchObject({ state: "online", username: "dj" }));
  });

  it("shows the backend's error in plain language", async () => {
    const { user } = renderWithProviders(<LoginScreen status={null} />);
    await user.type(screen.getByLabelText("Username"), "dj");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That password doesn't match this username.");
  });

  it("shows a connection error from the session", () => {
    renderWithProviders(<LoginScreen status={{ state: "error", username: "dj", error: "Can't reach the Soulseek server.", listenPort: 2234, portOpen: null, away: false, remembered: false }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Can't reach the Soulseek server.");
    expect(screen.getByLabelText("Username")).toHaveValue("dj");
  });
});
