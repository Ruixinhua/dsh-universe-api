# DSH Desktop manual test checklist

Use this checklist to accept a release artifact. Record the DSH Desktop version, operating system, release tag, tarball SHA-256, and result of every case.

Completed records:

- [`v0.1.0-rc.3` DSH Desktop acceptance](RELEASE_ACCEPTANCE_0.1.0-rc.3.md)

Current target: the `v0.1.0` Draft Release. Keep it Draft and keep npm `latest` unchanged until every case below passes against the exact Draft tarball.

## Prepare the release artifact

1. Download the `.tgz`, `.tgz.sha256`, and catalog update report from the same GitHub Release. For a Draft owned by the maintainer, use `gh release download v0.1.0 --repo Ruixinhua/dsh-universe-api`.
2. Verify the checksum before installation.
3. Open **DSH Terminal** from the DSH Desktop tray menu.
4. Install the downloaded tarball, not a local source checkout.

```bash
sha256sum --check dsh-universe-api-0.1.0.tgz.sha256
dsh plugin add /absolute/path/to/dsh-universe-api-0.1.0.tgz
dsh --dump-config
```

On macOS, use `shasum -a 256 -c` when `sha256sum` is unavailable. On Windows, first change to the directory containing both downloaded files, or replace `$archive` and `$checksum` with absolute paths. This PowerShell block verifies and then installs the exact archive whose hash matched:

```powershell
$ErrorActionPreference = 'Stop'
$archive = '.\dsh-universe-api-0.1.0.tgz'
$checksum = '.\dsh-universe-api-0.1.0.tgz.sha256'
$archivePath = (Resolve-Path -LiteralPath $archive).Path
$expected = ((Get-Content -LiteralPath $checksum -Raw).Trim() -split '\s+')[0]
$actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($expected -notmatch '^[0-9a-fA-F]{64}$') { throw "Invalid SHA-256 file: $checksum" }
if ($actual -ine $expected) { throw "SHA-256 mismatch for $archivePath" }
dsh plugin add $archivePath
dsh --dump-config
```

Confirm that the dumped configuration contains a `dsh-universe-api` layer and exactly one plugin row for it. Choose **Quit** from the DSH Desktop tray, then start Desktop again; closing the window is not a full quit.

## Core search

Send:

```text
请使用 universe_api_search，找 3 个无需 API key、HTTPS=yes、CORS=yes 的天气 API，并说明匹配理由。
```

Pass when:

- DSH invokes `universe_api_search` rather than answering only from model memory;
- no more than three results are returned;
- every result satisfies the requested authentication, HTTPS, and CORS filters;
- output includes match reasons and catalog freshness; and
- catalog source is `bundled-public`.

Repeat the same tool arguments twice. Result IDs, ordering, and scores must be identical.

## Hard filters and zero results

Ask DSH to call the tool with `sourceTier: "apilayer"` against the bundled catalog.

Pass when `totalMatches` is zero, `results` is empty, and the output does not substitute public records or omit the filter.

Run separate calls with `cors: "no"` and `cors: "unknown"`. Pass when every returned item exactly matches its requested value and no item crosses between the two sets. Apply the same check to HTTPS if the catalog contains both values.

Try `limit: 0` and `limit: 21`. Pass when the tool reports argument validation errors rather than clamping or executing the query.

## Offline behavior

Use one of these paths; a cloud model cannot generate a new tool call while the whole machine is offline:

- With a local tool-calling model, disconnect the machine and repeat the Desktop core search.
- Without a local model, disconnect or deny network access and invoke `universe_api_search` directly through the installed DSH ToolRuntime/Loader rather than through a cloud-model chat.
- For an OpenAI, DeepSeek, or other cloud-model Desktop session, keep the provider connection available and observe process traffic. Model-provider requests are expected; requests to catalog sources, API documentation hosts, or candidate API endpoints are not.

Pass when the local/direct invocation returns the same ranked IDs without a network retry, or when the cloud-model observation shows no plugin-originated catalog or candidate-API request. Do not fail a correct plugin merely because a cloud model cannot run while disconnected.

## Private catalog replacement

Create a valid canonical-v1 test catalog containing a clearly synthetic record, then configure its absolute path:

```yaml
- id: dsh-universe-api
  config:
    catalogPath: '/absolute/path/to/private/catalog.json'
```

Choose **Quit** from the DSH Desktop tray, start it again, and search for the synthetic record.

Pass when:

- the synthetic record is found;
- bundled public records are absent, proving replacement rather than merge;
- catalog source is `external`; and
- neither structured output nor Markdown contains the configured filesystem path.

Before testing failures, complete one healthy start with the default plugin row, note its time, and keep that known-good configuration available for Recovery. Test each failure independently: a relative path, a missing file, malformed JSON, invalid canonical-v1 data, and a file larger than 16 MiB. Pass when plugin activation fails clearly and never falls back to the bundled catalog.

After **every** intentionally failing case:

1. Record the activation error before changing the configuration.
2. If Recovery opens automatically, open **Rollback**, choose the exact checkpoint slot whose timestamp matches the recorded healthy start, preview and confirm that slot, then restart. If the tray is still available, the restart menu beside Desktop settings can instead select **Restart in Recovery Mode**.
3. If no usable checkpoint exists, open **Diagnostics → Open profile patch** and restore the plugin row with no `catalogPath`, or otherwise restore the known-good absolute path.
4. Return to the target profile, restart normally, and confirm `universe_api_search` reports `catalog.source: "bundled-public"` (or `"external"` for the known-good private path).
5. Only after the healthy restart should you configure and run the next failing case.

After the final failure case, leave the default plugin row with no `catalogPath`, restart normally, and confirm catalog source returns to `bundled-public`.

## Ordinary Web profile

Install the same tarball into the ordinary `web` profile, inspect its assembled configuration, and start that profile:

```bash
dsh plugin --profile web add /absolute/path/to/dsh-universe-api-0.1.0.tgz
dsh --profile web --dump-config
dsh --profile web
```

Open the printed local Web URL and repeat the core search. After this check, remove the test installation with `dsh plugin --profile web remove dsh-universe-api` and stop the Web process.

Pass when the tool loads and behaves the same without any DSH Desktop-only service.

## Upgrade from a fixed release

For the `0.1.0` acceptance, establish the accepted RC.3 baseline first:

```bash
dsh plugin add github:Ruixinhua/dsh-universe-api#v0.1.0-rc.3
dsh --dump-config
```

Choose **Quit** from the tray, start Desktop again, and repeat the core search. Pass this baseline stage only when the Plugin list reports `universe-api` as mounted, the tool executes, and catalog source remains `bundled-public`.

Then upgrade without removing the existing bundle. The accepted source for this gate is only the verified `0.1.0` Draft Release tarball:

Download the new `.tgz` and `.sha256`, verify them as described above, and install that exact verified tarball. On Windows, repeat the PowerShell block with the new filenames and use the resulting `$archivePath`. On Linux or macOS run:

```bash
dsh plugin add /absolute/path/to/dsh-universe-api-0.1.0.tgz
```

A GitHub tag installation may be tested additionally after the Release is public, but it is a separately fetched checkout and cannot replace acceptance of the Draft tarball bytes.

Run `dsh --dump-config` and confirm that the profile still contains exactly one `dsh-universe-api` bundle layer and retains the expected `catalogPath` configuration, if any. Choose **Quit** from the tray, restart, and repeat the core search.

## Uninstall

In the DSH Terminal, run:

```bash
dsh plugin remove dsh-universe-api
```

Choose **Quit** from the tray and restart DSH Desktop. Pass when `dsh --dump-config` no longer shows the bundle layer and `universe_api_search` is no longer available.

## Result record

Use a compact table in the release issue or test notes:

| Case | Pass/Fail | Evidence or observation |
| --- | --- | --- |
| Checksum and install |  |  |
| Config dump and restart |  |  |
| Chinese filtered search |  |  |
| Deterministic repeat |  |  |
| APILayer zero result |  |  |
| `unknown` vs `no` |  |  |
| Limit validation |  |  |
| Offline search |  |  |
| Valid private replacement |  |  |
| Invalid private catalogs fail closed |  |  |
| Ordinary Web profile |  |  |
| Fixed-release upgrade |  |  |
| Uninstall |  |  |
