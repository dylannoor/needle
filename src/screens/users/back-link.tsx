import { useNav } from "../../lib/nav";

/** "Back to buddies" link above profile and browse views. */
export function BackLink({ label = "Buddies" }: { label?: string }) {
  const nav = useNav();
  return (
    <button type="button" className="link self-start text-[13px] text-muted" onClick={() => nav.setUsersView({ kind: "buddies" })}>
      Back to {label.toLowerCase()}
    </button>
  );
}
