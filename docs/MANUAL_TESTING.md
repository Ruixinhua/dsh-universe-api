# DSH Desktop manual test checklist

Use this checklist to accept a release artifact. Record the DSH Desktop version, operating system, release tag, tarball SHA-256, and result of every case.

## Prepare the release artifact

1. Download the `.tgz`, `.tgz.sha256`, and catalog update report from the same GitHub Release.
2. Verify the checksum before installation.
3. Open **DSH Terminal** from the DSH Desktop tray menu.
4. Install the downloaded tarball, not a local source checkout.

```bash
sha256sum --check dsh-universe-api-0.1.0-rc.1.tgz.sha256
dsh plugin add /absolute/path/to/dsh-universe-api-0.1.0-rc.1.tgz
dsh --dump-config
```

On macOS, use `shasum -a 256 -c` when `sha256sum` is unavailable. Confirm that the dumped configuration contains a `dsh-universe-api` layer and exactly one plugin row for it. Fully quit and restart DSH Desktop.

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

After installation, disconnect the machine from the network and repeat the core search.

Pass when search still completes with the same ranked IDs and there is no network prompt or retry. Reconnect only after recording the result.

## Private catalog replacement

Create a valid canonical-v1 test catalog containing a clearly synthetic record, then configure its absolute path:

```yaml
- id: dsh-universe-api
  config:
    catalogPath: '/absolute/path/to/private/catalog.json'
```

Fully quit and restart DSH Desktop. Search for the synthetic record.

Pass when:

- the synthetic record is found;
- bundled public records are absent, proving replacement rather than merge;
- catalog source is `external`; and
- neither structured output nor Markdown contains the configured filesystem path.

Then test each failure independently: a relative path, a missing file, malformed JSON, invalid canonical-v1 data, and a file larger than 16 MiB. Restart after each configuration change. Pass when plugin activation fails clearly and never falls back to the bundled catalog.

Restore the default plugin row with no `catalogPath`, restart, and confirm catalog source returns to `bundled-public`.

## Ordinary Web profile

Install the same tarball into the ordinary `web` profile, inspect its assembled configuration, and start that profile:

```bash
dsh plugin --profile web add /absolute/path/to/dsh-universe-api-0.1.0-rc.1.tgz
dsh --profile web --dump-config
dsh --profile web
```

Open the printed local Web URL and repeat the core search. After this check, remove the test installation with `dsh plugin --profile web remove dsh-universe-api` and stop the Web process.

Pass when the tool loads and behaves the same without any DSH Desktop-only service.

## Uninstall

In the DSH Terminal, run:

```bash
dsh plugin remove dsh-universe-api
```

Fully quit and restart DSH Desktop. Pass when `dsh --dump-config` no longer shows the bundle layer and `universe_api_search` is no longer available.

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
| Uninstall |  |  |
