# `v0.1.0` DSH Desktop acceptance

Decision: **accepted for protected npm promotion**.

This record identifies the exact stable Draft Release artifact accepted before npm OIDC publication. It does not claim that npm `latest`, provenance, the public GitHub Release, dshfind, or DSH Market installation has already been verified.

## Artifact and environment

| Item | Accepted value |
| --- | --- |
| Tag | `v0.1.0` at commit `32f22f8d06860950aadbf9bcacd15fa5d6b11984` |
| Release workflow | [`33369319110`](https://github.com/Ruixinhua/dsh-universe-api/actions/runs/33369319110) |
| Tarball | `dsh-universe-api-0.1.0.tgz` from the Draft Release |
| Tarball SHA-256 | `d9e46a3c7627242f84b4fac26b90eb1ab69ce21cf5e9ea08736cad3284850448` |
| Tarball SRI | `sha512-ns0SKPm2X50lJMI6Lgm9oYZAYcDuD6b9fhU1G20nQ1I21BtKvZOqEgAQuR3A37Miz1OXWbvJuoFZzXEExRXmLA==` |
| Catalog report SHA-256 | `ba0c7ee372106c4df9fbad9f09c01c39d277a5037ecf1fd63f174fa3543d7891` |
| DSH Desktop | `2.0.3` |
| Desktop runtime | Node.js `24.18.1`, macOS `15.7.3`, Apple silicon |
| Profiles | `desktop` and ordinary `web` |
| UI model | OpenAI GPT-5.4 nano; no credential value was recorded |
| Acceptance issue | [Issue #2](https://github.com/Ruixinhua/dsh-universe-api/issues/2) |

## Acceptance results

| Case | Result | Evidence |
| --- | --- | --- |
| Draft checksum and install | Pass | The downloaded Draft tarball matched its published SHA-256, passed the release-asset audit, and installed as `0.1.0`. |
| Profile composition | Pass | The composed `desktop` profile contained exactly one `dsh-universe-api` layer and one plugin row. |
| Full Desktop restart | Pass | A complete Quit and relaunch reached `rendererStatus: healthy`; the stable tool mounted and executed. |
| Positive Chinese tool call | Pass | Exact filters for weather, public source, no auth, HTTPS/CORS `yes`, status `unknown`, and limit 3 returned 3 of 9 matches from `bundled-public`. |
| Deterministic repeat | Pass | Two UI calls with identical arguments returned the same IDs and scores: US Weather `42.017568`, Pirate Weather `40.85639`, and World Time & Weather `34.940913`. |
| Zero-result hard filters | Pass | A Desktop UI call with `sourceTier=apilayer` returned zero results and preserved every explicit filter. |
| Tri-state separation | Pass | Installed ToolRuntime searches returned 4 weather results for CORS `no` and 20 for `unknown`; the result sets were non-empty, disjoint, and exact. |
| Input bounds | Pass | `limit=0` and `limit=21` were both rejected by the installed DSH ToolRuntime. |
| Offline execution | Pass | The installed artifact completed schema registration, search, filtering, and deterministic ranking inside a macOS process sandbox with all network access denied. |
| Valid external catalog | Pass | A one-record synthetic catalog fully replaced the bundled snapshot, returned only its synthetic APILayer record, reported `external`, and exposed no local path. Desktop also reached a healthy startup with that sidecar configured. |
| Invalid external catalogs | Pass | Relative, missing, malformed, and oversized catalogs all failed closed. No case fell back to the bundled catalog. |
| Error-path privacy | Pass | The activation error, recursive Cordis chain, Desktop error log, and Recovery detail omitted the configured canary catalog path. |
| Recovery | Pass | A missing sidecar opened Recovery at Plugin Host startup. Rolling back to the recorded healthy bundled-public Slot 1 and restarting restored `rendererStatus: healthy`. |
| Ordinary Web profile | Pass | The same Draft tarball installed into `web`; its browser UI invoked the tool with the same arguments and returned the same `bundled-public` top three. The Web process was stopped and the test dependency removed. |
| Fixed-release upgrade | Pass | The installed RC.3 fixed source was replaced in place by the verified `0.1.0` Draft tarball while preserving exactly one layer. |
| Uninstall lifecycle | Pass | Removing the direct dependency and fully restarting removed the layer; a fresh Desktop session reported the tool unavailable. The same stable tarball was then reinstalled and restarted successfully. |

## Observations

- GPT-5.4 nano summarized the per-record source tier as `public` in prose. The underlying tool detail correctly reported the catalog identity as `bundled-public`; acceptance used the raw tool arguments and output rather than the model's paraphrase.
- The first local offline assertion looked for an `auth` result field. The public result contract uses `authTypes`; correcting the acceptance script made the same installed artifact pass without a plugin change.
- One previously created shared session reported a DSH session-log sequence gap after profile lifecycle testing. A fresh session loaded and completed the uninstall check, and the condition did not involve plugin data or execution.

## Final local and remote state

- `desktop` is healthy with `dsh-universe-api@0.1.0` installed from the accepted Draft tarball.
- The Desktop user patch is the default empty list, so results use `bundled-public`.
- The temporary `web` process is stopped and its test plugin dependency is removed.
- The GitHub Release remains Draft and non-prerelease.
- npm `next` and `latest` remain `0.1.0-rc.3`; npm `0.1.0` has not been published.
- No P0 or P1 issue was found during stable Desktop acceptance.

## Next gate

Run the protected `publish-npm.yml` workflow from `v0.1.0`. Review preflight evidence, approve the `npm-production` environment, verify OIDC publication and provenance, and publish the GitHub Draft only after npm `latest` matches the accepted integrity. Market and catalog-provider verification remains a separate post-publication gate.
