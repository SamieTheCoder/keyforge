# Security policy

Keyzforge handles security keys, so we take reports seriously.

## Report a vulnerability

Please **do not open a public issue**. Report privately through GitHub:
[Security → Report a vulnerability](https://github.com/SamieTheCoder/keyzforge/security/advisories/new).

Include what you found, how to reproduce it, and the impact you expect. You will get an answer within 7 days. We will agree a
fix and disclosure date with you and credit you in the advisory unless you prefer otherwise.

## Scope

In scope:

- The web app: anything that could leak a PIN, passkey list, serial number or other key data out of the browser tab, cross-site
  issues, the `/api/firmware` route (allowlist bypass, SSRF), CSP or header weaknesses.
- Firmware patches in `firmware/patches` and the build and release pipeline (tampered artifacts, checksum or source mismatch).
- Anything that could make Keyzforge write to a key without the user's confirmation, or burn eFuse / OTP unexpectedly.

Firmware issues that also exist in the unpatched upstream code base are still welcome here; we will coordinate with upstream.

## Supported versions

| Component | Supported |
| --- | --- |
| Website (keyzforge.tech) | latest `main` |
| Firmware | latest `fw-*` release |

## Verifying a firmware release

Each release has `SHA256SUMS` and the complete source. Check a download with:

```sh
sha256sum -c SHA256SUMS --ignore-missing
```
