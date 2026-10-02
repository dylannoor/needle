/** Manifest permission strings in plain language, for the confirm dialog and the list. */
const events: Record<string, string> = {
  "download.verified": "Get told when a download passes the quality check",
  "download.completed": "Get told when a download finishes",
  "search.completed": "Get told when a search finishes",
  "pm.received": "Read private messages you receive",
};

export function describePermission(p: string): string {
  if (p.startsWith("events:")) {
    const name = p.slice("events:".length);
    return events[name] ?? `Get told about ${name} events`;
  }
  if (p.startsWith("fs:write:")) return `Read and write files in ${p.slice("fs:write:".length)}`;
  if (p.startsWith("fs:read:")) return `Read files in ${p.slice("fs:read:".length)}`;
  if (p === "notify") return "Show notifications";
  if (p === "jobs:read") return "See your downloads";
  return p;
}

/** fs:read and fs:write for the same folder collapse into the write line. */
export function describePermissions(perms: string[]): string[] {
  const writes = new Set(perms.filter((p) => p.startsWith("fs:write:")).map((p) => p.slice("fs:write:".length)));
  return perms.filter((p) => !(p.startsWith("fs:read:") && writes.has(p.slice("fs:read:".length)))).map(describePermission);
}
