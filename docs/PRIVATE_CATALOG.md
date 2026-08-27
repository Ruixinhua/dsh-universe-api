# Private catalog format

`catalogPath` accepts one complete canonical catalog v1 JSON document. The selected file replaces the bundled public snapshot; it is not an overlay.

The file must be a regular UTF-8 JSON file at an absolute path and no larger than 16 MiB. Records must pass all validation before the plugin registers its tool.

## Minimal valid example

This synthetic one-record catalog is suitable for the private-catalog acceptance test:

```json
{
  "schema_version": 1,
  "catalog_version": "private-test-1",
  "generated_at": "2026-08-27T00:00:00Z",
  "records": [
    {
      "id": "private-synthetic-weather",
      "name": "Synthetic Weather",
      "aliases": [],
      "description": "Synthetic record for local plugin acceptance testing.",
      "categories": ["Weather"],
      "tags": ["synthetic"],
      "provider": "Local Test",
      "source_tier": "public",
      "docs_url": "https://example.invalid/docs",
      "homepage_url": "https://example.invalid/",
      "auth": [
        {
          "type": "none",
          "location": "unknown",
          "name": "",
          "source": "manual-test",
          "confidence": 1
        }
      ],
      "https": "yes",
      "cors": "yes",
      "status": "active",
      "openapi": null,
      "provenance": [
        {
          "source_id": "private-test",
          "source_url": "https://example.invalid/source",
          "revision": null,
          "retrieved_at": "2026-08-27T00:00:00Z",
          "content_hash": "synthetic-not-production-data",
          "license": "Private test data"
        }
      ],
      "last_checked_at": null,
      "quality_flags": [],
      "rights": {}
    }
  ]
}
```

The `.invalid` domain is reserved for examples. The plugin only returns the URL as catalog data and does not request it.

## Root fields

| Field | Rule |
| --- | --- |
| `schema_version` | Number and exactly `1`. |
| `catalog_version` | Non-empty string chosen by the catalog producer. |
| `generated_at` | RFC 3339 timestamp or `null`. |
| `records` | Array sorted by each record's `id`; IDs must be unique. |

The runtime accepts at most 10,000 records, JSON nesting to depth 64, and 250,000 JSON nodes. Duplicate object keys and unknown root or record fields are rejected rather than interpreted with last-key-wins semantics.

## Record fields

Every record must include all fields shown in the example.

- `id`, `name`, and `provider` are non-empty strings of at most 512 characters; `description` is a string of at most 8,192 characters.
- `aliases`, `categories`, `tags`, and `quality_flags` are arrays of at most 256 non-empty, unique, canonically sorted strings, each at most 512 characters.
- `source_tier` is `public` or `apilayer`. Only use a tier whose data you are authorized to index.
- `docs_url` and `homepage_url` are absolute HTTP(S) URLs without whitespace, URL userinfo, or credential-like query keys.
- `https` and `cors` are `yes`, `no`, or `unknown`.
- `status` is `active`, `coming_soon`, `stale`, `candidate`, or `unknown`.
- `last_checked_at` is an RFC 3339 timestamp or `null`.
- `rights` is an object limited to `attribution`, `license`, `license_url`, `terms_url`, `authorization`, `community_attribution`, `community_license`, `repository_visibility`, `scope`, `usage_basis`, and `notes`. Values must be strings or `null`; `license_url` and `terms_url` must pass the same safe URL and credential-query checks.

Records cannot share a canonical documentation URL or the same normalized provider-and-name identity; duplicates must be merged before loading.

Index construction is also bounded: one record may contribute at most 16,384 searchable code units and tokens, while the complete catalog may contribute at most 250,000 tokens. These limits prevent a small CJK-heavy sidecar from expanding into an unsafe in-memory index.

## Authentication entries

`auth` must contain at least one entry. Each entry contains exactly:

| Field | Rule |
| --- | --- |
| `type` | `none`, `api_key`, `oauth2`, `basic`, `bearer`, `signed`, `user_agent`, `other`, or `unknown`. |
| `location` | `header`, `query`, `cookie`, or `unknown`. |
| `name` | String identifying the authentication field; it may be empty when not applicable. |
| `source` | String describing where the classification came from. |
| `confidence` | Finite number from 0 through 1. |

`none` cannot be combined with another authentication entry. Entries describe a mechanism, never a credential value.

## Provenance entries

`provenance` must contain at least one source object with `source_id`, `source_url`, `revision`, `retrieved_at`, `content_hash`, and `license`.

- `source_id` and `content_hash` are non-empty strings.
- `source_url` is an HTTPS URL that passes credential checks.
- `revision` is a string or `null`.
- `retrieved_at` is an RFC 3339 timestamp or `null`.
- `license` is a string, object, or `null`.

Keep authorization evidence outside the catalog when it contains private details. The plugin exposes freshness derived from provenance but does not verify remote content.

## Optional OpenAPI summary

Set `openapi` to `null` when no summary is available. Otherwise it is an object containing exactly:

```json
{
  "spec_url": "https://example.invalid/openapi.json",
  "specification": "openapi",
  "specification_version": "3.1.0",
  "api_version": "1",
  "title": "Synthetic Weather",
  "path_count": 1,
  "operation_count": 1,
  "tags": ["weather"],
  "security_schemes": []
}
```

`specification` is `openapi` or `swagger`; counts are non-negative integers; list values follow canonical string-array rules. This is metadata only—the plugin never downloads `spec_url`.

## Failure behavior

The plugin fails activation for a missing, relative, non-regular, unreadable, oversized, malformed, or schema-invalid external file. It does not fall back to bundled data. Error messages may help the local operator diagnose a path, but tool output and rendered search results must never reveal the configured filesystem path.
