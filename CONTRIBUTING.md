# Contributing

Thank you for helping improve `dsh-universe-api`. Contributions should preserve the project's small, auditable contract: one offline search tool, deterministic output, and no credential handling or candidate API execution.

## Set up

Use Node.js `22.19.0` or a current Node.js version `>=24`, plus npm. CI exercises both Node.js 22.19 and 24. Python 3 is needed only for maintainer catalog synchronization, not at plugin runtime.

```bash
npm ci
npm run check
```

No build step is required. Do not add a `prepare` hook: GitHub installs must remain free of pnpm `allowBuilds` permission.

## Make a change

1. Open an issue for behavior or interface changes so the user-facing contract can be agreed first.
2. Keep runtime code pure ESM and avoid third-party runtime dependencies unless they are essential.
3. Add or update tests for observable behavior. Search ranking changes need English and Chinese golden-query coverage.
4. Update both READMEs when installation, configuration, input fields, output fields, or limitations change.
5. Run the complete gate and inspect the package before submitting a pull request.

```bash
npm ci
npm run typecheck
npm test
npm run check
npm pack --dry-run
```

The final package must not contain private source records, APILayer provenance, review queues, synchronization state, credentials, or URLs with embedded credentials.

## Catalog changes

Catalog updates are explicit maintainer operations. Always pin an upstream commit, run a dry run first, review the report, then write and validate the snapshot. Do not manually copy records from a mixed or privately licensed catalog.

See [Catalog maintenance](docs/CATALOG_MAINTENANCE.md) for the commands, invariants, and review checklist.

## Pull requests

Keep a pull request focused. In its description, state:

- the behavior that changed;
- the tests and exact commands run;
- whether the tool interface or catalog schema changed;
- whether packaged files changed; and
- any data-source or licensing implications.

By contributing, you agree that your contribution is licensed under this repository's MIT License. Do not submit data or code that you are not authorized to redistribute.
