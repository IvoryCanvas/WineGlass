# Contributing

Start with a small public page showing a setup failure, incorrect capture,
missing environment evidence or an unusable report.

1. Search existing issues and pull requests.
2. Describe expected and actual behavior with a minimal reproduction.
3. Create a focused branch from `main`.
4. Gather evidence appropriate to the changed surface.
5. Open a pull request using the template.

Use invented data. Do not share private pages, credentials, personal paths or
customer screenshots. Security reports follow [SECURITY.md](SECURITY.md).

```sh
npm ci
npm run check
```

| Change | Relevant verification |
| --- | --- |
| Documentation | Links, actual commands and source terminology. |
| CLI or metadata | A focused success or failure case and output-contract validation. |
| Startup or capture | Affected demo modes, actual versions and cleanup observation. |
| Wine or shim | Import/export checks, preserved original and browser launch. |
| Runtime pins | Digests and a complete fresh setup rehearsal. |

`npm run check` validates syntax, local documentation links and example
metadata. It does not start Wine or measure Windows fidelity.

Use product-focused branches such as `fix/font-receipt`. Commit subjects use
lowercase Conventional Commits:

```text
fix: retain font observations in capture metadata
docs: explain the shared runtime boundary
```

Explain resulting behavior, evidence and untested cases. Update public flags,
output fields and documentation together. Screenshots alone do not establish
an OS compatibility contract.
