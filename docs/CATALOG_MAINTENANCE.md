# Catalog maintenance

The bundled catalog is updated only by an explicit maintainer action. Normal plugin startup and search never fetch remote data.

## Pinned source

The current bundled snapshot uses [public-apis/public-apis](https://github.com/public-apis/public-apis) commit:

```text
988c57be4616cc9507fd3e8c34adedba5387f079
```

At that revision, the synchronization pass reads 1,706 source rows, retains 1,701 policy-compliant public rows, and emits 1,693 canonical records after normalization and de-duplication.

Repository data artifacts include the canonical catalog, curated query aliases, source policy, and a machine-readable update report. Synchronization atomically replaces the catalog and update report; aliases and policy are reviewed separately. Only the catalog and query aliases are needed by the runtime package. The policy and report remain repository evidence; the report is attached to each GitHub Release.

## Preview an update

Always supply a full upstream commit SHA. Preview before writing:

```bash
python3 maintenance/sync_catalog.py \
  --ref 988c57be4616cc9507fd3e8c34adedba5387f079 \
  --dry-run
```

The dry run may download the pinned upstream source, but it must not change generated files. Review record counts, exclusions, duplicate handling, source URLs, and any schema-policy changes in its report.

## Write an accepted update

After reviewing the preview, explicitly write the new snapshot:

```bash
python3 maintenance/sync_catalog.py \
  --ref 988c57be4616cc9507fd3e8c34adedba5387f079 \
  --write
```

The synchronizer must validate temporary output before atomically replacing generated artifacts. An interrupted or invalid update must leave the last accepted snapshot intact.

Then run:

```bash
python3 maintenance/validate_catalog.py
npm run check
npm pack --dry-run
```

## Review checklist

Before accepting generated changes, confirm:

- the upstream revision is a full immutable commit SHA;
- the report explains input, exclusion, duplicate, and output counts;
- all bundled records have `public` source tier and allowed provenance;
- IDs are unique and records are in canonical deterministic order;
- enums and timestamps use canonical-v1 values;
- documentation URLs use acceptable HTTP(S) syntax and contain no embedded credentials;
- no record or provenance from the private APILayer catalog tier, private source record, review queue, or synchronization state is present;
- aliases contain no secret or private provider data; and
- the npm tarball contains only the intended runtime snapshot and notices.

Do not repair a generated catalog by manually copying entries from the earlier mixed catalog. Change the public source policy or normalizer, add tests, and regenerate from the pinned public source.

## Update-report expectations

The machine-readable report shipped with a release should identify at least the upstream repository and commit, generation time, source-row count, excluded-row count, canonical-record count, and content identity needed to reproduce or compare the snapshot. Counts alone are not proof of equivalent content; always validate the generated catalog and inspect the package.
