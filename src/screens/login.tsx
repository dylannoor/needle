import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Logo } from "../components/ui/icons";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { InlineError } from "../components/ui/states";
import { api, errorText } from "../lib/ipc";
import { keys, useSession } from "../lib/queries";

export function LoginScreen() {
  const qc = useQueryClient();
  const status = useSession().data ?? null;
  const [username, setUsername] = useState(status?.username ?? "");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const login = useMutation({
    mutationFn: () => api.login(username.trim(), password, remember),
    onSuccess: (s) => qc.setQueryData(keys.session, s),
  });
  // login answers "connecting"; the outcome arrives as a session event.
  const connecting = login.isPending || status?.state === "connecting";
  const error = login.error ? errorText(login.error) : status?.state === "error" || status?.state === "connecting" ? status.error : null;

  return (
    <div data-tauri-drag-region className="flex h-full items-center justify-center bg-bg">
      <form
        className="flex w-[340px] flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <div className="flex items-center gap-[9px] pb-8 text-text">
          <Logo size={26} />
          <span className="text-[20px] font-bold tracking-[-0.02em]">Needle</span>
        </div>
        <h1>Log in to Soulseek</h1>
        <p className="mt-1.5 mb-6 text-[13px] text-muted">New here? Pick any username and password. The first person to log in with a name owns it.</p>
        <label htmlFor="username" className="pb-1.5 text-[13px] text-muted">
          Username
        </label>
        <Input id="username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor="password" className="pt-4 pb-1.5 text-[13px] text-muted">
          Password
        </label>
        <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Checkbox className="mt-3 text-[13px]" checked={remember} onCheckedChange={setRemember} label="Remember me on this computer" />
        {error && (
          <div className="pt-5">
            <InlineError message={error} />
          </div>
        )}
        <Button type="submit" variant="primary" size="lg" className="mt-6" disabled={connecting || !username.trim() || !password}>
          {connecting ? "Connecting" : "Log in"}
        </Button>
      </form>
    </div>
  );
}
