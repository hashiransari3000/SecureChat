# Security

SecureChat is an open-source project, and we appreciate the security community's
help in making it safer.

## What this project is (and is not)

SecureChat provides browser-based end-to-end encryption for message and
attachment content. It **does not** claim production parity with mature,
independently audited messengers such as Signal:

- No Double Ratchet forward secrecy or sealed sender.
- A malicious/compromised server could substitute public keys (no out-of-band
  key hardening beyond in-band fingerprint comparison).
- Conversation membership, group names, timestamps and delivery metadata are
  server-visible by design.

These boundaries are disclosed inside the application and in
[`README.md`](README.md). Please do not file them as vulnerabilities.

## Supported versions

The latest commit on `main`, and the deployed demo, are the supported targets.

## Reporting a vulnerability

If you believe you have found a security issue that contradicts the boundaries
above (e.g. plaintext leakage, broken authentication, privilege escalation,
unsafe deserialization, secrets exposure):

1. **Do not open a public issue.** Send details privately instead.
2. Include: affected version/commit, a minimal reproduction, and impact
   assessment.
3. Give us a reasonable disclosure window before public release.

**Contact:** open a private report via a GitHub issue labeled `security`, or
reach the maintainers at the repository owner's GitHub profile.

## Hallmarks of good reports

- Smallest possible reproduction.
- Clear distinction between intentional design (documented boundaries) and a
  defect.
- No inclusion of real user data, passwords or credentials.

## Security hygiene (for self-hosters)

- Use HTTPS everywhere (CloudFront/nginx in the reference deployment).
- Keep `.env` out of version control; rotate secrets if ever exposed.
- Follow [DEPLOYMENT.md](DEPLOYMENT.md) for rate limiting, the CORS allowlist
  and security headers that ship by default.