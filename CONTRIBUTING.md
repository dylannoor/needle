# Contributing

Thanks for wanting to help. A few things keep the project easy to work on.

Open an issue before a large change so we can agree on the approach. Small
fixes can go straight to a pull request.

Keep pull requests to one concern, give them a conventional commit title
(`feat: show queue position in transfers`), and describe what changed and how
you tested it in a few plain sentences. UI changes need a screenshot.

Before pushing, run `cargo fmt --all`, `cargo clippy --workspace --all-targets
-- -D warnings`, `cargo test --workspace`, `pnpm typecheck`, `pnpm lint` and
`pnpm test`. CI runs the same checks.

If you change a Tauri command or event, update `docs/ipc.md` and commit the
regenerated `src/bindings`.

Logic that decides something (which source, whether a file is real, when to
give up) belongs in `crates/needle-core` with a test. The Tauri layer only wires
it to the network and the UI.

By contributing you agree that your work is licensed under GPL-3.0-or-later.
