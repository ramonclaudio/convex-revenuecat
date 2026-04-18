# Security Policy

## Supported versions

I ship security fixes for the latest minor release only. If you're on an older version, upgrade first and reproduce against the latest before reporting.

| Version | Supported |
| :------ | :-------- |
| 0.2.x   | Yes       |
| < 0.2.0 | No        |

Once 1.0 lands, this table will cover the current major plus the previous major for a deprecation window. Pre-1.0, treat the latest `0.x` as the only supported line.

## Reporting a vulnerability

Do not open a public GitHub issue for anything that looks like a vulnerability.

Two private channels, either works. Prefer the first.

1. **GitHub Private Vulnerability Reporting.** Go to [Security > Advisories > Report a vulnerability](https://github.com/ramonclaudio/convex-revenuecat/security/advisories/new) and file it there. This keeps the report, the patch, and the advisory in one place.
2. **Email**: `security@ramonclaudio.com`.

Include as much of the following as you can:

- The package version affected.
- Type of issue (e.g., auth bypass, state tampering, PII leak, dependency CVE).
- A description of the issue and the security impact: what an attacker can do, under what conditions.
- Location of the affected code: tag, branch, commit hash, or a direct GitHub URL.
- Reproduction steps, or proof-of-concept code if you have it. A minimal Convex project or a captured webhook payload is ideal.
- Any proposed mitigation or patch.
- Whether you have already disclosed this privately anywhere else.

English is preferred for all communication.

Please don't send screenshots of tokens, production `REVENUECAT_WEBHOOK_AUTH` values, or real customer `app_user_id`s. Redact or fabricate them in the report.

## What to expect

- **Acknowledgement**: I will confirm receipt within 3 business days.
- **Triage**: Within 7 business days I will confirm whether the report is a valid vulnerability, reproduce it, and assess severity.
- **Fix**: Critical and high-severity issues get a patch release as soon as a fix and tests are ready. Medium and low get bundled into the next regular release unless you need it faster.
- **Disclosure**: This project follows a 90-day coordinated disclosure window from the date of first private report. Shorter or longer is negotiable if the fix lands sooner or if complexity warrants.
- **Advisory**: Once a fix ships, I publish a GitHub Security Advisory with a CVE (requested through GitHub) and credit the reporter unless they prefer anonymity.

## Scope

The following are in scope:

- The `convex-revenuecat` npm package, including the Convex component, the client SDK (`src/client/index.ts`), and the HTTP handler.
- Auth bypass on the webhook endpoint.
- State tampering via crafted webhook payloads.
- PII leakage through the `webhookEvents` audit log or customer attributes.
- Dependency vulnerabilities that are reachable from consumer code (reflected through the package surface).

The following are out of scope:

- Vulnerabilities in Convex itself (report those to [Convex](https://www.convex.dev)).
- Vulnerabilities in RevenueCat's backend or SDKs (report those to [RevenueCat](https://www.revenuecat.com/contact)).
- Issues in the example app (`example/`) that don't affect the published package.
- Denial-of-service scenarios that require controlling a valid `REVENUECAT_WEBHOOK_AUTH` secret and sending traffic faster than the documented 100 req/min rate limit. If you find a DoS vector that doesn't require the shared secret, that's in scope.
- Findings from automated scanners that don't demonstrate a real exploitation path.

## Good-faith research

Testing against a deployment you control is fine. Don't exfiltrate more data than necessary to demonstrate an issue, don't publish before the coordinated window closes, and don't test against third-party deployments without permission.

## Credit

Reporters are credited in the GitHub Security Advisory and the `CHANGELOG.md` entry for the fix release, unless they request otherwise. If you'd like a link (blog post, handle, employer), include it in the report.

## Out-of-scope questions

For non-security bugs, open a regular GitHub issue. For feature requests or general questions, open a discussion or ping me on GitHub (@ramonclaudio).
