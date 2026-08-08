# WinOTP - Reborn

WinOTP is a cross-platform Electron desktop app with a TypeScript 7-only frontend and an entirely Rust backend. The former JavaScript and C#/.NET source surfaces have been retired.

## Architecture

- Treat `electron-app/` as the primary application surface.
- Treat all executable application and Node tooling source under `electron-app/` as the TypeScript frontend/platform layer: `src/` is the React renderer, `electron/` is the Electron host and OS/persistence adapter boundary, and `scripts/` plus `vite.config.ts` are frontend tooling.
- Do not add JavaScript source files. Electron CommonJS files in ignored `electron-dist/` are generated from `.cts` sources by `npm run build:electron` and must never be edited directly.
- Treat the Rust workspace as the entire backend. `rust/winotp-core/` is the source of truth for portable account, OTP, import, backup, ordering, settings, protection policy, and other business logic; `rust/winotp-updater/` owns update discovery, selection, download, digest verification, and installer launch.
- TypeScript may orchestrate IPC, UI state, persistence calls, and OS APIs, but must not implement backend business rules, portable validation, or cryptography.
- Keep operating-system integration in Electron adapters or small Rust platform modules; do not add Windows-only behavior to the portable core.
- Do not reintroduce C# projects or source files.

## Checks

- Frontend/Electron: run `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` from `electron-app/`.
- Electron runtime: run `npm run build:electron` to compile the TypeScript Electron host into `electron-dist/`.
- Rust: run `cargo test --manifest-path rust/Cargo.toml --workspace` and `cargo fmt --manifest-path rust/Cargo.toml --all -- --check` when changing the core or updater.

## Releases

Electron packaging and release automation use the generated Electron runtime and Rust backend sidecars. Do not restore JavaScript source, C#/.NET, or the retired native installer pipeline.
