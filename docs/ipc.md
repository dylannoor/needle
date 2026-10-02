# IPC contract

Every command the frontend can `invoke`, and every event the backend `emit`s.
Payload types live in `crates/needle-core/src/{model,api}.rs` and are generated
into `src/bindings/` by `cargo test -p needle-core`. Command arguments are
camelCase on the JS side (Tauri's default). Errors come back as a plain string.

Events are global `app.emit(name, payload)`. Lists that change often are
re-sent whole, throttled to at most every 250 ms, so the UI never has to merge.

## Session

| Command | Args | Returns |
|---|---|---|
| `session_status` | | `SessionStatus` |
| `login` | `username, password, remember: bool` | `SessionStatus` |
| `logout` | | `SessionStatus` |
| `set_away` | `away: bool` | `SessionStatus` |

Event `session` → `SessionStatus`.

## Search

| Command | Args | Returns |
|---|---|---|
| `search_start` | `query, profileId: string \| null` | `string` (search id) |
| `search_view` | `searchId, profileId: string \| null, includeHidden: bool` | `SearchView` |
| `search_cancel` | `searchId` | |
| `search_history` | | `string[]` (latest first, max 50) |
| `search_user` | `username, query` | `string` (search id) |
| `search_room` | `room, query` | `string` (search id) |

Event `search:update` → `SearchView` (built with the active profile, hidden
releases omitted). Sent while results arrive and once more with `done: true`.

## Downloads (jobs)

| Command | Args | Returns |
|---|---|---|
| `download_release` | `searchId, releaseId, files: string[] \| null` | `JobView` |
| `download_files` | `username, folder, files: FileInfo[]` | `JobView` (from browse) |
| `jobs_list` | | `JobView[]` (active first, then finished, newest first) |
| `job_pause` / `job_resume` / `job_cancel` / `job_retry` | `jobId` | `JobView` |
| `job_remove` | `jobId` | | (only finished/cancelled/failed) |
| `jobs_clear_finished` | | |
| `job_keep_file` | `jobId, name` | `JobView` |
| `job_reveal` | `jobId` | | (opens the output folder) |

Event `jobs:update` → `JobView` (one job changed).

## Uploads

| Command | Args | Returns |
|---|---|---|
| `uploads_view` | | `UploadsView` |
| `upload_cancel` | `username, path` | |

Event `uploads:update` → `UploadsView`.

## Library and shares

| Command | Args | Returns |
|---|---|---|
| `shares_view` | | `SharesView` |
| `share_add` | `path, visibility: Visibility` | `SharesView` |
| `share_remove` | `path` | `SharesView` |
| `share_set_visibility` | `path, visibility` | `SharesView` |
| `shares_rescan` | | `SharesView` |
| `pick_folder` | | `string \| null` (native folder dialog) |
| `owned_check` | `paths: string[]` | `bool[]` ("you have this", by file name + size) |

Event `shares:update` → `SharesView`.

## Settings and profiles

| Command | Args | Returns |
|---|---|---|
| `settings_get` | | `Settings` |
| `settings_set` | `settings: Settings` | `Settings` |
| `profiles_list` | | `QualityProfile[]` |
| `profile_save` | `profile: QualityProfile` | `QualityProfile[]` |
| `profile_delete` | `id` | `QualityProfile[]` (the built-in one cannot be deleted) |
| `profile_preview` | `profile: QualityProfile` | `[shown: number, total: number] \| null` (against the last search) |

## Users and buddies

| Command | Args | Returns |
|---|---|---|
| `user_profile` | `username` | `UserProfile` (waits up to 10 s for the peer) |
| `buddies_list` | | `Buddy[]` |
| `buddy_add` / `buddy_remove` | `username` | `Buddy[]` |
| `buddy_note` | `username, note` | `Buddy[]` |
| `user_ban` / `user_unban` / `user_ignore` / `user_unignore` | `username` | |
| `blocked_list` | | `{ banned: string[], ignored: string[] }` |
| `browse_user` | `username` | `BrowseResult` (waits up to 60 s) |

Event `buddies:update` → `Buddy[]`.

## Chat

| Command | Args | Returns |
|---|---|---|
| `rooms_list` | | `RoomSummary[]` |
| `room_join` / `room_leave` | `room` | `RoomView` / |
| `room_view` | `room` | `RoomView` |
| `room_say` | `room, text` | |
| `room_set_ticker` | `room, text` | |
| `conversations_list` | | `Conversation[]` |
| `conversation` | `username` | `ChatMessage[]` |
| `pm_send` | `username, text` | `ChatMessage` |
| `pm_mark_read` | `username` | |

Events `room:event` → `RoomEventPayload`, `pm:message` → `ChatMessage`.

## Interests and wishlist

| Command | Args | Returns |
|---|---|---|
| `interests_get` | | `Interests` |
| `interest_add` / `interest_remove` | `item, like: bool` | `Interests` |
| `recommendations` | `global: bool` | `Recommendation[]` |
| `similar_users` | | `string[]` |
| `wishlist_list` | | `WishItem[]` |
| `wishlist_add` / `wishlist_remove` | `query` | `WishItem[]` |

Event `wishlist:hit` → `WishItem`.

## Extensions

| Command | Args | Returns |
|---|---|---|
| `extensions_list` | | `ExtensionInfo[]` |
| `extension_set_enabled` | `id, enabled` | `ExtensionInfo[]` |
| `extension_install` | `dir` | `ExtensionInfo[]` |
| `extension_uninstall` | `id` | `ExtensionInfo[]` |
| `extension_source` | `id, file` | `string` (worker/panel source, for the runtime to load) |
| `extension_call` | `id, method, args: any` | `any` (permission-checked host API) |

Event `ext:event` → `{ id: string, event: ExtensionEvent }`, one per enabled
extension that holds `events:<name>`.

### Host API for extensions (`extension_call` methods)

| Method | Permission | Args → result |
|---|---|---|
| `fs.readText` | `fs:read:<dir>` | `{ path }` → `string` |
| `fs.writeText` | `fs:write:<dir>` | `{ path, text }` → `null` |
| `fs.exists` | `fs:read:<dir>` | `{ path }` → `bool` |
| `fs.mkdir` | `fs:write:<dir>` | `{ path }` → `null` |
| `storage.get` / `storage.set` | (always) | `{ key }` / `{ key, value }`, per-extension JSON store |
| `notify` | `notify` | `{ title, body }` → `null` |
| `jobs.list` | `jobs:read` | → `JobView[]` |
| `settings.get` | (always) | → the extension's own settings object |

`<dir>` may start with `~`. A path is allowed when, after resolving `~`, `..`
and symlinks, it sits inside a granted directory.
