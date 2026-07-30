# Security Policy

## Supported version

Security fixes are applied to the latest release.

## Reporting

Please report security issues privately through GitHub Security Advisories instead of opening a public issue.

Do not attach Clash profiles, subscription URLs, access tokens, runtime configuration backups, or other personal network data to public reports.

## Trust boundary

DNS Guard Local binds only to `127.0.0.1` and protects its API with a per-launch random token. The protection switch intentionally edits the active Clash Verge Rev Merge extension and runtime DNS configuration. It validates the candidate with Mihomo and creates local backups before reloading.

Unsigned GitHub builds are not notarized by Apple. Verify the release checksum and repository source before overriding Gatekeeper.
