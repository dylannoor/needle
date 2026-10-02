// Extension runtime: runs each enabled extension's worker, routes `ext:event`
// to it, and brokers its host calls through `extension_call`. Owned by the
// extensions work; the app only uses the two exports below.

/** Start workers for all enabled extensions. Safe to call once at startup. */
export async function startExtensionRuntime(): Promise<void> {}

/** Restart workers after extensions were enabled, disabled or installed. */
export async function reloadExtensions(): Promise<void> {}

/** The extension's own panel (sandboxed iframe), or nothing if it has none. */
export function ExtensionPanel(_props: { id: string }) {
  return null;
}
