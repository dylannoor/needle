# Needle

A Soulseek client that does what Nicotine+ does, with an interface that gets out
of the way. Set your quality bar once; Needle groups search results into
releases, picks a good source, switches to another one when a transfer stalls,
and checks every download's spectrum so a transcoded "FLAC" never makes it into
your library.

Runs on macOS, Windows and Linux. Built with Tauri, Rust and React, on top of
[soulseek-rs-lib](https://github.com/michel/soulseek-rs).

## Development

```sh
pnpm install
pnpm tauri dev
```

`cargo test --workspace` runs the Rust tests and regenerates the TypeScript
bindings in `src/bindings`. See [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/spec.md](docs/spec.md).

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
