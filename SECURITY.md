# Security policy

## Supported versions

Pre-release builds receive security fixes only until their corresponding stable version is publicly released. For stable builds, only the most recent release in the latest minor line is supported unless a release note says otherwise.

## Report a vulnerability

Please use GitHub's **Security** tab to [privately report a vulnerability](https://github.com/Ruixinhua/dsh-universe-api/security/advisories/new). Do not open a public issue for a vulnerability that could expose local paths, catalog contents, credentials, or a way to execute code.

Include:

- the affected version or commit;
- the operating system and DSH/DSH Desktop version;
- minimal reproduction steps;
- expected and observed behavior; and
- the security impact and any known workaround.

You should receive an acknowledgement within seven days. A fix timeline depends on severity and reproducibility. Please allow coordinated disclosure before publishing details.

## Security boundaries

`dsh-universe-api` is intentionally read-only and offline at runtime. It does not call candidate APIs, accept API keys, or fetch catalog updates. A configured external catalog is parsed as untrusted JSON and must pass the same canonical-v1 validation as bundled data.

The tool returns API documentation URLs as data; it does not open or validate them. Treat provider pages and APIs as external, potentially untrusted services. Do not put credentials in catalog URLs or fields.

The tool rejects undeclared arguments, including credential-like fields, without using or echoing their values. Do not put secrets in any attempted tool call: DSH may persist the original call arguments in session history before plugin execution begins.

The plugin reports an external catalog only as `external`; it should never expose the configured absolute path in tool output or rendered Markdown. A path leak, runtime network request, credential acceptance, or silent fallback from an invalid private catalog is considered a security defect.
