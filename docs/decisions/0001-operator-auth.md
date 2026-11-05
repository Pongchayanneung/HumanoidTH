# ADR 0001: one configured operator with PostgreSQL sessions

Date: 2026-11-05 (Asia/Bangkok). Status: approved; implementation in progress.

## User decisions

1. Use existing PostgreSQL for sessions, revocation and shared login limits, avoiding another service. Revisit for multiple operators, recovery, MFA, identity providers or materially higher authentication traffic.
2. Complete real authentication beyond the former 100-minute allowance. Report actual overruns separately; no silent reallocation from other issues.
3. Permit independent browser/device sessions. Logout affects the current session; a CLI can revoke all existing sessions. Revisit if a single-session policy is required.

## Engineering decisions

- Opaque 256-bit random tokens with only SHA-256 digests stored; four-hour absolute expiry, no sliding renewal/idle writes. Fresh DB validation enforces revocation. Revisit idle controls before sensitive business writes are enabled.
- Separate auth tables from legacy User rows; no cookie-supplied email/role or existing user record grants operator authority.
- Shared five-attempt/15-minute login admission window; count successes. Accept temporary legitimate-login denial and fixed-window boundary bursts rather than trusting spoofable IP counters. Existing sessions remain usable.
- Standard Node async scrypt (N32768/r8/p3, 16-byte salt, 64-byte result, maxmem64MiB) with bounded per-process derivation concurrency. No custom signing/JWT scheme or external auth library for this small scope.
- Explicit central configuration activation and rotation prevents stale deployments from accepting old credentials; runtime never initializes auth authority automatically.
- Global revoke affects sessions existing at commit; a pending valid login may create a new session afterward. In-flight requests already authorized are not retroactively cancelled.
- Server-only sensitive checks and fail-closed handlers; lazy DB initialization ensures deliberate unavailable responses even when auth/database configuration is absent.
- Login exposes session status only. Inspection (#8), public projections (#5), honest map (#6) and unfinished write workflows retain separate acceptance gates.

## Evidence and operating notes

See [implementation plan](../superpowers/plans/2026-11-05-issue-4-operator-auth.md). Implementation verification, setup/rotation commands and remaining limits will be added after actual tests. No production operation or hosted readiness is claimed here.
