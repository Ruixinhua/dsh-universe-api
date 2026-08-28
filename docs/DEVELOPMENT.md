# Development and architecture

This guide is for contributors who need to change the plugin without weakening its offline, read-only guarantees. An end user should start with the root README instead.

## Runtime contract

The bundle activates one plugin row and injects only DSH's `tools` service. It registers exactly one tool, `universe_api_search`. There is no Desktop-only service dependency, so the same implementation runs in CLI, Web profiles, and DSH Desktop.

At each Cordis generation, startup performs these steps once:

1. Resolve either the bundled public snapshot or the configured absolute `catalogPath`.
2. Check the selected file, parse JSON, and validate canonical catalog schema v1.
3. Normalize and index the validated records in memory.
4. Register an immutable, concurrency-safe search tool over that index.

A configured external catalog is authoritative. Startup errors are surfaced instead of falling back to bundled data.

At each tool call, the implementation validates arguments, applies every requested hard filter, expands and normalizes the query, scores remaining records, applies deterministic tie-breakers, and renders the structured result. No part of this flow needs network access.

## Public tool interface

Input fields:

```text
query?: string
categories?: string[]                 # OR within the array
sourceTier?: all | public | apilayer # default: all
auth?: none | api_key | oauth2 | basic | bearer | signed |
       user_agent | other | unknown
https?: yes | no | unknown
cors?: yes | no | unknown
status?: active | coming_soon | stale | candidate | unknown
limit?: integer                       # 1..20, default: 5
```

The structured output is:

```text
catalog: { version, generatedAt, recordCount, source }
query: { original, expanded, matchedAliases }
filters: { categories, sourceTier, auth, https, cors, status, limit }
totalMatches
truncated
results[]:
  id, name, description, provider, categories, tags, docsUrl,
  authTypes, https, cors, status, sourceTier, score, matchReasons,
  freshness: { state, latestFetchedAt, ageDaysAtCatalogGeneration, sourceCount },
  openapi?
```

`catalog.source` is only `bundled-public` or `external`; it must never contain a filesystem path. `unknown` is a first-class exact value, not an alias for `no`. A zero-result query remains zero-result; filters are never silently discarded.

## Development setup

Use Node.js `22.19.0` for compatibility testing or a current Node.js version `>=24`; CI exercises both Node.js 22.19 and 24. Install the exact lockfile graph:

```bash
npm ci
```

The runtime is plain ESM JavaScript. TypeScript checks JavaScript through the project configuration, but no transpilation or bundling is required.

Run the focused checks while developing:

```bash
npm run typecheck
npm test
npm run verify:loader
npm run catalog:validate
npm run verify:package
```

`verify:loader` creates the final npm tarball, installs it into a temporary DSH profile, activates it through the published DSH profile/Loader path, and executes `universe_api_search`. Installation prefers npm's cache but may fetch missing registry metadata; the activated tool itself remains offline. This catches missing packed files, broken bundle patches, profile-local resolution failures, and activation errors that a direct `apply(ctx)` test cannot see.

Before handing off a change, run the same aggregate gate used by CI and inspect npm's package file list:

```bash
npm run check
npm pack --dry-run
```

Tests should cover behavior rather than internal helper shape. Ranking changes require deterministic English and Chinese golden queries. Validator changes require fixtures for malformed input, duplicate IDs, invalid enums, sorting, credential-bearing URLs, and the 16 MiB external-file limit.

## Design invariants

- Runtime search is offline. Network access belongs only to the explicit maintainer synchronization command.
- The tool discovers APIs but never invokes them and never accepts credentials.
- The bundled catalog is public-only. Do not derive it by subtracting private records from a mixed catalog.
- Filtering happens before ranking and is never relaxed.
- Identical catalog, configuration, and arguments produce identical result order and scores.
- Catalog data is loaded and indexed once per generation, not once per call.
- External catalog failures stop plugin activation and do not disclose the configured path through tool output.
- GitHub installation remains build-free: do not add `prepare` or generated runtime output that is absent from the repository.

## Packaging and release

The release workflow is triggered only by a pushed `v*` tag. It checks that the tag without its leading `v` exactly equals the package version, runs the full gate, creates the npm tarball without publishing it, produces a SHA-256 file, and attaches the tarball, checksum, and catalog update report to a GitHub Release.

For a release candidate:

1. Finish and review the explicit catalog update, if one is intended.
2. Set the package and changelog version to the same SemVer value.
3. Run `npm ci`, `npm run verify:loader`, `npm run check`, and `npm pack --dry-run` from a clean checkout.
4. Push the matching tag, such as `v0.1.0-rc.2`.
5. Download the resulting release assets and verify the checksum.
6. Install that tarball in DSH Desktop and complete the manual checklist.
7. Promote only after the release artifact passes; do not substitute local-checkout results.

The project intentionally does not publish to npm for v1.
