# dsh-universe-api

[简体中文](README.zh-CN.md)

`dsh-universe-api` is an offline API-discovery plugin for DeepSeek Harness (DSH) and DSH Desktop. It registers one read-only tool, `universe_api_search`, for deterministic English and Chinese search across a bundled snapshot of the [public-apis](https://github.com/public-apis/public-apis) catalog.

> This is a discovery tool, not an API client. It never calls a candidate API, accepts no API keys, and performs no runtime network requests. Verify pricing, availability, authentication, and terms in the provider's official documentation before making an important choice.

Version `0.1.0-rc.2` is a release candidate intended for hands-on testing.

## What it provides

- Offline, deterministic search over 1,693 normalized public API records.
- English and Chinese query expansion, Unicode normalization, and CJK-aware matching.
- Hard filters for category, authentication, HTTPS, CORS, status, and source tier.
- Stable ranking with match reasons and catalog freshness metadata.
- An optional private canonical-v1 catalog that fully replaces the bundled snapshot.
- One reusable DSH contract that works in CLI, Web profiles, and DSH Desktop.

The plugin does not silently relax filters when there are no matches. In particular, `unknown` is distinct from `no`, and `sourceTier: "apilayer"` returns zero results with the public-only bundled catalog.

## Requirements

- DSH or DSH Desktop with access to a DSH Terminal.
- Node.js `^22.19.0 || >=24.0.0` for source development. DSH Desktop users normally use the runtime supplied by Desktop.

Run all installation commands below in the **DSH Terminal opened from DSH Desktop**, not an unrelated system shell. Add `--profile <name>` after `plugin` and after `dsh` if you manage a non-default profile.

### Compatibility baseline

| Component | Version | Coverage for `0.1.0-rc.2` |
| --- | --- | --- |
| `dsh-universe-api` | `0.1.0-rc.2` | Current release candidate |
| DSH Desktop | `2.0.3` | Contract target; hands-on Desktop acceptance is still pending |
| DSH runtime packages | `0.1.1-rc.2` | Native tool registration, execution, and packed profile Loader tests |
| Cordis | `4.0.1` | Automated tests |
| Node.js | `22.19.0`, `24.x` | CI; Desktop users use its bundled runtime |
| Operating systems | Ubuntu, Windows, macOS | Ubuntu full gate; Windows/macOS runtime, Loader, and package smoke |

The release candidate still requires hands-on verification of the packaged Desktop profile and UI lifecycle. Follow the [manual test checklist](docs/MANUAL_TESTING.md) before promoting it to a stable release.

## Install

Choose one source and pin it when possible.

### Local checkout

```bash
dsh plugin add /absolute/path/to/dsh-universe-api
```

### GitHub tag

```bash
dsh plugin add github:Ruixinhua/dsh-universe-api#v0.1.0-rc.2
```

The package is pure ESM and has no `build` or `prepare` install hook, so a GitHub installation does not need pnpm `allowBuilds` permission.

### Release tarball

Download the `.tgz` and matching `.sha256` assets from the GitHub release, place them in the same directory, and verify the checksum:

```bash
sha256sum --check dsh-universe-api-0.1.0-rc.2.tgz.sha256
dsh plugin add /absolute/path/to/dsh-universe-api-0.1.0-rc.2.tgz
```

On macOS, use `shasum -a 256 -c dsh-universe-api-0.1.0-rc.2.tgz.sha256` if `sha256sum` is unavailable.

On Windows, first change to the directory containing both downloaded files, or replace `$archive` and `$checksum` below with absolute paths. Verify the archive and install that exact verified file in PowerShell:

```powershell
$ErrorActionPreference = 'Stop'
$archive = '.\dsh-universe-api-0.1.0-rc.2.tgz'
$checksum = '.\dsh-universe-api-0.1.0-rc.2.tgz.sha256'
$archivePath = (Resolve-Path -LiteralPath $archive).Path
$expected = ((Get-Content -LiteralPath $checksum -Raw).Trim() -split '\s+')[0]
$actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($expected -notmatch '^[0-9a-fA-F]{64}$') { throw "Invalid SHA-256 file: $checksum" }
if ($actual -ine $expected) { throw "SHA-256 mismatch for $archivePath" }
dsh plugin add $archivePath
```

### Confirm activation

```bash
dsh --dump-config
```

Confirm that the output contains a `dsh-universe-api` layer and plugin row. Use **Quit** from the DSH Desktop tray, then launch Desktop again so the new bundle enters the Loader composition. Closing the window only hides Desktop, and opening a new chat alone is not sufficient.

## Use

Ask DSH to use the tool explicitly while testing:

```text
Use universe_api_search to find 3 weather APIs that require no API key and have HTTPS=yes and CORS=yes. Explain why each result matched.
```

Chinese example:

```text
请使用 universe_api_search，找 3 个无需 API key、HTTPS=yes、CORS=yes 的天气 API，并说明匹配理由。
```

The tool accepts:

| Input | Type and behavior |
| --- | --- |
| `query` | Optional natural-language string, up to 2,048 characters. Omit it to browse using filters only. |
| `categories` | Optional string array with at most 20 values of up to 128 characters each. Multiple values use OR semantics. |
| `sourceTier` | `all` (default), `public`, or `apilayer`. |
| `auth` | `none`, `api_key`, `oauth2`, `basic`, `bearer`, `signed`, `user_agent`, `other`, or `unknown`. |
| `https`, `cors` | `yes`, `no`, or `unknown`; values are matched exactly. |
| `status` | `active`, `coming_soon`, `stale`, `candidate`, or `unknown`. |
| `limit` | Integer from 1 to 20; default 5. |

Results contain catalog identity and freshness, normalized query details, the applied filters, the total match count, truncation state, and ranked API records with match reasons. Markdown is rendered for chat, while Code Mode can consume the complete structured value.

## Use a private catalog

Add a later row to the active profile's `cordis.patch.yml` (normally under `$DSH_HOME/profiles/<name>/`) and set `catalogPath`:

```yaml
- id: dsh-universe-api
  config:
    catalogPath: '/absolute/path/to/private/catalog.json'
```

The file must:

- use canonical catalog schema v1;
- be a regular JSON file at an absolute path;
- be no larger than 16 MiB; and
- contain a complete catalog, not a partial overlay.

Use `dsh --dump-config` with the same profile selection to confirm that this row is the final value for `dsh-universe-api`. An external catalog fully replaces the bundled public snapshot. It is never merged with the public data. An invalid, missing, relative, oversized, or unreadable file prevents the plugin from loading; there is no silent fallback. Results identify the source as `external` without exposing the local path. Restart DSH Desktop after changing the file or its path.

Complete one healthy start before deliberately testing an invalid catalog and note its time. If the invalid catalog opens Recovery, open **Rollback**, select the exact checkpoint slot whose timestamp matches that healthy start, preview and confirm it, then restart. If no usable checkpoint exists, open **Diagnostics → Open profile patch** and restore the known-good plugin row manually. If the tray remains available, the restart menu beside Desktop settings can choose **Restart in Recovery Mode**. Complete a healthy restart before trying the next failure case. The [manual test checklist](docs/MANUAL_TESTING.md) gives the full sequence.

See [Private catalog format](docs/PRIVATE_CATALOG.md) for the canonical-v1 shape and validation rules.

## Update a pinned installation

Choose one fixed source and update the same profile where the plugin is already installed:

- **Release tarball:** download the new `.tgz` and `.sha256`, verify them using the platform-specific instructions above, then install that exact verified tarball. On Windows, repeat the PowerShell block with the new filenames; it ends with `dsh plugin add $archivePath`. On Linux or macOS run:

```bash
dsh plugin add /absolute/path/to/dsh-universe-api-NEW_VERSION.tgz
```

- **GitHub tag:** install the exact new tag directly. This is a separate source; the Release tarball checksum does not authenticate the Git checkout fetched by pnpm.

  ```bash
  # Replace NEW_VERSION with the exact release version, including any prerelease suffix.
  dsh plugin add github:Ruixinhua/dsh-universe-api#vNEW_VERSION
  ```

`dsh plugin add` replaces the profile's installed dependency specification for the package. A bare `dsh plugin update` does not choose a new fixed Git tag or tarball path for you. Run `dsh --dump-config`, confirm the `dsh-universe-api` layer still appears exactly once, then use tray **Quit** and launch Desktop again. Repeat the core search prompt to verify the upgraded version.

## Remove

```bash
dsh plugin remove dsh-universe-api
```

Use tray **Quit** and launch DSH Desktop again, then confirm with `dsh --dump-config` that the layer is gone.

## Test a release candidate

The maintainer gates are:

```bash
npm ci
npm run typecheck
npm test
npm run verify:loader
npm run check
npm pack --dry-run
```

For a real acceptance test, install the **release tarball**, not the checkout that produced it. Follow the [manual test checklist](docs/MANUAL_TESTING.md), which covers offline behavior, exact filters, private catalog replacement, the Web profile, and uninstall.

## Data, privacy, and limitations

- The bundled snapshot was generated from `public-apis/public-apis` commit [`988c57be4616cc9507fd3e8c34adedba5387f079`](https://github.com/public-apis/public-apis/commit/988c57be4616cc9507fd3e8c34adedba5387f079) and is distributed under that project's MIT license. See [third-party notices](THIRD_PARTY_NOTICES.md).
- No APILayer record from the prior mixed private catalog is redistributed. `sourceTier: "apilayer"` exists so a compatible private catalog can expose that tier.
- Catalog entries can become stale after the snapshot is generated. The tool does not probe endpoints or verify current provider terms.
- The plugin does not provide a browser UI, semantic embeddings, a remote database, an MCP server, or API execution.
- The private catalog path and API documentation URLs are read for discovery only. The plugin does not accept, store, or transmit credentials.
- Unknown tool arguments are rejected. Never place credentials in a tool call: DSH may retain attempted arguments in its session history even when the plugin rejects them.

## Maintainer documentation

- [Development and architecture](docs/DEVELOPMENT.md)
- [Catalog maintenance](docs/CATALOG_MAINTENANCE.md)
- [Manual release-candidate testing](docs/MANUAL_TESTING.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

The plugin code is licensed under the [MIT License](LICENSE). Bundled third-party data retains its upstream notice as described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
