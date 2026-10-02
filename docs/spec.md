# Needle design

Needle is a Soulseek client with the feature set of Nicotine+ and an interface
built around what people actually do: find a release in the quality they want,
get it, and trust that it is real.

## What makes it different

**Quality profile.** One ordered list of tiers ("FLAC 24-bit, then FLAC 16-bit
44.1+, then MP3 320 CBR/V0") plus source rules (max queue length, prefer
complete releases). The same profile filters search results, picks the source,
and is the bar the verifier checks downloads against.

**Releases, not files.** Search results are grouped per peer and folder into
releases. Folders with identical file names and sizes at other peers become
fallback sources for that release. Everything below the profile is hidden and
counted ("Show 1,278 hidden files").

**The fallback engine.** A download job owns a release and its ranked sources.
It switches source when a transfer gets no data for N minutes, waits in a remote
queue too long, fails, or a file fails verification. A rejected file is fetched
again from the next source that has the identical file. When all sources are
exhausted it searches again, and finally puts the query on the wishlist. Every
decision is logged in plain language on the job ("kdj_archive stopped sending
data, switched to vinyl_haus").

**Verification.** After each file completes: decode the header (codec, sample
rate, bit depth, bitrate) and check it against the tier, then average the
spectrum over the track and look for a brick-wall cutoff. Lossless files that
stop well below Nyquist are lossy transcodes; MP3 320 that stops at 16 kHz is
an upsampled 128k. Strictness changes the thresholds. On failure the file is
deleted or moved to a Rejected folder, depending on the profile.

**Downloads go where Nicotine+ puts them**: the download folder, keeping the
uploader's folder name.

## Feature parity with Nicotine+

Search (network, user, room, wishlist, exclusion terms, history), downloads and
uploads with queues, slots, speed limits and buddies-first, shares with
per-folder visibility (everyone, buddies, nobody) and rescans, browsing a user's
shares, user info, buddies with notes, ban and ignore lists, chat rooms
(public and private, tickers), private messages, interests, recommendations and
similar users, away status, port mapping, and plugins (here: extensions).

## Architecture

`crates/needle-core` holds every decision as pure code: `releases` (grouping and
ranking), `profile` (tier matching), `jobs` (the fallback state machine, events
in and actions out) and `verify` (symphonia + rustfft). `src-tauri` wraps
soulseek-rs-lib (MIT, full modern protocol), runs the jobs, persists state in
SQLite and exposes the commands and events in `docs/ipc.md`. The frontend is
React with components styled from `src/styles/tokens.css`; the screens follow
the mockups in `docs/design/`.

## Extensions

An extension is a folder with `manifest.json` and a worker script. The worker
runs in a Web Worker with no access to Tauri; it talks to the host by
postMessage, and every host call goes through `extension_call`, where Rust
checks it against the manifest's permissions (`events:<name>`,
`fs:read:<dir>`, `fs:write:<dir>`, `notify`, `jobs:read`). A panel, if any, is
rendered in a sandboxed iframe. Extensions are disabled until the user enables
them and sees the permissions they ask for.

The first extension, `extensions/rekordbox`, listens to `download.verified` and
keeps a `rekordbox.xml` up to date with a "Needle" playlist, which Rekordbox
imports through its XML bridge. It never touches Rekordbox's own database.
