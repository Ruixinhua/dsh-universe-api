# Market distribution and release promotion

This guide is for maintainers publishing `dsh-universe-api` and for users who want to understand why a Market entry may be discoverable before it is one-click installable.

DSH Community Market is source-driven. A user explicitly selects one catalog source, and there is no default or central plugin submission queue. Catalog inclusion is not a security review, compatibility guarantee, or endorsement.

## Distribution levels

| Level | What users receive | Qualification |
| --- | --- | --- |
| GitHub Release | Verified `.tgz` for manual installation | Published release assets and checksum |
| dshfind Discover | Browseable Market entry | Public repository with the `dsh-plugin` topic |
| awesome-dsh-plugin | Curated directory entry and Release tarball link | Directory contribution rules and maintainer review |
| DSH Installable | Confirmed one-click npm installation | One npm identity, stable npm `latest`, and a safe `dsh.bundle.patch` |

The GitHub repository and dshfind entry can therefore exist before npm publication. Until a stable npm version is available, describe the plugin as browseable or manually installable, not as Market-installable. A prerelease selected by npm `latest` does not satisfy the stable-version requirement.

## Release channels

- `vX.Y.Z-rc.N` is a release candidate. GitHub publishes it as a prerelease. If an accepted RC is published to npm, the publish request must use the `next` dist-tag. On the first publication of a new package, the public npm registry may also create `latest` for that RC despite the requested tag; this transitional state is not stable or Market-installable.
- `vX.Y.Z` is stable. The tag workflow creates a Draft GitHub Release. The accepted Draft tarball is later published to npm `latest` through the protected promotion workflow.
- Tags and npm versions are immutable identities. Never move or reuse a release tag after pushing it.

The local package checks infer `next` or `latest` from the exact manifest version. They reject other prerelease shapes, build metadata, unsafe bundle paths, install/publish lifecycle scripts, unexpected tarball files, private catalog state, credential-like URLs, and private user paths.

## Accept a release candidate

1. Run the complete local gate:

   ```bash
   npm ci
   npm run check
   npm pack --dry-run
   ```

2. Push the exact RC tag. CI runs the full operating-system matrix, builds one audited tarball, creates its SHA-256 file, and publishes the GitHub prerelease.
3. Download the Release assets and verify the checksum before installing the tarball in DSH Desktop.
4. Complete every case in the manual test checklist. Do not bootstrap npm ownership until the release tarball passes.

## Bootstrap npm with the accepted RC

The package must exist before npm Trusted Publisher can be configured. This is the only planned interactive npm publication.

1. Sign in to npm with a maintainer account protected by 2FA.
2. Confirm the unscoped name is still available.
3. Download the accepted RC `.tgz` and `.sha256` from the same GitHub Release and verify them.
4. Publish that exact tarball under `next`:

   ```bash
   npm publish ./dsh-universe-api-X.Y.Z-rc.N.tgz \
     --tag next --access public --ignore-scripts \
     --registry=https://registry.npmjs.org/
   npm dist-tag ls dsh-universe-api
   ```

5. Confirm `next` is the accepted RC. If npm automatically created `latest` for the same RC because this was the package's first publication, record that transitional state. Do not unpublish the package or repeatedly try to remove the tag when the registry rejects removal; the protected stable promotion will replace it.

If `dsh-universe-api` becomes owned by another publisher before this step, stop. Do not silently rename or scope the package.

## Configure protected npm promotion

Create the public-repository GitHub environment `npm-production` before promoting a stable version:

- add a required reviewer;
- restrict deployment refs to release tags;
- keep self-review available when there is only one maintainer; and
- prevent bypass when the repository's maintenance model permits it.

Then configure the npm package's Trusted Publisher with these exact values:

| Setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `Ruixinhua` |
| Repository | `dsh-universe-api` |
| Workflow filename | `publish-npm.yml` |
| Environment | `npm-production` |
| Allowed action | `npm publish` |

After confirming OIDC publishing works, configure npm publishing access to require 2FA and disallow traditional write tokens. The workflow intentionally has no `NPM_TOKEN`; GitHub grants only a short-lived OIDC identity after environment approval.

## Promote a stable release

1. Promote only an RC with no unresolved P0 or P1 issue.
2. Change the package and lockfile version to exact stable SemVer, update the changelog and release-facing documentation, and run the complete gate.
3. Push the stable tag. The tag workflow creates three assets in a Draft Release:
   - `dsh-universe-api-X.Y.Z.tgz`;
   - its `.tgz.sha256`; and
   - `catalog-update-report.json`.
4. Download the Draft assets as the maintainer and complete the Desktop checklist against that exact tarball.
5. Run the promotion workflow from the same stable tag:

   ```bash
   gh workflow run publish-npm.yml \
     --repo Ruixinhua/dsh-universe-api \
     --ref vX.Y.Z \
     -f tag=vX.Y.Z
   ```

6. Review the preflight evidence, then approve the `npm-production` job.

The workflow resolves the remote tag to one immutable commit, re-downloads all three assets after approval, compares their combined digest with preflight, and publishes the accepted tarball without rebuilding it. GitHub exposes Draft listings only to push-level callers, so the preflight and approved publish jobs receive ephemeral job-scoped `contents: write` tokens even though their release operations are read-only; no long-lived token is stored. The npm package argument uses an explicit `./dist/...tgz` path so npm cannot interpret it as a hosted Git repository spec. Its monotonic check uses complete SemVer precedence: a stable `X.Y.Z` may replace the same version's automatically created `X.Y.Z-rc.N` `latest`, while any move below a newer prerelease or stable version is rejected. It verifies npm integrity before making the Draft GitHub Release public. A rerun is allowed only when the existing npm bytes and Market identity are identical.

npm publish-time scanning commonly delays registry availability for about five minutes and may take 15 minutes or longer. Registry verification therefore allows a bounded 15-minute propagation window before failing closed; do not republish an accepted version merely because it is still being processed.

## Verify Market eligibility

After npm propagation, verify the registry directly:

```bash
npm view dsh-universe-api \
  name version dist-tags.latest dsh engines repository dist.integrity \
  --json --registry=https://registry.npmjs.org/
```

The result must show the expected stable `latest`, package name, safe patch path, and Release-matching integrity.

dshfind synchronizes repositories and probes installation metadata asynchronously. It does not publish an installation-probe service-level interval, so verify its state directly instead of assuming a deadline:

```bash
curl -fsSL https://api.dshfind.com/market/manifest.json | jq
curl -fsSL https://api.dshfind.com/v1/plugins/Ruixinhua/dsh-universe-api | jq '{is_plugin,is_risky,install}'
curl -fsSL 'https://api.dshfind.com/market/v1/plugins?q=dsh-universe-api&limit=10' | jq '.items[] | select(.id == "Ruixinhua/dsh-universe-api")'
```

The ordinary entry must report `is_plugin: true`, no risky classification, npm publication, the exact stable package/version, and one verified `repository_backlink` npm method that requires no build allowance. The Market entry must expose `package.registry: "npm"`, `package.name: "dsh-universe-api"`, and the expected `latestVersion`. Then select dshfind as the DSH Desktop Market source and test Discover, Installable, one-click installation, full Desktop restart, one tool call, and uninstall.

If the official npm evidence is correct but dshfind remains stale after its next normal repository synchronization, open a dshfind issue requesting an installation re-probe. Include both API responses and the npm registry evidence; do not claim a probe SLA that the provider has not published.

## Submit the curated directory entry

The canonical curated directory is [`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin), not another similarly named repository. Submit only after the default branch has at least ten meaningful commits and the referenced Release tarball is available. Add one file named `data/plugins/Ruixinhua__dsh-universe-api.yml` there, regenerate its READMEs, and avoid an unsupported `npm:` field. Use the `tools` category and a factual bilingual description.

```yaml
url: https://github.com/Ruixinhua/dsh-universe-api
name: Ruixinhua/dsh-universe-api
category: tools
tarball: https://github.com/Ruixinhua/dsh-universe-api/releases/download/vX.Y.Z-rc.N/dsh-universe-api-X.Y.Z-rc.N.tgz
description:
  en: Offline, deterministic public API catalog search for DeepSeek Harness, with Chinese and English queries plus exact filters for authentication, HTTPS, CORS, status, source tier, and category.
  zh: 面向 DeepSeek Harness 的离线确定性公共 API 目录检索，支持中英文查询，以及认证、HTTPS、CORS、状态、来源层级与分类的精确筛选。
```

In the directory checkout, run:

```bash
npm ci
node scripts/generate-readme.mjs
node scripts/generate-readme.mjs --check
npx awesome-lint
SKIP_PUBLISH_CHECKS=1 node scripts/build-site.mjs
```

The pull request should contain only this YAML entry and the two generated READMEs.

After stable promotion, update the directory entry's `tarball` URL from the RC asset to the exact stable Release asset.

## Failure and recovery

- If RC verification fails, fix the issue and publish a new RC number.
- If the first npm publication under `next` also creates `latest` for that RC and npm refuses to remove it, keep the immutable package in place. It remains ineligible for one-click Market installation until the accepted stable release replaces `latest`.
- If stable Draft verification fails, leave it unpublished and use a new version after fixing the defect; do not move the tag.
- If npm succeeds but GitHub finalization fails, rerun the same promotion workflow. It accepts only the identical registry integrity and Release asset set.
- If a published npm version is defective, publish a higher patch and deprecate the affected version. npm package bytes cannot be replaced.
- If dshfind or a curated directory is stale, correct the source metadata; never work around it by weakening package identity checks.

## References

- [DSH Community Market behavior](https://github.com/anywhere-labs/dsh-desktop/blob/v2.0.3/dsh-community-market/README.md)
- [DSH catalog provider contract](https://github.com/anywhere-labs/dsh-desktop/blob/v2.0.3/dsh-community-market/docs/catalog-provider-contract.md)
- [awesome-dsh-plugin contribution rules](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)
- [dshfind submission and synchronization](https://github.com/hikariming/dshfind/blob/main/README.md)
- [npm dist-tag guidance](https://docs.npmjs.com/adding-dist-tags-to-packages/)
- [npm CLI record of public-registry first-publication `latest` behavior](https://github.com/npm/cli/issues/6408)
- [npm publish-time scanning and availability delay](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/)
- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
