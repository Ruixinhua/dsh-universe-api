# `v0.1.2` replacement DSH Desktop acceptance

Decision: **accepted for protected npm promotion**.

This record identifies the stable Draft accepted after two earlier immutable Draft versions failed closed before npm publication. It authorizes only the protected OIDC workflow and does not pre-claim registry, provenance, public GitHub, provider, or Market success.

## Artifact and environment

| Item | Accepted value |
| --- | --- |
| Tag | `v0.1.2` at commit `ebbdb388a73583d265987cdd3e17d8fefcdefdcf` |
| Release workflow | [`33373516655`](https://github.com/Ruixinhua/dsh-universe-api/actions/runs/33373516655) |
| Tarball | `dsh-universe-api-0.1.2.tgz` from the Draft Release |
| Tarball SHA-256 | `45808bf0937a7784bac3872313d37ec2870f94a80d3ccb675392e4b5dce8f066` |
| Tarball SRI | `sha512-HfCf/X0t58oOrrwfoY4h5QI3Wy9dlpM09+tY0VeFLqTB7a2apVjsYNJMTVfjJJgEF1goHRg9RbQ+eVf6pjU0lw==` |
| Catalog report SHA-256 | `ba0c7ee372106c4df9fbad9f09c01c39d277a5037ecf1fd63f174fa3543d7891` |
| DSH Desktop | `2.0.3`, runtime Node.js `24.18.1` |
| Host | macOS `15.7.3`, Apple silicon |
| Profiles | `desktop` and ordinary `web` |
| Acceptance issue | [Issue #4](https://github.com/Ruixinhua/dsh-universe-api/issues/4) |

## Acceptance results

| Case | Result | Evidence |
| --- | --- | --- |
| Draft integrity and packaging | Pass | The three Draft assets matched GitHub digests; the tarball passed SHA-256, SRI, manifest, install, 24-file allowlist, and 1,693-record public-only audits. |
| Upgrade and profile composition | Pass | The accepted `0.1.1` source was replaced in place by `0.1.2`; dump-config contained one layer and one plugin row. |
| Desktop startup | Pass | Complete Quit/relaunch reached `rendererStatus: healthy` with `0.1.2`. |
| Desktop UI call | Pass | GPT-5.4 nano invoked `universe_api_search` with every exact argument; tool detail reported 9 `bundled-public` matches and the expected top three. |
| Determinism and filters | Pass | Repeated installed ToolRuntime calls preserved exact IDs/scores; APILayer returned zero, CORS `no`/`unknown` produced 4/20 disjoint results, and both invalid limits were rejected. |
| Offline execution | Pass | The installed artifact completed registration, filtering, and ranking with all process network access denied. |
| External catalog | Pass | A one-record synthetic catalog returned only its APILayer sentinel as `external`; relative, missing, malformed, and oversized inputs all failed closed. |
| Privacy and Recovery | Pass | The `0.1.2` canary path was absent from logs and Recovery detail. Missing-sidecar startup opened Recovery; rollback to the recorded healthy Slot 2 restored bundled-public and healthy state. |
| Ordinary Web profile | Pass | The same tarball loaded in `web`; the UI called the tool with exact arguments and returned the same top three. The process and dependency were removed. |
| Uninstall lifecycle | Pass | Uninstall removed the dependency, node_modules package, and config layer across a full healthy restart. Reinstalling the same tarball restored final healthy state. |

## Final state

- `desktop` is healthy with `dsh-universe-api@0.1.2` installed from the accepted Draft tarball.
- The Desktop user patch is empty and results use `bundled-public`.
- The Web server is stopped and its test dependency is absent.
- The `v0.1.2` GitHub Release is public and non-prerelease with the accepted three asset digests.
- npm `latest` is `0.1.2`; the registry tarball is byte-identical to the accepted Draft and exposes SLSA provenance.
- No P0 or P1 issue was found.

## Promotion result

Workflow run [`33374443735`](https://github.com/Ruixinhua/dsh-universe-api/actions/runs/33374443735) published `0.1.2` through OIDC and recorded provenance, then failed closed because npm's publish-time scanning exceeded the original 60-second availability window. npm made the exact version and `latest` visible after approximately five minutes. Idempotent run [`33374923993`](https://github.com/Ruixinhua/dsh-universe-api/actions/runs/33374923993) skipped re-publication, revalidated the accepted integrity, and published the GitHub Release.

The registry attestation binds `pkg:npm/dsh-universe-api@0.1.2` to `refs/tags/v0.1.2`, `.github/workflows/publish-npm.yml`, and the GitHub-hosted runner. The npm tarball SHA-256 remains `45808bf0937a7784bac3872313d37ec2870f94a80d3ccb675392e4b5dce8f066`.

## Next gate

Wait for catalog-provider synchronization, verify the unique npm identity, and complete DSH Desktop Market installation/removal testing. After OIDC has proven healthy, the maintainer may separately tighten npm Publishing access to disallow bypass-2FA tokens.
