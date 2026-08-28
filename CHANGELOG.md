# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-rc.2] - 2026-08-28

### Added

- Packed-tarball DSH profile and Cordis Loader smoke coverage on Ubuntu, Windows, and macOS.

### Changed

- Documented the Desktop 2.0.3 compatibility baseline, Windows release checksum/install flow, pinned-source upgrades, tray restart semantics, and exact Recovery checkpoint procedure.

### Fixed

- Reject Unix FIFO and other special-file catalogs without blocking plugin startup.
- Keep non-empty queries with no searchable terms at zero results instead of silently browsing the catalog.
- Restore precise English and Chinese shipping, logistics, and parcel discovery while preserving generic tracking searches.

## [0.1.0-rc.1] - 2026-08-27

### Added

- Initial DSH bundle and `universe_api_search` tool.
- Deterministic English and Chinese offline search with hard filters.
- Bundled 1,693-record public-apis snapshot with source and freshness metadata.
- Optional canonical-v1 external catalog replacement through `catalogPath`.
- Fail-closed credential, duplicate-key, path, input-size, validation-budget, and search-index bounds for untrusted sidecars and tool arguments.
- Catalog synchronization and validation tooling.
- Cross-platform CI, release packaging, checksums, and manual acceptance guidance.

[Unreleased]: https://github.com/Ruixinhua/dsh-universe-api/compare/v0.1.0-rc.2...HEAD
[0.1.0-rc.2]: https://github.com/Ruixinhua/dsh-universe-api/compare/v0.1.0-rc.1...v0.1.0-rc.2
[0.1.0-rc.1]: https://github.com/Ruixinhua/dsh-universe-api/releases/tag/v0.1.0-rc.1
