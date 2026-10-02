# Writing an extension

An extension is a folder with a `manifest.json`, a worker script and
optionally a panel page. The worker runs in a Web Worker with no access to
Tauri or the app. Everything it does on your computer goes through a small
`needle` API, and Needle checks each call against the permissions in the
manifest. Extensions are off until you turn them on and see what they ask
for.

`extensions/rekordbox` is a complete example.

## The folder

```
my-extension/
  manifest.json
  worker.js        the worker, an ES module
  lib.js           anything the worker imports with a relative path
  panel.html       optional settings page
```

## manifest.json

```json
{
  "id": "my-extension",
  "name": "My extension",
  "version": "1.0.0",
  "description": "One sentence about what it does.",
  "author": "You",
  "main": "worker.js",
  "panel": "panel.html",
  "permissions": ["events:download.verified", "fs:write:~/Music/Exports", "notify"]
}
```

| Field | Rules |
|---|---|
| `id` | `a-z`, `0-9` and `-`, at most 64 characters, not starting with `-`. Unique. |
| `name` | Shown in the Extensions screen. Not empty. |
| `version` | `x.y.z`, optionally with `-pre` or `+build`. |
| `description` | One sentence. |
| `author` | Optional. |
| `main` | Relative path to the worker module inside the folder. |
| `panel` | Optional relative path to an HTML page inside the folder. |
| `permissions` | See below. Any unknown permission makes the manifest invalid. |

A manifest that fails these checks still shows up in the list with its error,
but it can't be turned on.

## Permissions

| Permission | Grants |
|---|---|
| `events:<name>` | Receiving that event, for example `events:download.verified`. |
| `fs:read:<dir>` | `fs.readText` and `fs.exists` inside `<dir>`. |
| `fs:write:<dir>` | Everything `fs:read` grants, plus `fs.writeText` and `fs.mkdir` inside `<dir>`. |
| `notify` | Showing system notifications. |

`<dir>` is an absolute path or starts with `~/`. A path passes when, after
expanding `~`, folding `.` and `..`, and resolving symlinks in the part that
exists, it is the granted folder or inside it. A symlink that points out of
the folder does not get you out, and neither does a dangling one. Granting
the whole filesystem (`fs:read:/`) is refused.

Storage and settings need no permission: each extension only sees its own.

The permission model covers the `needle` API. A worker is still JavaScript in
a browser engine, so it can use `fetch` like any web page. Only install
extensions you trust.

## The worker

`main` is loaded as an ES module worker. Relative imports (`import { x } from
"./lib.js"`) work for `.js` and `.mjs` files inside the extension folder.
Bare imports (`import "lodash"`) do not; bundle those first. Circular imports
are not supported.

Before your code runs, Needle defines a global `needle`:

```js
needle.on(eventName, (payload, event) => { ... })

await needle.fs.readText(path)          // string
await needle.fs.writeText(path, text)   // creates parent folders, writes atomically
await needle.fs.exists(path)            // boolean
await needle.fs.mkdir(path)             // creates parents too

await needle.storage.get(key)           // any JSON value, or null
await needle.storage.set(key, value)    // null removes the key

await needle.settings.get()             // the object stored under "settings", or {}
await needle.settings.set(object)       // same as storage.set("settings", object)

await needle.notify(title, body)
```

Every call returns a promise. A denied or failed call rejects with an `Error`
whose message says why, for example `no permission to write /etc/hosts`.

Limits: files up to 20 MB each, storage up to 5 MB per extension, keys up to
200 characters.

Handlers may be async. If a handler throws or rejects, or the worker fails to
load, Needle logs the error to the console and marks the extension as failed
in the Extensions screen. Other handlers keep running.

Events are delivered one by one but your handlers are not awaited between
events. If a handler reads and then writes shared state, chain the work
yourself. `extensions/rekordbox/worker.js` runs every event through one
promise queue, which also makes sure a job's `download.completed` is handled
after the work for its last `download.verified` file.

## Events

Payload types are in `crates/needle-core/src/api.rs`.

| Event | When | Payload |
|---|---|---|
| `download.verified` | A downloaded file passed audio verification. One per file. Only sent when the quality profile verifies. | `DownloadedFile` |
| `download.completed` | A download job finished, after its files' `download.verified` events. One per job, with the same `jobId`. `localPath` is the job's folder, `album` is the job title, codec is `"other"`. Use it for per-job work like a single notification. | `DownloadedFile` |
| `search.completed` | A search stopped collecting results. | `{ searchId, query, releases }` |
| `pm.received` | A private message arrived. | `ChatMessage` |

`DownloadedFile`:

```ts
{
  jobId: string,
  localPath: string,       // absolute path on disk
  title: string,
  artist: string | null,
  album: string | null,
  trackNumber: number | null,
  durationSecs: number | null,
  codec: "flac" | "alac" | "wav" | "aiff" | "mp3" | "aac" | "ogg" | "opus" | "other",
  sampleRate: number | null,
  bitDepth: number | null,
  bitrateKbps: number | null,
  size: number,            // bytes
}
```

## The panel

If the manifest has a `panel`, the Extensions screen shows it in a sandboxed
iframe (`sandbox="allow-scripts"`, so no same-origin access, no navigation of
the app, no popups). The panel can be an HTML fragment or a full document.

Needle injects, before your own markup and scripts:

- A base stylesheet with the app's design tokens as CSS variables (`--bg`,
  `--text`, `--muted`, `--line`, `--focus`, `--control`, `--radius-sm`, and
  the rest of `src/styles/tokens.css`) and native-looking defaults for inputs,
  buttons and labels. Use the variables so your panel matches the app.
- A smaller `needle` with only `storage` and `settings`:

```js
await needle.settings.get()
await needle.settings.set({ ... })
await needle.storage.get(key)
await needle.storage.set(key, value)
```

The panel has no file access, no events and no notifications. Keep those in
the worker and share state through storage. The frame grows with its content,
up to 2000 px.

## Installing

Built-in extensions ship in the app's `extensions/` folder. To add your own,
install it from the Extensions screen and pick the folder with
`manifest.json`. Needle checks the manifest, copies the folder into its data
directory (`<app data>/extensions/<id>/`) and lists it as turned off. Symlinks
inside the folder are skipped, and the folder may hold at most 100 MB.

Installing the same id again replaces the copy and turns it off, so you
approve its permissions again. You can't install over a built-in id.
Uninstalling removes the copy and its storage.

During development, after changing your files, install the folder again and
turn it back on. For first-party extensions in `extensions/`, a debug build
reads the repo folder directly, so turning the extension off and on again is
enough.

## Where things are stored

| What | Where |
|---|---|
| Installed extensions | `<app data>/extensions/<id>/` |
| Which ones are on | `<app data>/extensions.json` |
| Storage and settings | `<app data>/extension-storage/<id>.json` |
