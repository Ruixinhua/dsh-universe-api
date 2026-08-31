# `v0.1.1` replacement DSH Desktop acceptance

Decision: **accepted for protected npm promotion**.

This record identifies the replacement stable Draft artifact accepted after the unpublished `v0.1.0` promotion preflight exposed insufficient GitHub Draft visibility. It does not claim npm, provenance, public GitHub, catalog-provider, or Market success before those states are verified.

## Artifact and environment

| Item | Accepted value |
| --- | --- |
| Tag | `v0.1.1` at commit `825cffd8a6ad405d72a948140ff5b613d0492c59` |
| Release workflow | [`33371798354`](https://github.com/Ruixinhua/dsh-universe-api/actions/runs/33371798354) |
| Tarball | `dsh-universe-api-0.1.1.tgz` from the replacement Draft Release |
| Tarball SHA-256 | `3def1444c32dab24780166211240a5c52ae2f4eb15b01f52a99d80bd82900364` |
| Tarball SRI | `sha512-87O9HIeSLL8kDe9CnoWg7OviBRSwtLfb4Q1j7nAIHepSscXAVHmRkXhEYVBibo58BiKTRrbHo16xPRUHlpd5Tw==` |
| Catalog report SHA-256 | `ba0c7ee372106c4df9fbad9f09c01c39d277a5037ecf1fd63f174fa3543d7891` |
| DSH Desktop | `2.0.3` |
| Desktop runtime | Node.js `24.18.1`, macOS `15.7.3`, Apple silicon |
| Profiles | `desktop` and ordinary `web` |
| UI model | OpenAI GPT-5.4 nano; no credential value was recorded |
| Acceptance issue | [Issue #3](https://github.com/Ruixinhua/dsh-universe-api/issues/3) |

## Acceptance results

| Case | Result | Evidence |
| --- | --- | --- |
| Draft checksum and install | Pass | The replacement Draft tarball matched its SHA-256, passed the release-asset audit, and installed as `0.1.1`. |
| Profile composition | Pass | The composed `desktop` profile contained exactly one `dsh-universe-api` layer and one plugin row. |
| Full Desktop restart | Pass | Complete Quit/relaunch cycles reached `rendererStatus: healthy` with the replacement artifact. |
| Positive Chinese tool call | Pass | Desktop invoked the tool with every explicit weather/auth/HTTPS/CORS/status filter and returned 3 of 9 matches from `bundled-public`. |
| Deterministic repeat | Pass | Two installed ToolRuntime calls returned the same IDs and exact scores: US Weather `42.017568`, Pirate Weather `40.85639`, and World Time & Weather `34.940913`. |
| Zero-result hard filters | Pass | The bundled catalog returned zero for `sourceTier=apilayer` without changing the filter. |
| Tri-state separation | Pass | CORS `no` returned 4 weather results and `unknown` returned 20; both sets were exact, non-empty, and disjoint. |
| Input bounds | Pass | `limit=0` and `limit=21` were rejected by the installed DSH ToolRuntime. |
| Offline execution | Pass | The installed replacement completed registration, filtering, and ranking in a process sandbox that denied all network access. |
| Valid external catalog | Pass | The synthetic one-record catalog replaced the public snapshot, returned its APILayer sentinel as `external`, and exposed no path. |
| Invalid external catalogs | Pass | Relative, missing, malformed, and oversized catalogs all failed closed without bundled fallback. |
| Error-path privacy | Pass | The configured `v0.1.1` canary path was absent from activation errors, Cordis logs, lifecycle logs, and Recovery detail. |
| Recovery | Pass | The missing sidecar opened Recovery; rollback to the recorded `0.1.1` bundled-public Slot 2 restored `rendererStatus: healthy`. |
| Ordinary Web profile | Pass | The same replacement tarball loaded in `web`; its UI used exact arguments and returned the same `bundled-public` top three. The server and dependency were removed afterward. |
| Fixed-release upgrade | Pass | The accepted `0.1.0` Draft source was replaced in place by the verified `0.1.1` tarball while preserving one layer. |
| Uninstall lifecycle | Pass | Uninstall plus full restart removed the tool in a fresh session. Reinstalling the same replacement tarball restored a healthy Desktop. |

## Final state

- `desktop` is healthy with `dsh-universe-api@0.1.1` installed from the accepted replacement Draft tarball.
- The Desktop user patch is the default empty list and results use `bundled-public`.
- The temporary `web` server is stopped and its test dependency is removed.
- The `v0.1.1` GitHub Release remains Draft and non-prerelease.
- npm `next` and `latest` remain `0.1.0-rc.3`; npm `0.1.1` has not been published.
- No P0 or P1 issue was found.

## Promotion attempt

Workflow run [`33372999049`](https://github.com/Ruixinhua/dsh-universe-api/actions/runs/33372999049) passed Draft preflight, approval-time asset revalidation, and monotonic planning, then failed before registry publication. npm interpreted `dist/dsh-universe-api-0.1.1.tgz` as a GitHub repository shorthand because the local tarball spec lacked a `./` prefix. npm `0.1.1` remained absent and the GitHub Release remained Draft. The immutable version is superseded for publication by `v0.1.2`.

## Next gate

Generate and accept the `v0.1.2` Draft with an explicit `./dist/...tgz` local package spec. Run the protected workflow from that tag, publish only its accepted SRI, verify npm provenance and `latest`, then allow GitHub publication.
