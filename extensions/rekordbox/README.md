# Rekordbox

Adds every verified download to a "Needle" playlist that Rekordbox can import
through its XML bridge. It writes a `rekordbox.xml` file and never touches
Rekordbox's own database.

## Setup

1. In Needle, open Extensions, turn on Rekordbox and accept its permissions.
2. Optionally change the XML file, the playlist name, or switch to one
   playlist per release in the extension's panel.
3. In Rekordbox, open Preferences, then Advanced, then Database. Under
   "rekordbox xml", set Imported Library to the XML file
   (default `~/Music/Needle/rekordbox.xml`).
4. In the tree on the left, open "rekordbox xml" and find the Needle playlist.
   If "rekordbox xml" is missing from the tree, turn it on under Preferences,
   View, Layout.
5. Drag the tracks into your Collection. After new downloads, click the
   refresh icon next to "rekordbox xml" to see them.

## How it works

Each `download.verified` event adds the file to a library kept in the
extension's storage (deduplicated by path), then the whole XML is written
again. Track ids are positions in that library, so they stay stable. When
the job finishes (`download.completed`) you get one notification with the
number of tracks it added, like "Added 16 tracks to the Needle playlist".

Only verified files are added. If your quality profile does not verify
downloads, nothing shows up here.

## Permissions

| Permission | Why |
|---|---|
| `events:download.verified` | To hear about each file that passed verification. |
| `events:download.completed` | To send one notification when a job finishes. |
| `fs:write:~/Music` | To write the XML file. Its path must stay inside your Music folder. |
| `notify` | For that notification. |

## Files

- `worker.js` listens to events and writes the file.
- `xml.js` builds the XML. It is pure and has tests in `__tests__/`.
- `panel.html` is the settings panel.
