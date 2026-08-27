#!/usr/bin/env python3
"""Canonical public API catalog helpers.

This module deliberately uses only the Python standard library.  It contains
the parser, normalizer, deterministic merger, schema validator, and atomic JSON
writer shared by the maintenance commands.  Runtime catalog search does not
import Python or contact any upstream service.
"""

from __future__ import annotations

import copy
import hashlib
import html
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
import unicodedata
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import parse_qsl, urlsplit, urlunsplit


SCHEMA_VERSION = 1
SOURCE_ID = "public-apis-readme"
SOURCE_REPOSITORY = "https://github.com/public-apis/public-apis"
SOURCE_RAW_TEMPLATE = (
    "https://raw.githubusercontent.com/public-apis/public-apis/{revision}/README.md"
)
SOURCE_LICENSE = "MIT"
SOURCE_LICENSE_URL = (
    "https://github.com/public-apis/public-apis/blob/master/LICENSE"
)

TRI_STATES = frozenset({"yes", "no", "unknown"})
STATUSES = frozenset(
    {"active", "coming_soon", "stale", "candidate", "unknown"}
)
AUTH_TYPES = frozenset(
    {
        "none",
        "api_key",
        "oauth2",
        "basic",
        "bearer",
        "signed",
        "user_agent",
        "other",
        "unknown",
    }
)
AUTH_LOCATIONS = frozenset({"header", "query", "cookie", "unknown"})
SENSITIVE_QUERY_KEYS = frozenset(
    {
        "api_key",
        "apikey",
        "access_key",
        "auth",
        "bearer",
        "client_secret",
        "credential",
        "googleaccessid",
        "jwt",
        "key",
        "passwd",
        "private_key",
        "refresh_token",
        "secret_key",
        "security_token",
        "sig",
        "subscription_key",
        "token",
        "access_token",
        "secret",
        "password",
        "signature",
        "authorization",
    }
)

CATALOG_KEYS = frozenset(
    {"schema_version", "catalog_version", "generated_at", "records"}
)
RECORD_KEYS = frozenset(
    {
        "id",
        "name",
        "aliases",
        "description",
        "categories",
        "tags",
        "provider",
        "source_tier",
        "docs_url",
        "homepage_url",
        "auth",
        "https",
        "cors",
        "status",
        "openapi",
        "provenance",
        "last_checked_at",
        "quality_flags",
        "rights",
    }
)
AUTH_KEYS = frozenset({"type", "location", "name", "source", "confidence"})
PROVENANCE_KEYS = frozenset(
    {
        "source_id",
        "source_url",
        "revision",
        "retrieved_at",
        "content_hash",
        "license",
    }
)
OPENAPI_KEYS = frozenset(
    {
        "spec_url",
        "specification",
        "specification_version",
        "api_version",
        "title",
        "path_count",
        "operation_count",
        "tags",
        "security_schemes",
    }
)
RIGHTS_KEYS = frozenset(
    {
        "attribution",
        "license",
        "license_url",
        "terms_url",
        "authorization",
        "community_attribution",
        "community_license",
        "repository_visibility",
        "scope",
        "usage_basis",
        "notes",
    }
)
PUBLIC_DATA_FILES = frozenset(
    {
        "catalog.json",
        "query_aliases.json",
        "source_policy.json",
        "update_report.json",
    }
)
FORBIDDEN_DATA_FILES = frozenset(
    {
        "source_records.json",
        "source_state.json",
        "review_queue.json",
        "overrides.json",
    }
)

_RFC3339_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)
_MARKDOWN_LINK_RE = re.compile(
    r"\[([^]]+)\]\((https?://[^\s)]+)(?:\s+[^)]*)?\)"
)


class CatalogError(ValueError):
    """Raised when source or catalog data cannot be handled safely."""


def reject_duplicate_keys(pairs: Sequence[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise CatalogError(f"duplicate JSON object key: {key!r}")
        result[key] = value
    return result


def load_json(path: os.PathLike[str] | str) -> Any:
    try:
        with Path(path).open("r", encoding="utf-8") as stream:
            return json.load(stream, object_pairs_hook=reject_duplicate_keys)
    except CatalogError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CatalogError(f"cannot load {Path(path)}: {exc}") from exc


def canonical_json_bytes(value: Any) -> bytes:
    try:
        text = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            indent=2,
            sort_keys=True,
            separators=(",", ": "),
        )
    except (TypeError, ValueError) as exc:
        raise CatalogError(f"value is not canonical JSON: {exc}") from exc
    return (text + "\n").encode("utf-8")


def sha256_hex(value: bytes | str) -> str:
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def rfc3339_now() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def is_rfc3339(value: Any) -> bool:
    if not isinstance(value, str) or not _RFC3339_RE.fullmatch(value):
        return False
    try:
        datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    except ValueError:
        return False
    return True


def slugify(value: Any) -> str:
    original = str(value)
    normalized = unicodedata.normalize("NFKD", original).casefold()
    pieces: list[str] = []
    pending_separator = False
    for character in normalized:
        if unicodedata.combining(character):
            continue
        if character.isalnum():
            if pending_separator and pieces:
                pieces.append("-")
            pieces.append(character)
            pending_separator = False
        else:
            pending_separator = True
    result = "".join(pieces).strip("-")
    return result or f"item-{sha256_hex(original)[:10]}"


def stable_record_id(provider: str, name: str) -> str:
    provider_slug = slugify(provider) if provider.strip() else "public"
    name_slug = slugify(name)
    return name_slug if provider_slug == name_slug else f"{provider_slug}:{name_slug}"


def tri_state(value: Any) -> str:
    if value is True or value == 1:
        return "yes"
    if value is False or value == 0:
        return "no"
    if value is None:
        return "unknown"
    normalized = str(value).strip().casefold()
    if normalized in {
        "yes",
        "y",
        "true",
        "1",
        "supported",
        "available",
        "enabled",
        "✓",
        "✔",
    }:
        return "yes"
    if normalized in {
        "no",
        "n",
        "false",
        "0",
        "unsupported",
        "unavailable",
        "disabled",
        "✗",
        "✘",
    }:
        return "no"
    return "unknown"


def auth_type(value: Any) -> str:
    raw = str(value or "").strip().strip("`").casefold()
    compact = re.sub(r"[^a-z0-9]+", "", raw)
    if compact in {"", "no", "none", "n", "null", "false", "notrequired"}:
        return "none"
    if compact in {"apikey", "key", "xapikey", "xmashapekey", "rapidapikey"}:
        return "api_key"
    if "oauth" in compact:
        return "oauth2"
    if compact in {"basic", "basicauth", "httpbasic"}:
        return "basic"
    if compact in {"bearer", "bearertoken", "jwt", "token"}:
        return "bearer"
    if compact in {"signed", "signature", "hmac", "aws4", "aws4hmacsha256"}:
        return "signed"
    if compact in {"useragent", "useragentheader"}:
        return "user_agent"
    if compact in {"unknown", "?", "tbd"}:
        return "unknown"
    return "other"


def normalize_auth(value: Any, *, source: str = "public-apis") -> list[dict[str, Any]]:
    raw = str(value or "").strip().strip("`")
    kind = auth_type(value)
    location = "unknown"
    name = ""
    if kind == "api_key" and re.search(r"[-_]", raw):
        location = "header"
        name = raw
    elif kind in {"basic", "bearer", "user_agent"}:
        location = "header"
    elif "query" in raw.casefold():
        location = "query"
    return [
        {
            "type": kind,
            "location": location,
            "name": name,
            "source": source,
            "confidence": 0.5 if kind == "unknown" else 1.0,
        }
    ]


def normalized_query_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().casefold()).strip("_")


def is_sensitive_query_key(value: str) -> bool:
    return value in SENSITIVE_QUERY_KEYS or value.endswith(
        (
            "_api_key",
            "_credential",
            "_secret",
            "_signature",
            "_subscription_key",
            "_token",
        )
    )


def url_problem(value: Any, *, https_only: bool = False) -> str | None:
    if not isinstance(value, str) or not value or any(c.isspace() for c in value):
        return "must be a non-empty absolute URL without whitespace"
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError:
        return "has an invalid host or port"
    if parts.scheme.casefold() not in {"http", "https"} or not parts.hostname:
        return "must be an absolute HTTP(S) URL"
    if https_only and parts.scheme.casefold() != "https":
        return "must use HTTPS"
    if parts.username is not None or parts.password is not None:
        return "must not contain URL userinfo or credentials"
    if https_only and port not in (None, 443):
        return "must not use a non-443 port"
    sensitive = sorted(
        {
            normalized_query_key(key)
            for key, _ in parse_qsl(parts.query, keep_blank_values=True)
            if is_sensitive_query_key(normalized_query_key(key))
        }
    )
    if sensitive:
        return f"must not contain sensitive query key(s): {', '.join(sensitive)}"
    return None


def canonical_url(value: Any) -> str:
    raw = html.unescape(str(value or "")).strip().strip("<>")
    if not raw:
        raise CatalogError("URL is empty")
    if raw.startswith("//"):
        raw = "https:" + raw
    elif "://" not in raw:
        first_segment = raw.split("/", 1)[0]
        if "." not in first_segment or raw.startswith(("/", "./", "../")):
            raise CatalogError(f"URL is not absolute: {value!r}")
        raw = "https://" + raw
    try:
        parts = urlsplit(raw)
        hostname = (parts.hostname or "").encode("idna").decode("ascii").casefold()
        port = parts.port
    except (UnicodeError, ValueError) as exc:
        raise CatalogError(f"URL has an invalid host or port: {value!r}") from exc
    if parts.scheme.casefold() not in {"http", "https"} or not hostname:
        raise CatalogError(f"URL is not HTTP(S): {value!r}")
    if parts.username is not None or parts.password is not None:
        raise CatalogError("URL userinfo and credentials are forbidden")
    problem = url_problem(raw)
    if problem and "sensitive query" in problem:
        raise CatalogError(problem)
    scheme = parts.scheme.casefold()
    netloc = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None and not (
        (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    ):
        netloc = f"{netloc}:{port}"
    return urlunsplit((scheme, netloc, parts.path, parts.query, ""))


def split_markdown_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|") and not line.endswith(r"\|"):
        line = line[:-1]
    cells: list[str] = []
    current: list[str] = []
    escaped = False
    in_code = False
    for character in line:
        if escaped:
            current.append(character)
            escaped = False
        elif character == "\\":
            current.append(character)
            escaped = True
        elif character == "`":
            current.append(character)
            in_code = not in_code
        elif character == "|" and not in_code:
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(character)
    cells.append("".join(current).strip())
    while cells and not cells[-1]:
        cells.pop()
    return cells


def markdown_plain_text(value: str) -> str:
    value = re.sub(r"!\[([^]]*)\]\([^)]*\)", r"\1", value)
    value = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", value)
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", "", value)
    value = value.replace("`", "").replace("**", "").replace("__", "")
    value = value.replace(r"\|", "|").replace(r"\_", "_")
    return " ".join(html.unescape(value).split())


def parse_public_apis_readme(markdown: str) -> list[dict[str, str]]:
    """Parse only canonical API tables following the README's ``## Index``."""

    entries: list[dict[str, str]] = []
    in_index = False
    category: str | None = None
    columns: dict[str, int] | None = None
    separator_pending = False
    required = {"api", "description", "auth", "https", "cors"}
    for raw_line in markdown.splitlines():
        heading = re.match(r"^(#{2,6})\s+(.+?)\s*$", raw_line)
        if heading:
            level = len(heading.group(1))
            title = markdown_plain_text(heading.group(2)).strip("# ")
            if level == 2:
                if title.casefold() == "index":
                    in_index = True
                    category = None
                    columns = None
                    separator_pending = False
                    continue
                if in_index:
                    break
            if in_index and level == 3:
                category = title
                columns = None
                separator_pending = False
            continue
        if not in_index or not category:
            continue
        cells = split_markdown_row(raw_line) if "|" in raw_line else []
        normalized = [markdown_plain_text(cell).casefold() for cell in cells]
        if cells and required.issubset(set(normalized)):
            columns = {name: normalized.index(name) for name in required}
            separator_pending = True
            continue
        if columns and separator_pending:
            separator_pending = False
            if cells and all(re.fullmatch(r":?-{3,}:?", cell.strip()) for cell in cells):
                continue
            columns = None
            continue
        if not columns:
            continue
        if not cells or max(columns.values()) >= len(cells):
            columns = None
            continue
        link = _MARKDOWN_LINK_RE.search(cells[columns["api"]])
        if not link:
            continue
        entries.append(
            {
                "name": markdown_plain_text(link.group(1)),
                "url": html.unescape(link.group(2)),
                "description": markdown_plain_text(cells[columns["description"]]),
                "auth": markdown_plain_text(cells[columns["auth"]]),
                "https": markdown_plain_text(cells[columns["https"]]),
                "cors": markdown_plain_text(cells[columns["cors"]]),
                "category": category,
            }
        )
    return entries


def provider_from_url(url: str, fallback: str) -> str:
    host = (urlsplit(url).hostname or "").casefold()
    return re.sub(r"^(?:www\d*|api)\.", "", host) or fallback


def excluded_marketplace_url(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").casefold().rstrip(".")
    if host == "marketplace.apilayer.com":
        return True
    if host not in {"apilayer.com", "www.apilayer.com"}:
        return False
    path = (parts.path or "/").casefold()
    return path == "/marketplace" or path.startswith("/marketplace/")


def casefolded_strings(values: Iterable[Any]) -> list[str]:
    unique: dict[str, str] = {}
    for value in values:
        if not isinstance(value, str) or not value.strip():
            continue
        cleaned = value.strip()
        key = cleaned.casefold()
        current = unique.get(key)
        if current is None or cleaned < current:
            unique[key] = cleaned
    return sorted(unique.values(), key=lambda item: (item.casefold(), item))


def build_public_records(
    entries: Sequence[Mapping[str, Any]],
    *,
    revision: str,
    retrieved_at: str,
    content_hash: str,
) -> list[dict[str, Any]]:
    source_url = SOURCE_RAW_TEMPLATE.format(revision=revision)
    provenance = {
        "source_id": SOURCE_ID,
        "source_url": source_url,
        "revision": revision,
        "retrieved_at": retrieved_at,
        "content_hash": content_hash,
        "license": SOURCE_LICENSE,
    }
    records: list[dict[str, Any]] = []
    for entry in entries:
        name = str(entry.get("name", "")).strip()
        if not name:
            continue
        try:
            url = canonical_url(entry.get("url", ""))
        except CatalogError:
            continue
        if excluded_marketplace_url(url):
            continue
        provider = provider_from_url(url, name)
        category = str(entry.get("category", "")).strip()
        records.append(
            {
                "id": stable_record_id(provider, name),
                "name": name,
                "aliases": [],
                "description": str(entry.get("description", "")).strip(),
                "categories": [category] if category else [],
                "tags": [],
                "provider": provider,
                "source_tier": "public",
                "docs_url": url,
                "homepage_url": url,
                "auth": normalize_auth(entry.get("auth")),
                "https": tri_state(entry.get("https")),
                "cors": tri_state(entry.get("cors")),
                "status": "unknown",
                "openapi": None,
                "provenance": [copy.deepcopy(provenance)],
                "last_checked_at": retrieved_at,
                "quality_flags": ["community_metadata_unverified"],
                "rights": {
                    "license": SOURCE_LICENSE,
                    "attribution": "public-apis/public-apis contributors",
                    "license_url": SOURCE_LICENSE_URL,
                },
            }
        )
    return records


def identity_label(value: str) -> str:
    slug = slugify(value)
    parts = [part for part in slug.split("-") if part not in {"api", "service"}]
    return "-".join(parts) or slug


def record_identity_tokens(record: Mapping[str, Any]) -> set[str]:
    tokens = {"id:" + str(record.get("id", "")).casefold()}
    provider = str(record.get("provider", "")).strip()
    names = [record.get("name", ""), *record.get("aliases", [])]
    if provider:
        for name in names:
            if isinstance(name, str) and name.strip():
                tokens.add(
                    f"provider-name:{identity_label(provider)}:{identity_label(name)}"
                )
    try:
        docs = canonical_url(record.get("docs_url", ""))
    except CatalogError:
        docs = ""
    if docs:
        parts = urlsplit(docs)
        tokens.add(
            "docs:"
            + urlunsplit(
                (parts.scheme, parts.netloc, parts.path or "/", parts.query, "")
            ).casefold()
        )
    return {token for token in tokens if token != "id:"}


def record_priority(record: Mapping[str, Any]) -> tuple[str, bytes]:
    return str(record.get("id", "")), canonical_json_bytes(record)


def meaningful(value: Any) -> bool:
    return value not in (None, "", "unknown", [], {})


def merge_record_group(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    ordered = sorted(records, key=record_priority)
    primary = max(ordered, key=record_priority)
    special = {
        "aliases",
        "categories",
        "tags",
        "quality_flags",
        "provenance",
        "rights",
        "openapi",
        "auth",
        "last_checked_at",
    }
    result: dict[str, Any] = {}
    for record in ordered:
        for key, value in record.items():
            if key in special:
                continue
            if meaningful(value) or key not in result:
                result[key] = copy.deepcopy(value)
    for key in ("id", "name", "provider", "source_tier"):
        if key in primary and meaningful(primary[key]):
            result[key] = copy.deepcopy(primary[key])
    result["aliases"] = [
        item
        for item in casefolded_strings(
            [
                *[record.get("name", "") for record in ordered],
                *[
                    alias
                    for record in ordered
                    for alias in record.get("aliases", [])
                    if isinstance(alias, str)
                ],
            ]
        )
        if item.casefold() != str(primary.get("name", "")).casefold()
    ]
    for key in ("categories", "tags", "quality_flags"):
        result[key] = casefolded_strings(
            item
            for record in ordered
            for item in record.get(key, [])
            if isinstance(item, str)
        )
    provenance: dict[tuple[Any, ...], dict[str, Any]] = {}
    for record in ordered:
        for item in record.get("provenance", []):
            if not isinstance(item, Mapping):
                continue
            identity = (
                item.get("source_id"),
                item.get("source_url"),
                item.get("revision"),
                item.get("content_hash"),
            )
            provenance[identity] = copy.deepcopy(dict(item))
    result["provenance"] = sorted(
        provenance.values(),
        key=lambda item: (
            str(item.get("source_id", "")),
            str(item.get("revision", "")),
            str(item.get("source_url", "")),
            str(item.get("content_hash", "")),
        ),
    )
    result["last_checked_at"] = max(
        str(record.get("last_checked_at", "")) for record in ordered
    )
    selected_auth: list[dict[str, Any]] | None = None
    for record in reversed(ordered):
        candidate = record.get("auth")
        if not isinstance(candidate, list) or not candidate:
            continue
        copied = [copy.deepcopy(dict(item)) for item in candidate if isinstance(item, Mapping)]
        if not copied:
            continue
        if any(item.get("type") != "unknown" for item in copied):
            selected_auth = copied
            break
        if selected_auth is None:
            selected_auth = copied
    result["auth"] = selected_auth or normalize_auth(None)
    result["rights"] = copy.deepcopy(dict(primary.get("rights", {})))
    result["openapi"] = None
    return result


def merge_records(records: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    if not records:
        return []
    parents = list(range(len(records)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parents[max(left_root, right_root)] = min(left_root, right_root)

    owners: dict[str, int] = {}
    for index, record in enumerate(records):
        for token in sorted(record_identity_tokens(record)):
            if token in owners:
                union(index, owners[token])
            else:
                owners[token] = index
    groups: dict[int, list[Mapping[str, Any]]] = {}
    for index, record in enumerate(records):
        groups.setdefault(find(index), []).append(record)
    return sorted(
        (merge_record_group(group) for group in groups.values()),
        key=lambda record: str(record["id"]),
    )


def build_catalog(
    records: Sequence[Mapping[str, Any]],
    *,
    revision: str,
    content_hash: str,
    generated_at: str,
) -> dict[str, Any]:
    sorted_records = sorted(
        (copy.deepcopy(dict(record)) for record in records), key=lambda item: item["id"]
    )
    version_material = {
        "schema_version": SCHEMA_VERSION,
        "source": {
            "source_id": SOURCE_ID,
            "revision": revision,
            "content_hash": content_hash,
        },
        "records": [
            {
                **record,
                "last_checked_at": None,
                "provenance": [
                    {**item, "retrieved_at": None}
                    for item in record.get("provenance", [])
                ],
            }
            for record in sorted_records
        ],
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "catalog_version": f"v1-{sha256_hex(canonical_json_bytes(version_material))[:16]}",
        "generated_at": generated_at,
        "records": sorted_records,
    }


def required_and_extra_keys(
    value: Mapping[str, Any], expected: frozenset[str], path: str
) -> list[str]:
    errors = [
        f"{path}: missing required key {key!r}" for key in sorted(expected - set(value))
    ]
    errors.extend(
        f"{path}.{key}: unexpected field" for key in sorted(set(value) - expected)
    )
    return errors


def validate_string_list(value: Any, path: str) -> list[str]:
    if not isinstance(value, list):
        return [f"{path}: must be an array of strings"]
    errors: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip() or item != item.strip():
            errors.append(f"{path}[{index}]: must be a trimmed non-empty string")
    if all(isinstance(item, str) and item.strip() for item in value):
        if value != casefolded_strings(value):
            errors.append(f"{path}: values must be unique and canonically sorted")
    return errors


def validate_auth(value: Any, path: str) -> list[str]:
    if not isinstance(value, list) or not value:
        return [f"{path}: must be a non-empty array"]
    errors: list[str] = []
    for index, item in enumerate(value):
        item_path = f"{path}[{index}]"
        if not isinstance(item, Mapping):
            errors.append(f"{item_path}: must be an object")
            continue
        errors.extend(required_and_extra_keys(item, AUTH_KEYS, item_path))
        if item.get("type") not in AUTH_TYPES:
            errors.append(f"{item_path}.type: unsupported auth type")
        if item.get("location") not in AUTH_LOCATIONS:
            errors.append(f"{item_path}.location: unsupported auth location")
        for key in ("name", "source"):
            if not isinstance(item.get(key), str):
                errors.append(f"{item_path}.{key}: must be a string")
        confidence = item.get("confidence")
        if (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not math.isfinite(float(confidence))
            or not 0 <= float(confidence) <= 1
        ):
            errors.append(f"{item_path}.confidence: must be between 0 and 1")
    return errors


def validate_openapi(value: Any, path: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, Mapping):
        return [f"{path}: must be an object or null"]
    errors = required_and_extra_keys(value, OPENAPI_KEYS, path)
    if value.get("specification") not in {"openapi", "swagger"}:
        errors.append(f"{path}.specification: must be 'openapi' or 'swagger'")
    for key in ("spec_url",):
        problem = url_problem(value.get(key))
        if problem:
            errors.append(f"{path}.{key}: {problem}")
    for key in ("path_count", "operation_count"):
        count = value.get(key)
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            errors.append(f"{path}.{key}: must be a non-negative integer")
    for key in ("tags", "security_schemes"):
        errors.extend(validate_string_list(value.get(key), f"{path}.{key}"))
    return errors


def validate_provenance(value: Any, path: str) -> list[str]:
    if not isinstance(value, list) or not value:
        return [f"{path}: must be a non-empty array"]
    errors: list[str] = []
    seen: set[tuple[Any, ...]] = set()
    for index, item in enumerate(value):
        item_path = f"{path}[{index}]"
        if not isinstance(item, Mapping):
            errors.append(f"{item_path}: must be an object")
            continue
        errors.extend(required_and_extra_keys(item, PROVENANCE_KEYS, item_path))
        if not isinstance(item.get("source_id"), str) or not item.get("source_id"):
            errors.append(f"{item_path}.source_id: must be a non-empty string")
        problem = url_problem(item.get("source_url"), https_only=True)
        if problem:
            errors.append(f"{item_path}.source_url: {problem}")
        if not isinstance(item.get("revision"), str) or not item.get("revision"):
            errors.append(f"{item_path}.revision: must be a non-empty string")
        if not is_rfc3339(item.get("retrieved_at")):
            errors.append(f"{item_path}.retrieved_at: must be RFC3339")
        if not re.fullmatch(r"[0-9a-f]{64}", str(item.get("content_hash", ""))):
            errors.append(f"{item_path}.content_hash: must be a SHA-256 hex digest")
        if not isinstance(item.get("license"), (str, Mapping)):
            errors.append(f"{item_path}.license: must be a string or object")
        identity = (
            item.get("source_id"),
            item.get("source_url"),
            item.get("revision"),
            item.get("content_hash"),
        )
        if identity in seen:
            errors.append(f"{item_path}: duplicate provenance entry")
        seen.add(identity)
    return errors


def validate_catalog(data: Any) -> list[str]:
    if not isinstance(data, Mapping):
        return ["catalog: root must be an object"]
    errors = required_and_extra_keys(data, CATALOG_KEYS, "catalog")
    if data.get("schema_version") != SCHEMA_VERSION or isinstance(
        data.get("schema_version"), bool
    ):
        errors.append(f"catalog.schema_version: must equal {SCHEMA_VERSION}")
    if not isinstance(data.get("catalog_version"), str) or not re.fullmatch(
        r"v1-[0-9a-f]{16}", str(data.get("catalog_version", ""))
    ):
        errors.append("catalog.catalog_version: must match v1-<16 hex chars>")
    if not is_rfc3339(data.get("generated_at")):
        errors.append("catalog.generated_at: must be RFC3339")
    records = data.get("records")
    if not isinstance(records, list):
        errors.append("catalog.records: must be an array")
        return errors
    ids: list[str] = []
    identities: dict[str, int] = {}
    for index, record in enumerate(records):
        path = f"records[{index}]"
        if not isinstance(record, Mapping):
            errors.append(f"{path}: must be an object")
            continue
        errors.extend(required_and_extra_keys(record, RECORD_KEYS, path))
        for key in ("id", "name", "provider"):
            if not isinstance(record.get(key), str) or not str(record.get(key)).strip():
                errors.append(f"{path}.{key}: must be a non-empty string")
        if not isinstance(record.get("description"), str):
            errors.append(f"{path}.description: must be a string")
        for key in ("aliases", "categories", "tags", "quality_flags"):
            errors.extend(validate_string_list(record.get(key), f"{path}.{key}"))
        if record.get("source_tier") not in {"public", "apilayer"}:
            errors.append(f"{path}.source_tier: unsupported source tier")
        for key in ("docs_url", "homepage_url"):
            problem = url_problem(record.get(key))
            if problem:
                errors.append(f"{path}.{key}: {problem}")
        for key in ("https", "cors"):
            if record.get(key) not in TRI_STATES:
                errors.append(f"{path}.{key}: unsupported tri-state value")
        if record.get("status") not in STATUSES:
            errors.append(f"{path}.status: unsupported status")
        errors.extend(validate_auth(record.get("auth"), f"{path}.auth"))
        errors.extend(validate_openapi(record.get("openapi"), f"{path}.openapi"))
        errors.extend(validate_provenance(record.get("provenance"), f"{path}.provenance"))
        if record.get("last_checked_at") is not None and not is_rfc3339(
            record.get("last_checked_at")
        ):
            errors.append(f"{path}.last_checked_at: must be RFC3339 or null")
        rights = record.get("rights")
        if not isinstance(rights, Mapping):
            errors.append(f"{path}.rights: must be an object")
        else:
            for key in sorted(set(rights) - RIGHTS_KEYS):
                errors.append(f"{path}.rights: unexpected key {key!r}")
            for key, value in rights.items():
                if value is not None and not isinstance(value, str):
                    errors.append(f"{path}.rights.{key}: must be a string or null")
                    continue
                if isinstance(value, str) and len(value) > 4_096:
                    errors.append(
                        f"{path}.rights.{key}: must contain no more than 4096 characters"
                    )
                if key in {"license_url", "terms_url"} and value is not None:
                    problem = url_problem(value)
                    if problem:
                        errors.append(f"{path}.rights.{key}: {problem}")
        record_id = record.get("id")
        if isinstance(record_id, str):
            ids.append(record_id)
        for identity in sorted(record_identity_tokens(record)):
            owner = identities.get(identity)
            if owner is not None and owner != index and not identity.startswith("id:"):
                errors.append(
                    f"{path}.id: duplicate identity with records[{owner}] ({identity})"
                )
            else:
                identities[identity] = index
    if len(ids) == len(records):
        if ids != sorted(ids):
            errors.append("catalog.records: records must be sorted by id")
        seen: set[str] = set()
        for index, record_id in enumerate(ids):
            if record_id in seen:
                errors.append(f"records[{index}].id: duplicate id {record_id!r}")
            seen.add(record_id)
    return errors


def validate_source_policy(data: Any) -> list[str]:
    if not isinstance(data, Mapping):
        return ["source_policy: root must be an object"]
    errors: list[str] = []
    if data.get("policy_version") != 1:
        errors.append("source_policy.policy_version: must equal 1")
    if data.get("public_only") is not True:
        errors.append("source_policy.public_only: must equal true")
    source = data.get("source")
    if not isinstance(source, Mapping):
        return [*errors, "source_policy.source: must be an object"]
    expected = {
        "source_id": SOURCE_ID,
        "repository": SOURCE_REPOSITORY,
        "raw_url_template": SOURCE_RAW_TEMPLATE,
        "license": SOURCE_LICENSE,
        "license_url": SOURCE_LICENSE_URL,
    }
    for key, expected_value in expected.items():
        if source.get(key) != expected_value:
            errors.append(
                f"source_policy.source.{key}: must equal {expected_value!r}"
            )
    return errors


def validate_query_aliases(data: Any) -> list[str]:
    if not isinstance(data, Mapping):
        return ["query_aliases: root must be an object"]
    errors: list[str] = []
    if data.get("version") != 1:
        errors.append("query_aliases.version: must equal 1")
    aliases = data.get("aliases")
    if not isinstance(aliases, Mapping) or not aliases:
        return [*errors, "query_aliases.aliases: must be a non-empty object"]
    keys = list(aliases)
    if keys != sorted(keys, key=lambda item: (str(item).casefold(), str(item))):
        errors.append("query_aliases.aliases: keys must be canonically sorted")
    for key, values in aliases.items():
        if not isinstance(key, str) or not key.strip() or key != key.strip():
            errors.append(f"query_aliases.aliases[{key!r}]: key must be trimmed")
        errors.extend(validate_string_list(values, f"query_aliases.aliases[{key!r}]"))
    return errors


def validate_public_only(catalog: Mapping[str, Any]) -> list[str]:
    """Enforce that distributable data contains public-apis metadata only."""

    errors: list[str] = []
    revisions: set[str] = set()
    content_hashes: set[str] = set()
    retrieved_at_values: set[str] = set()
    for index, record in enumerate(catalog.get("records", [])):
        if not isinstance(record, Mapping):
            continue
        path = f"records[{index}]"
        if record.get("source_tier") != "public":
            errors.append(f"{path}.source_tier: public package permits only 'public'")
        if record.get("openapi") is not None:
            errors.append(f"{path}.openapi: public snapshot must not contain enrichment")
        rights = record.get("rights")
        expected_rights = {
            "license": SOURCE_LICENSE,
            "attribution": "public-apis/public-apis contributors",
            "license_url": SOURCE_LICENSE_URL,
        }
        if rights != expected_rights:
            errors.append(f"{path}.rights: must contain only public-apis MIT metadata")
        for auth_index, auth in enumerate(record.get("auth", [])):
            if isinstance(auth, Mapping) and auth.get("source") != "public-apis":
                errors.append(
                    f"{path}.auth[{auth_index}].source: must equal 'public-apis'"
                )
        for source_index, source in enumerate(record.get("provenance", [])):
            source_path = f"{path}.provenance[{source_index}]"
            if not isinstance(source, Mapping):
                continue
            if source.get("source_id") != SOURCE_ID:
                errors.append(f"{source_path}.source_id: non-public provenance forbidden")
            revision = str(source.get("revision", ""))
            revisions.add(revision)
            content_hashes.add(str(source.get("content_hash", "")))
            retrieved_at_values.add(str(source.get("retrieved_at", "")))
            expected_url = SOURCE_RAW_TEMPLATE.format(revision=revision)
            if not re.fullmatch(r"[0-9a-f]{40}", revision):
                errors.append(f"{source_path}.revision: must be a full Git commit")
            if source.get("source_url") != expected_url:
                errors.append(f"{source_path}.source_url: must be pinned to revision")
            if source.get("license") != SOURCE_LICENSE:
                errors.append(f"{source_path}.license: must equal MIT")
            if record.get("last_checked_at") != source.get("retrieved_at"):
                errors.append(
                    f"{path}.last_checked_at: must match public provenance retrieval time"
                )
    if len(revisions) > 1:
        errors.append("catalog: public records must share one pinned source revision")
    if len(content_hashes) > 1:
        errors.append("catalog: public records must share one source content hash")
    if len(retrieved_at_values) > 1:
        errors.append("catalog: public records must share one retrieval time")
    if retrieved_at_values and catalog.get("generated_at") not in retrieved_at_values:
        errors.append("catalog.generated_at: must match the public snapshot retrieval time")
    return errors


def validate_public_data_dir(data_dir: os.PathLike[str] | str) -> list[str]:
    root = Path(data_dir)
    if not root.is_dir():
        return [f"data directory does not exist: {root}"]
    entries = {path.name for path in root.iterdir() if not path.name.startswith(".")}
    errors = [
        f"data/{name}: forbidden private synchronization artifact"
        for name in sorted(entries & FORBIDDEN_DATA_FILES)
    ]
    errors.extend(
        f"data/{name}: unexpected distributable data file"
        for name in sorted(entries - PUBLIC_DATA_FILES - FORBIDDEN_DATA_FILES)
    )
    errors.extend(
        f"data/{name}: required public data file is missing"
        for name in sorted(PUBLIC_DATA_FILES - entries)
    )
    return errors


def stage_json(path: Path, value: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(canonical_json_bytes(value))
            stream.flush()
            os.fsync(stream.fileno())
        if path.exists():
            os.chmod(temporary_path, path.stat().st_mode & 0o777)
        else:
            os.chmod(temporary_path, 0o644)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise
    return temporary_path


def atomic_write_bundle(payloads: Sequence[tuple[Path, Any]]) -> None:
    """Replace a JSON bundle atomically per file and restore all on failure."""

    staged: dict[Path, Path] = {}
    backups: dict[Path, Path | None] = {}
    replaced: list[Path] = []
    try:
        for path, value in payloads:
            staged[path] = stage_json(path, value)
            if path.exists():
                descriptor, backup_name = tempfile.mkstemp(
                    prefix=f".{path.name}.", suffix=".last-good", dir=path.parent
                )
                os.close(descriptor)
                backup = Path(backup_name)
                shutil.copy2(path, backup)
                backups[path] = backup
            else:
                backups[path] = None
        for path, _ in payloads:
            os.replace(staged[path], path)
            replaced.append(path)
        for parent in {path.parent for path, _ in payloads}:
            try:
                descriptor = os.open(parent, os.O_RDONLY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
            except OSError:
                pass
    except BaseException as exc:
        restore_errors: list[str] = []
        for path in reversed(replaced):
            backup = backups.get(path)
            try:
                if backup is None:
                    path.unlink(missing_ok=True)
                elif backup.exists():
                    os.replace(backup, path)
            except OSError as restore_error:
                restore_errors.append(f"{path.name}: {restore_error}")
        detail = "; ".join(restore_errors)
        suffix = f"; rollback incomplete: {detail}" if detail else ""
        raise CatalogError(f"catalog transaction failed{suffix}") from exc
    finally:
        for path in [
            *staged.values(),
            *[backup for backup in backups.values() if backup is not None],
        ]:
            path.unlink(missing_ok=True)


__all__ = [
    "CatalogError",
    "PUBLIC_DATA_FILES",
    "SCHEMA_VERSION",
    "SOURCE_ID",
    "SOURCE_LICENSE",
    "SOURCE_LICENSE_URL",
    "SOURCE_RAW_TEMPLATE",
    "SOURCE_REPOSITORY",
    "atomic_write_bundle",
    "build_catalog",
    "build_public_records",
    "canonical_json_bytes",
    "load_json",
    "merge_records",
    "parse_public_apis_readme",
    "rfc3339_now",
    "sha256_hex",
    "validate_catalog",
    "validate_public_data_dir",
    "validate_public_only",
    "validate_query_aliases",
    "validate_source_policy",
]
