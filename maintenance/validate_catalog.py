#!/usr/bin/env python3
"""Validate every distributable public catalog data file."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any, Mapping, Sequence

from catalog import (
    CatalogError,
    load_json,
    validate_catalog,
    validate_public_data_dir,
    validate_public_only,
    validate_query_aliases,
    validate_source_policy,
)


def default_data_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "data"


def validate_update_report(report: Any, catalog: Mapping[str, Any]) -> list[str]:
    if not isinstance(report, Mapping):
        return ["update_report: root must be an object"]
    errors: list[str] = []
    if report.get("schema_version") != 1:
        errors.append("update_report.schema_version: must equal 1")
    if report.get("catalog_version") != catalog.get("catalog_version"):
        errors.append("update_report.catalog_version: does not match catalog")
    counts = report.get("counts")
    if not isinstance(counts, Mapping):
        errors.append("update_report.counts: must be an object")
    elif counts.get("after") != len(catalog.get("records", [])):
        errors.append("update_report.counts.after: does not match catalog")
    source = report.get("source")
    if not isinstance(source, Mapping):
        errors.append("update_report.source: must be an object")
    else:
        records = catalog.get("records", [])
        first_source = (
            records[0].get("provenance", [{}])[0]
            if isinstance(records, list) and records and isinstance(records[0], Mapping)
            else {}
        )
        for key in ("revision", "content_hash", "source_url"):
            if source.get(key) != first_source.get(key):
                errors.append(f"update_report.source.{key}: does not match catalog")
    return errors


def run_validation(data_dir: Path) -> list[str]:
    errors = validate_public_data_dir(data_dir)
    if errors:
        return errors
    try:
        catalog = load_json(data_dir / "catalog.json")
        aliases = load_json(data_dir / "query_aliases.json")
        policy = load_json(data_dir / "source_policy.json")
        report = load_json(data_dir / "update_report.json")
    except CatalogError as exc:
        return [str(exc)]
    if not isinstance(catalog, Mapping):
        return ["catalog: root must be an object"]
    errors.extend(validate_catalog(catalog))
    errors.extend(validate_public_only(catalog))
    errors.extend(validate_query_aliases(aliases))
    errors.extend(validate_source_policy(policy))
    errors.extend(validate_update_report(report, catalog))
    return errors


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate canonical schema v1 and public-only distribution policy."
    )
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    errors = run_validation(arguments.data_dir.resolve())
    output = {
        "status": "failed" if errors else "ok",
        "errors": errors,
        "data_dir": str(arguments.data_dir.resolve()),
    }
    print(json.dumps(output, ensure_ascii=False, sort_keys=True, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
