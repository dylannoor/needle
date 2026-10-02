# Needle

Open source Soulseek client (Tauri v2, Rust, React). GPL-3.0-or-later. These
notes are for anyone working on the code, people and coding agents alike.

## Layout

- `crates/needle-core`: the engine (search grouping, quality profiles, the
  fallback job state machine, audio verification). No Tauri, no network.
- `src-tauri`: the app. Wraps soulseek-rs-lib, stores state in SQLite, exposes
  commands and events, hosts extensions.
- `src`: the React frontend. `src/bindings` is generated, never edit it.
- `extensions/`: first-party extensions (Rekordbox).
- `docs/ipc.md`: every command and event. Update it with any IPC change.

## Commands

- `pnpm tauri dev` runs the app.
- `cargo test --workspace` runs Rust tests and regenerates `src/bindings`.
- `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all`.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`.

## Pull requests

- English, written like a person: what changed and why in a few sentences, how
  you tested it. No templates full of empty headings, no AI attribution lines.
- Conventional commit titles (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`),
  imperative, under 72 characters. Same for the PR title.
- One concern per PR. Refactors go in their own PR.
- CI must be green: fmt, clippy with `-D warnings`, `cargo test`, typecheck,
  lint, frontend tests.
- Touching IPC means updating `docs/ipc.md` and committing regenerated bindings.
- UI changes get a screenshot in the PR description.
- Never add reviewers, comment on other people's issues or PRs, or ping anyone
  unless the maintainer asks for it.

## Code

- The engine stays pure: input events in, actions out, a fake clock in tests.
- Reusable UI patterns become components in `src/components`, no copied inline
  styles. Colors and spacing come from the tokens in `src/styles/tokens.css`.
- Empty states are faded placeholder rows that mirror the real layout, never an
  icon in a circle.
- No eyebrow labels (small uppercase text above a heading).
- No em dashes in UI copy or docs.
