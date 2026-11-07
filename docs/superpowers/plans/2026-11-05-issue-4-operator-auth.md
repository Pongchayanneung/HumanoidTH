# Issue #4: operator authentication implementation plan

> Approved by the user on 2026-11-05. Execute with task agents and primary-agent review. Workers do not spawn agents. Preserve exclusive file ownership and integrate only reviewed changes.

**Goal:** real configured-operator login/logout, independent revocable browser sessions, and enforced denial of unfinished identity/business workflows.
**Architecture:** PostgreSQL opaque sessions and shared login-attempt state; Node scrypt password verification; server checks at every retained sensitive entry point.
**Stack:** existing Next.js 15, TypeScript, Prisma/PostgreSQL and Node crypto. No external identity provider or wholesale framework upgrade.
**Base:** `bug/4-verify-identity-action-boundary`, `37fdd93a318e421cd70deeca49269ed371c4face`.
**Spec:** this approved plan and [decision record](../../decisions/0001-operator-auth.md). Earlier scope review is historical; this approved plan supersedes its proposed defaults.

## Global constraints and decisions

- Existing PostgreSQL, full real authentication even beyond the former 100-minute allowance, multiple independent device sessions. Report schedule overruns separately; do not silently borrow another issue's allocation.
- Four-hour absolute lifetime, no idle timer/sliding renewal. Five total admitted logins per global 15-minute window; successful attempts also count and do not reset it. Deliberate temporary login denial risk is documented.
- One configured operator only. Legacy `User` rows/roles/email cookies never grant authority. No public account, recovery, MFA or business-write completion is included.
- Only session-status administrator landing is retained. Exact inspection belongs to #8. Registration, histories, submissions, editing/review/publication, ingestion, export and model/cache mutations remain unavailable, even to the operator.
- Keep current public browsing/language behavior except explicitly unavailable workflows; disclosure projections belong to #5 and honest map behavior to #6.
- No production DB reset/seed, automatic build-time schema push, whole repair-branch merge, push or deployment is authorized by implementation alone.

## Authentication contract

```ts
type OperatorPrincipal = Readonly<{ kind: "operator"; email: string }>;
type LoginResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; code: "INVALID_CREDENTIALS" | "THROTTLED" | "UNAVAILABLE"; retryAfterSeconds?: number };
type SessionResult =
  | { ok: true; principal: OperatorPrincipal }
  | { ok: false; code: "UNAUTHENTICATED" | "UNAVAILABLE" };
loginOperator(input: { email: string; password: string }): Promise<LoginResult>;
readOperatorSession(token?: string): Promise<SessionResult>;
revokeOperatorSession(token?: string): Promise<{ ok: true } | { ok: false; code: "UNAVAILABLE" }>;
```

Freeze exports and shared adapter signatures in T0 before parallel tasks. Core has injectable store/credential dependencies for focused tests; Next cookies/headers/redirects stay in the server web adapter. Raw tokens never enter client props/logs. Auth database creation/import is lazy inside the handled operation, after configuration validation and missing/malformed-token checks. No transitive eager Prisma imports from unavailable stubs.

Add `OperatorAuthState` singleton with active configuration fingerprint, window start and attempt count. Add `OperatorSession`, keyed by SHA-256 digest of a 32-random-byte token, with config fingerprint, creation/expiry and nullable revocation times; expiry index. No relation to legacy User.

Require `OPERATOR_EMAIL`, `OPERATOR_PASSWORD_HASH`, `OPERATOR_AUTH_EPOCH`, `OPERATOR_APP_ORIGIN`, and database configuration. Normalize email consistently. Preserve password whitespace; bound email at 254 characters and password at 1,024 UTF-8 bytes. Provision via hidden input, minimum 20-character passphrase, no password arguments/files. Approved password format: `scrypt$32768$8$3$<32 lowercase hex salt>$<128 lowercase hex derived key>`. Node async scrypt: N32768/r8/p3, 16-byte random salt, 64-byte output, maxmem64MiB; constant-time comparison. Reject unsupported parameters/malformed configuration before derivation. One active derivation plus four queued per process; overflow unavailable, admitted quota remains spent; release slot in finally.

Atomically reserve attempt under singleton row lock using DB clock after acquiring it. Commit before password derivation. Unknown email/password use same generic response and derivation. Successful issuance locks state again, rechecks active config, cleans expired/revoked rows and inserts session, all using DB time. Session validation checks current active config, digest, revocation and expiry via fresh lookup.

Explicit initialization/activation CLI is the only way to activate configuration; no automatic activation. Shared canonicalization/fingerprint code for CLI and server. Rotation with fresh epoch locks state, checks expected active fingerprint, changes fingerprint and revokes sessions atomically. Old deployment cannot activate itself or issue sessions after rotation. Global revoke locks state and revokes existing sessions at commit; a pending valid login may create a new session afterward. Already-authorized requests are not retroactively cancelled.

Logout revokes only current digest before clearing cookie. On storage failure return unavailable and retain cookie for retry. Multiple browsers remain independent. Expired/revoked cleanup is opportunistic, never required for expiry enforcement.

Production cookie `__Host-operator_session`: HttpOnly, Secure, SameSite Strict, Path /, no Domain, four-hour expiry/Max-Age. Separate development cookie; insecure only localhost development. Ignore legacy cookies and clear on successful login/logout. Strict configured same-origin login/logout; production origin must be HTTPS. Login success redirects only /admin. Missing config/table/DB -> deliberate unavailable, no raw errors/secrets.

Disabled APIs return 403 JSON `{ok:false,code:"WORKFLOW_UNAVAILABLE"}` before body parsing/DB/provider work; disabled actions equivalent structured denial. Pages show clear unavailable state; unauthenticated admin redirects to login before data reads. Remove unsigned-cookie/Basic middleware authority. Map reader never generates/writes; unavailable until public cache policy is approved. Denial must precede old map catch/fallback logic.

## Tasks and exclusive ownership

### T0 — Foundation and contract (Sol / medium)
- [ ] Establish frozen-lockfile runtime, disposable PostgreSQL and baseline test evidence without seed watcher.
- [ ] Own package/lock/test-command edits. Verify current Prisma migration compatibility; report existing blockers rather than upgrading stack wholesale.
- [ ] Create shared auth types, adapter signatures and fail-closed stubs in `lib/operator-auth/`; give exact exports to other workers.
- [ ] Tests first for fail-closed imports/configuration stubs, focused verification, primary review.

### T1 — Authentication core (Sol / high)
- [ ] Own auth modules, schema/additive auth migration, provisioning/activation/revocation CLI and focused unit/DB lifecycle tests.
- [ ] Implement contract, credential limits/KDF queue, cookie/origin helpers, persistent lifecycle and concurrency rules above.
- [ ] Follow meaningful red/green tests. Report commands, revision and concerns for primary review.

### T2 — Server boundaries (Sol / high)
- [ ] Sole owner `app/actions.ts`, middleware removal, ingest/export route handlers, map action containment and focused boundary tests.
- [ ] Wire login/logout wrappers to frozen adapter; keep language public with validated en/th values.
- [ ] Replace legacy identities and all unfinished writes with unavailable handlers. Remove business/provider imports; deny before body parsing/catch effects.
- [ ] No protected business effect for anonymous, forged or valid-operator denied calls; module imports survive missing DATABASE_URL. Primary review required.

### T3 — Pages and controls (Sol / medium)
- [ ] Own login UI, session-only administrator landing, profile/submission/data-pulls/map unavailable pages and layout/global pull control removal.
- [ ] No user/history/business queries in unavailable surfaces. No raw session data in client props. Preserve existing visual language and bilingual messages; accessible status/errors.
- [ ] Do not edit shared actions/map actions. Follow frozen adapter imports, focused checks and primary review.

### T4 — Independent acceptance (Sol / high)
- [ ] Own independent hostile-request, real-Postgres concurrency and dedicated browser tests; replace simulator-dependent smoke behavior.
- [ ] Dedicated auth server/port, no reuse of unrelated server, no seed watcher. Use disposable database only.
- [ ] Run unit, integration, Prisma validation, typecheck, auth Playwright and production build; exact passed/failed/unrun evidence.

### T5 — Decision record and handoff (Luna / high)
- [ ] Own final operating notes/decision record updates with rationale, revisit conditions, commands, limitations and verification evidence.
- [ ] Update root project context and README current-state wording only with verified results. No secrets or private identity values.

### T6 — Independent security review (Sol / high)
- [ ] Review integrated diff and evidence for spec/quality/security; primary reviewer adjudicates, returns fixes to original worker and rechecks.
- [ ] No completion while required security checks fail. Do not claim hosted verification from local checks.

## Parallelism and review

T0 is first. T1/T2/T3 may run concurrently after contract freeze with separate worktrees and exclusive files. T4 preparation may overlap any two workers; final execution waits for integration. Maximum three active subagents plus primary. Serialize interface/package edits, schema application, integration and final acceptance. #6/#8 handoff only after ownership release. Workers never spawn agents.

Every task: failing meaningful test -> implementation -> focused pass -> report/diff/revision -> primary spec/quality review -> fixes to same worker -> integration. Keep a recoverable ledger and scoped reports. Independent final review follows all integrated tasks.

## Acceptance and rollout

- Missing/malformed/forged/legacy/expired/revoked sessions; real login, multi-device independence and copied-token logout replay.
- Global revocation/rotation and stale deploy rejection; paused derivation during rotation; revoke-all issuance ordering.
- Concurrent DB admissions/window boundaries; bounded derivation burst/overflow/release on failures.
- Missing/malformed config and DB/table failures, including subprocess import without DATABASE_URL.
- Every disabled action/API directly invoked with malformed requests and valid operator; zero protected reads/writes/provider/ingest/cache/revalidation effects. Auth bookkeeping distinguished.
- Generic errors, origin rejection, cookie attributes, safe redirects, public/language usability and unavailable UI.
- Check migration history/schema parity before shared DB application. Use additive migration, no reset/seed/automatic db:push. Rollback preserves denial.
- Test command/runtime details are frozen by T0/T4. Use Next-only test startup, never `pnpm dev` (seed watcher). HTTPS hosted login/logout must pass before claiming hosted readiness.

## Decision log

2026-11-05: user approved the full plan and requested implementation with primary reviewer and task agents. Authentication is now implementation-authorized; deployment/push/production database operations are not implied. Decisions are recorded in the ADR; earlier 100-minute fallback is superseded for this task.
