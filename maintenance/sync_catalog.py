#!/usr/bin/env python3
"""Refresh the bundled catalog from one pinned public-apis README revision."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from catalog import (
    CatalogError,
    SCHEMA_VERSION,
    SOURCE_ID,
    SOURCE_LICENSE,
    SOURCE_LICENSE_URL,
    SOURCE_RAW_TEMPLATE,
    SOURCE_REPOSITORY,
    atomic_write_bundle,
    build_catalog,
    build_public_records,
    load_json,
    merge_records,
    parse_public_apis_readme,
    rfc3339_now,
    sha256_hex,
    validate_catalog,
    validate_public_only,
)


DEFAULT_REF = "988c57be4616cc9507fd3e8c34adedba5387f079"
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
HTTP_TIMEOUT_SECONDS = 30
USER_AGENT = "dsh-universe-api-maintainer/0.1"


def resolve_ref(ref: str) -> str:
    ref = str(ref).strip()
    if re.fullmatch(r"[0-9a-fA-F]{40}", ref):
        return ref.casefold()
    if (
        not ref
        or not re.fullmatch(r"[A-Za-z0-9._/-]+", ref)
        or ref.startswith(("-", "/"))
        or ".." in ref
        or "@{" in ref
    ):
        raise CatalogError(f"unsafe or invalid public-apis ref: {ref!r}")
    patterns = [f"refs/heads/{ref}", f"refs/tags/{ref}", f"refs/tags/{ref}^{{}}"]
    try:
        result = subprocess.run(
            ["git", "ls-remote", SOURCE_REPOSITORY + ".git", *patterns],
            check=True,
            capture_output=True,
            text=True,
            timeout=HTTP_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise CatalogError(f"failed to resolve public-apis ref {ref!r}: {exc}") from exc
    candidates: list[tuple[int, str]] = []
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) != 2 or not re.fullmatch(r"[0-9a-fA-F]{40}", fields[0]):
            continue
        priority = 2 if fields[1] == f"refs/heads/{ref}" else 0 if fields[1].endswith("^{}") else 1
        candidates.append((priority, fields[0].casefold()))
    if not candidates:
        raise CatalogError(f"public-apis ref does not exist: {ref!r}")
    return sorted(candidates, key=lambda item: (-item[0], item[1]))[0][1]


def fetch_readme(revision: str) -> bytes:
    url = SOURCE_RAW_TEMPLATE.format(revision=revision)
    request = Request(
        url,
        headers={"Accept": "text/plain", "User-Agent": USER_AGENT},
        method="GET",
    )
    try:
        with urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            final_url = response.geturl()
            if final_url != url:
                raise CatalogError(f"unexpected source redirect: {final_url}")
            announced = response.headers.get("Content-Length")
            if announced and int(announced) > MAX_RESPONSE_BYTES:
                raise CatalogError("public-apis README exceeds 16 MiB")
            payload = response.read(MAX_RESPONSE_BYTES + 1)
    except (HTTPError, URLError, OSError, ValueError) as exc:
        raise CatalogError(f"failed to fetch public-apis README: {exc}") from exc
    if len(payload) > MAX_RESPONSE_BYTES:
        raise CatalogError("public-apis README exceeds 16 MiB")
    return payload


def read_source_file(path: Path) -> bytes:
    try:
        size = path.stat().st_size
        if size > MAX_RESPONSE_BYTES:
            raise CatalogError("source fixture exceeds 16 MiB")
        return path.read_bytes()
    except OSError as exc:
        raise CatalogError(f"cannot read source file {path}: {exc}") from exc


def previous_timestamp(
    existing: Mapping[str, Any] | None, revision: str, content_hash: str
) -> str | None:
    if not isinstance(existing, Mapping):
        return None
    records = existing.get("records")
    if not isinstance(records, list) or not records:
        return None
    first = records[0]
    if not isinstance(first, Mapping):
        return None
    provenance = first.get("provenance")
    if not isinstance(provenance, list) or not provenance:
        return None
    source = provenance[0]
    if not isinstance(source, Mapping):
        return None
    if source.get("revision") != revision or source.get("content_hash") != content_hash:
        return None
    generated_at = existing.get("generated_at")
    return generated_at if isinstance(generated_at, str) else None


def record_diff(old: Mapping[str, Any], new: Mapping[str, Any]) -> dict[str, list[str]]:
    old_records = {
        str(record.get("id")): record
        for record in old.get("records", [])
        if isinstance(record, Mapping)
    }
    new_records = {
        str(record.get("id")): record
        for record in new.get("records", [])
        if isinstance(record, Mapping)
    }
    return {
        "added": sorted(new_records.keys() - old_records.keys()),
        "changed": sorted(
            key
            for key in old_records.keys() & new_records.keys()
            if old_records[key] != new_records[key]
        ),
        "removed": sorted(old_records.keys() - new_records.keys()),
    }


def synchronize(
    *,
    data_dir: Path,
    ref: str,
    dry_run: bool,
    source_file: Path | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    revision = resolve_ref(ref)
    payload = read_source_file(source_file) if source_file else fetch_readme(revision)
    try:
        markdown = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise CatalogError("public-apis README is not valid UTF-8") from exc
    entries = parse_public_apis_readme(markdown)
    if not entries:
        raise CatalogError("public-apis README contained no category API rows")

    catalog_path = data_dir / "catalog.json"
    report_path = data_dir / "update_report.json"
    if catalog_path.exists():
        loaded = load_json(catalog_path)
        if not isinstance(loaded, Mapping):
            raise CatalogError("existing catalog root must be an object")
        old_catalog: Mapping[str, Any] = loaded
    else:
        old_catalog = {
            "schema_version": SCHEMA_VERSION,
            "catalog_version": "empty",
            "generated_at": None,
            "records": [],
        }

    run_at = rfc3339_now()
    content_hash = sha256_hex(payload)
    generated_at = previous_timestamp(old_catalog, revision, content_hash) or run_at
    normalized = build_public_records(
        entries,
        revision=revision,
        retrieved_at=generated_at,
        content_hash=content_hash,
    )
    records = merge_records(normalized)
    catalog = build_catalog(
        records,
        revision=revision,
        content_hash=content_hash,
        generated_at=generated_at,
    )
    errors = [*validate_catalog(catalog), *validate_public_only(catalog)]
    if errors:
        raise CatalogError("candidate catalog failed validation: " + "; ".join(errors))

    report = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": run_at,
        "status": "dry_run" if dry_run else "updated",
        "catalog_version": catalog["catalog_version"],
        "source": {
            "source_id": SOURCE_ID,
            "repository": SOURCE_REPOSITORY,
            "revision": revision,
            "source_url": SOURCE_RAW_TEMPLATE.format(revision=revision),
            "content_hash": content_hash,
            "license": SOURCE_LICENSE,
            "license_url": SOURCE_LICENSE_URL,
            "retrieved_at": generated_at,
        },
        "changes": record_diff(old_catalog, catalog),
        "counts": {
            "before": len(old_catalog.get("records", [])),
            "parsed": len(entries),
            "normalized": len(normalized),
            "after": len(records),
        },
        "warnings": [],
    }
    if not dry_run:
        atomic_write_bundle([(catalog_path, catalog), (report_path, report)])
    return catalog, report


def default_data_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "data"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Build a public-only canonical catalog from a pinned "
            "public-apis/public-apis README commit."
        )
    )
    parser.add_argument(
        "--ref",
        default=DEFAULT_REF,
        help=f"branch, tag, or full commit (default: {DEFAULT_REF})",
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="fetch, build, and validate without changing files",
    )
    mode.add_argument(
        "--write",
        action="store_true",
        help="atomically replace catalog.json and update_report.json",
    )
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    parser.add_argument(
        "--source-file",
        type=Path,
        help="read a local README fixture instead of the network (tests/recovery)",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        _, report = synchronize(
            data_dir=arguments.data_dir.resolve(),
            ref=arguments.ref,
            dry_run=not arguments.write,
            source_file=arguments.source_file.resolve() if arguments.source_file else None,
        )
    except CatalogError as exc:
        print(
            json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False),
            file=sys.stderr,
        )
        return 1
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
