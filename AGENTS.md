# WinOTP - Reborn

WinOTP is a cross-platform Electron desktop app with a TypeScript 7 frontend, a plain-JavaScript Electron shell, and a Rust domain and cryptography core. The former C#/.NET application surface has been retired.

## Architecture

- Treat `electron-app/` as the primary application surface.
- Treat `electron-app/src/` as TypeScript frontend source.
- Treat `electron-app/electron/`, `electron-app/scripts/`, and `electron-app/vite.config.mjs` as plain JavaScript. The `.cjs` Electron sources are copied to ignored `electron-dist/` runtime output.
- Treat `rust/winotp-core/` as the source of truth for portable account, OTP, import, backup, ordering, settings, and protection policy logic.
- Keep operating-system integration in Electron adapters or small Rust platform modules; do not add Windows-only behavior to the portable core.
- Do not reintroduce C# projects or source files.

## Checks

- Frontend/Electron: run `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` from `electron-app/`.
- Electron runtime: run `npm run build:electron` to copy the JavaScript shell into `electron-dist/`.
- Rust: run `cargo test --manifest-path rust/Cargo.toml --workspace` and `cargo fmt --manifest-path rust/Cargo.toml --all -- --check` when changing the core or updater.

## Releases

Electron packaging and release automation use the JavaScript Electron runtime and Rust sidecars. Do not restore the retired native installer pipeline for Electron releases.
