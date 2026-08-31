# `v0.1.0-rc.3` DSH Desktop acceptance

Decision: **accepted for RC distribution and npm `next` bootstrap**.

This record lets a future maintainer verify which release artifact and behaviors were accepted before the first npm publication. Stable promotion remains separately gated by npm Trusted Publishing and DSH Market installability.

## Artifact and environment

| Item | Accepted value |
| --- | --- |
| GitHub Release | [`v0.1.0-rc.3`](https://github.com/Ruixinhua/dsh-universe-api/releases/tag/v0.1.0-rc.3) |
| Tarball SHA-256 | `e68e8afdfef1b66add317eda0e1f4f352333301e88892862be555594195165f1` |
| Tarball SRI | `sha512-blU+XSkc1Edo9b13W9vGUsSfL/QG9okmDgbdRcCJu+lD+QdkanJJstSjQ7Yduc2UkI+ZgoP0eCmc8K2KLhwohw==` |
| DSH Desktop | `2.0.3` |
| Desktop runtime | Node.js `24.18.1`, macOS `15.7.3`, Apple silicon |
| Profiles | `desktop` and ordinary `web` |
| UI model | OpenAI GPT-5.4 nano; no credential value was recorded |
| Acceptance issue | [Issue #1](https://github.com/Ruixinhua/dsh-universe-api/issues/1) |

## Acceptance results

| Case | Result | Evidence |
| --- | --- | --- |
| Release checksum and install | Pass | Downloaded Release `.tgz` matched the published SHA-256 and installed as `0.1.0-rc.3`. |
| Profile composition | Pass | The composed `desktop` profile contained exactly one `dsh-universe-api` layer. |
| Full Desktop restart | Pass | A complete Quit and relaunch reached `rendererStatus: healthy`; the tool mounted and executed. |
| Positive Chinese tool call | Pass | Exact filters `weather`, `auth=none`, HTTPS/CORS `yes`, `status=unknown`, and `limit=3` returned 3 of 9 deterministic matches from `bundled-public`. |
| Deterministic repeat | Pass | Identical arguments returned the same IDs and scores: US Weather `42.017568`, Pirate Weather `40.85639`, and World Time & Weather `34.940913`. |
| Zero-result hard filters | Pass | The public snapshot returned zero for `sourceTier=apilayer` without changing the filter. A UI query with an unsatisfied filter combination also remained zero. |
| Tri-state separation | Pass | Weather searches with CORS `no` and `unknown` returned separate, non-empty, non-overlapping result sets. |
| Input bounds | Pass | `limit=0` and `limit=21` were rejected by the installed DSH ToolRuntime. |
| Offline execution | Pass | The installed artifact completed search and filter checks inside a process sandbox that denied all network access. |
| Valid external catalog | Pass | A one-record synthetic catalog replaced the bundled snapshot, returned only its synthetic APILayer record, and reported catalog source `external`. |
| Invalid external catalogs | Pass | Relative, missing, malformed, and oversized catalogs all failed closed. No case fell back to the bundled catalog. |
| Error-path privacy | Pass | The missing-file activation error and recursive Cordis error chain omitted the configured canary path. Profile configuration itself still contains its configured path by design. |
| Recovery | Pass | Missing external data opened Recovery at Plugin Host startup. Rolling back the recorded healthy bundled-public checkpoint and restarting restored a healthy Desktop. |
| Ordinary Web profile | Pass | The same Release tarball installed into `web`; its browser UI invoked `universe_api_search` and returned the same 3 deterministic weather results. The Web process was then stopped and the test dependency removed. |
| Fixed-release upgrade | Pass with observation | RC.2 → RC.3 replacement succeeded after restoring the exact prior RC.2 tarball to its pinned file location. See the observation below. |
| Uninstall lifecycle | Pass | Removing the direct dependency and fully restarting removed the layer; a fresh session reported `universe_api_search` unavailable. RC.3 was then reinstalled and restarted successfully. |

## Observations

- A profile pinned to a local Release tarball cannot be upgraded after that old file has been deleted: pnpm resolves the existing direct dependency before replacing it. Restoring the exact prior Release asset allowed the documented in-place upgrade to complete. This is a pinned-source lifecycle constraint, not an RC.3 runtime failure.
- pnpm reports host-provided Cordis and DSH Tools peers as absent from the profile's own dependency table. DSH Desktop nevertheless resolved them from its host runtime; full Loader startup, Desktop tool calls, and the ordinary Web profile all passed.
- GPT-5.4 nano filled omitted optional filters during one exploratory prompt. Acceptance therefore used explicit values for every hard filter and verified the actual tool-call arguments in the UI details panel.

## Final local state

- `desktop` is healthy with `dsh-universe-api@0.1.0-rc.3` installed.
- The user patch is back to its default empty list, so results use `bundled-public`.
- The temporary `web` process is stopped and its test plugin dependency is removed.
- No npm package or stable Market promotion was performed during Desktop acceptance.

## Next gate

Publish this exact accepted tarball once to npm under `next`, verify that `latest` does not point to a prerelease, configure the repository's protected Trusted Publisher, and only then prepare the stable Draft Release.
