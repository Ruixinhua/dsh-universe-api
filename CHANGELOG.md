# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Record the exact `v0.1.2` replacement Draft and completed Desktop acceptance evidence for protected npm promotion.

## [0.1.2] - 2026-08-31

### Added

- Record the exact replacement `v0.1.1` Draft tarball and completed Desktop acceptance evidence used for protected npm promotion.

### Changed

- Supersede the unpublished `v0.1.1` Draft with a replacement stable artifact and acceptance cycle.

### Fixed

- Prefix the accepted tarball with `./` so npm publishes a local package file instead of interpreting the path as a Git repository spec.

## [0.1.1] - 2026-08-31

### Added

- Record the exact `v0.1.0` Draft tarball and completed Desktop acceptance evidence used to authorize protected npm promotion.

### Changed

- Supersede the unpublished `v0.1.0` Draft with a replacement stable artifact and acceptance cycle.

### Fixed

- Grant only the ephemeral promotion jobs the push-level repository visibility GitHub requires to read Draft Release assets.

## [0.1.0] - 2026-08-31

### Fixed

- Allow stable npm promotion over the prerelease `latest` that the public registry can create on a package's first `next` publication, while preserving full SemVer downgrade protection and stable post-publish validation.
- Keep the isolated Loader smoke deterministic when a newer Schemastery version appears within the declared peer range.
- Bind release-asset construction and Draft Release creation to the immutable remote tag commit.

### Changed

- Document the npm first-publication dist-tag transition and its non-installable DSH Market status.
- Prepare the stable package identity and exact Draft-tarball Desktop acceptance flow.

## [0.1.0-rc.3] - 2026-08-29

### Added

- Exact manifest, tarball, checksum, private-data, lifecycle-script, and npm release-channel gates.
- Protected stable promotion through a Draft GitHub Release, environment approval, npm OIDC trusted publishing, provenance, and post-publish integrity verification.
- Bilingual Market distribution, npm bootstrap, dshfind verification, and curated-directory guidance.

### Changed

- Declare Schemastery as a DSH runtime peer while retaining an exact development version and packed Loader verification.
- Reuse the single audited Release tarball across GitHub and npm instead of rebuilding during promotion.

### Fixed

- Prevent external `catalogPath` values from reappearing through recursive filesystem error causes in Cordis activation logs.
- Refuse mutable-tag, changed-asset, npm `latest` downgrade, and stale-release promotion states.

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

[Unreleased]: https://github.com/Ruixinhua/dsh-universe-api/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/Ruixinhua/dsh-universe-api/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Ruixinhua/dsh-universe-api/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Ruixinhua/dsh-universe-api/compare/v0.1.0-rc.3...v0.1.0
[0.1.0-rc.3]: https://github.com/Ruixinhua/dsh-universe-api/compare/v0.1.0-rc.2...v0.1.0-rc.3
[0.1.0-rc.2]: https://github.com/Ruixinhua/dsh-universe-api/compare/v0.1.0-rc.1...v0.1.0-rc.2
[0.1.0-rc.1]: https://github.com/Ruixinhua/dsh-universe-api/releases/tag/v0.1.0-rc.1
