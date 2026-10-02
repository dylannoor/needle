import type { Presence } from "../bindings/Presence";
import { presenceLabel } from "../lib/format";
import { StatusDot, type Tone } from "./ui/status";

const tone: Record<Presence, Tone> = { online: "ok", away: "warn", offline: "idle", unknown: "idle" };

export const PresenceDot = ({ presence }: { presence: Presence }) => <StatusDot tone={tone[presence]} label={presenceLabel[presence]} />;
