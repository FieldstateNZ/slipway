# Slipway

[![CI](https://github.com/fieldstatenz/slipway/actions/workflows/ci.yml/badge.svg)](https://github.com/fieldstatenz/slipway/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

The externalized mental model — a dependency-aware task board where every task carries a
learn-loop, so execution builds retained capability instead of just clearing a list.
Built ADHD-first.

> Execution is the method; retained capability is the point.

Slipway is a local-first Tauri desktop app: Rust + SQLite behind a React/TypeScript
sidebar-shaped board. No network, no server, no accounts.

## Status

v0.1 in build. The design handoff from Claude Design under [`docs/design/`](docs/design/)
is authoritative for all UI work — `Slipway Sidebar.dc.html` is the primary design.

## Development

Prerequisites: [Rust](https://rustup.rs), [Node 22+](https://nodejs.org),
[pnpm](https://pnpm.io), and the
[Tauri Linux system dependencies](https://tauri.app/start/prerequisites/) on Linux.

```sh
pnpm install
pnpm tauri dev
```

Checks:

```sh
pnpm lint && pnpm typecheck && pnpm test   # TypeScript
cargo fmt --all --check && cargo clippy --workspace --all-targets && cargo test --workspace
```

## License

[Apache-2.0](LICENSE)
