# Operator authentication

**Status: implemented and locally verified.** The required local unit, PostgreSQL, independent integration, browser and build checks passed. Hosted HTTPS login/logout and production deployment remain unverified.

## What operator access means

There is one configured operator identity. A successful sign-in grants a verified session-status page and read-only inspection of one record by exact ID in four collections (source records, robot models, contributions, submitted data), limited to a display name, summary, status, URL and timestamps (#8). It does not grant record listing or search, or any write. Registration, history, submissions, editing, review, publication, ingestion, export and model/cache mutations remain unavailable, including to the operator. Public-data projections (#5) and map behavior (#6) have separate pending acceptance.

Legacy `User` records, role fields, email cookies and old Basic Auth variables never establish operator authority. There are no default credentials. Missing configuration, auth tables or database access must fail closed as unavailable.

## Approved session and login policy

- A random opaque browser token is stored only as a digest in PostgreSQL. Browser/device sessions are independent.
- Sessions expire absolutely after four hours. There is no idle timer or sliding renewal.
- At most five login attempts are admitted globally per 15-minute window. Successful attempts count and do not reset the window. This shared limit can temporarily deny the legitimate operator; the fixed window also permits a burst at a window boundary.
- Logging out revokes only that browser session. The CLI can revoke all sessions. Global revocation affects sessions existing at its commit; a valid login already being processed may create a new session afterward. Requests that passed authorization before revocation are not retroactively cancelled.
- Rotation uses a fresh auth epoch and an expected current configuration fingerprint, then switches the active fingerprint and revokes existing sessions atomically. A stale deployment must not reactivate its old configuration. Rollback must preserve denial; do not restore old credentials or bypass activation to regain access.

These choices keep the first deployment to one operator and the existing PostgreSQL service. Revisit them before adding operators, recovery, MFA, an identity provider, sensitive business writes, or materially higher authentication traffic. Add idle controls before enabling sensitive business writes.

## Provisioning and operation

1. Set `DATABASE_URL` to the intended direct PostgreSQL database, `OPERATOR_EMAIL`, `OPERATOR_APP_ORIGIN`, and a fresh unique `OPERATOR_AUTH_EPOCH`. Production origin must be the exact HTTPS origin. For local setup, copy `.env.example` to `.env`; the CLI uses the official Next.js environment loader. Existing process environment values take precedence. With `NODE_ENV` unset it uses development loading; set `NODE_ENV=production` when loading production-style `.env.production*` values. Do not commit a populated env file.
2. Create the scrypt password hash in an interactive terminal:

   ```bash
   node --import tsx scripts/operator-auth.ts hash
   ```

   Enter and confirm a passphrase of at least 20 characters at the hidden prompts. Passwords are not accepted as arguments or files, and piped input is rejected. Paste the emitted `OPERATOR_PASSWORD_HASH=...` assignment directly into `.env`. The CLI escapes the dollar signs for Next.js `.env` parsing. Next.js documents this `$` expansion behavior in its [environment-variable guide](https://nextjs.org/docs/15/app/guides/environment-variables#referencing-other-variables).
3. Apply the reviewed additive migration to the same target database before activation:

   ```bash
   pnpm exec prisma migrate deploy
   ```

   Ensure `DATABASE_URL` is available in the process environment or `.env` for Prisma. Do not reset, seed or use `db:push` as a substitute. The CLI loads Next.js `.env*` files; Prisma's config loads `.env` and process environment, so prefer `.env` or exported process variables when running the migration.
4. Initialize the first active configuration explicitly:

   ```bash
   node --import tsx scripts/operator-auth.ts init
   ```

   `init` succeeds only when auth has not been initialized. To inspect the current configured fingerprint without printing credential values, run:

   ```bash
   node --import tsx scripts/operator-auth.ts fingerprint
   ```

   Save the current fingerprint before changing any configured values for rotation; `activate` requires this expected active fingerprint.
5. For rotation, generate a fresh epoch, update the configured credentials/origin as needed, then activate using the previously recorded current fingerprint:

   ```bash
   node --input-type=module -e "import { randomUUID } from 'node:crypto'; console.log(randomUUID())"
   node --import tsx scripts/operator-auth.ts activate --expected <CURRENT-ACTIVE-FINGERPRINT>
   ```

   Put the generated epoch in `OPERATOR_AUTH_EPOCH` before running `activate`. Activation compares the expected active fingerprint and atomically changes the active fingerprint while revoking existing sessions. Do not omit the expected fingerprint or reuse the old epoch.
6. Revoke every currently existing browser session with:

   ```bash
   node --import tsx scripts/operator-auth.ts revoke-all
   ```

   Browser logout revokes only that browser's session. If its storage operation fails, the browser retains the cookie and must retry. A login already being processed can create a new session after global revocation commits.
7. Verify integrated login/logout with the acceptance commands below before relying on the service. The local browser run does not establish hosted readiness.

For Vercel or another provider dashboard, set the hash as the raw `scrypt$...` value: remove the backslash escaping emitted for `.env` and do not include `.env` quotes. Never put the passphrase in dashboard fields, command arguments, files or shared notes. The same normalized config must be used by CLI and server; the shared fingerprint command and regression test verify `.env` loading parity. The empty `.env.example` values are placeholders, not an activation recipe.

## Local verification

Run against disposable PostgreSQL only. The ignored `.env.auth.local` used in the verified unit/DB run pointed at loopback port 5544 and database `hri_issue4_test`. The integration fixture requires PostgreSQL `CREATEDB` rights and creates fresh databases with the `hri_issue4_acceptance_` prefix. Never point either gate at production. In PowerShell from the repository root:

```powershell
$env:OPERATOR_AUTH_TEST_DB = '1'
node --env-file=.env.auth.local --import tsx --test test/*.test.ts
Remove-Item Env:OPERATOR_AUTH_TEST_DB

$env:ISSUE4_AUTH_ACCEPTANCE = '1'
node --import tsx --test test-integration/*.test.ts
pnpm exec playwright install chromium
pnpm exec playwright test --config=playwright.auth.config.ts
Remove-Item Env:ISSUE4_AUTH_ACCEPTANCE

pnpm typecheck
node --env-file=.env.auth.local node_modules/next/dist/bin/next build
node --import tsx scripts/assert-auth-traces.ts
```

The verified combined unit/real-PostgreSQL run passed **50 tests, with zero skipped or failed**. The independent integration run passed **9 tests**. The dedicated Playwright run passed **10 Chromium tests** on localhost port 3104, using a fresh database, with no seed watcher or reused web server. The production build and final post-merge typecheck passed. Prisma validation, migration deployment and schema parity checks passed against disposable infrastructure. Production page traces contained the needed Prisma runtime assets in all 18 routes checked. The independent source/fix/acceptance review found no remaining local blocker; see the [verification record](verification/2026-11-05-issue-4.md) and [independent review](verification/2026-11-05-issue-4-review.md) for scope and limits. The legacy Python Playwright suite was not run.

`PWTEST_CACHE_DIR` and `PLAYWRIGHT_BROWSERS_PATH` may be set to writable machine cache locations if the browser install or run needs an override; the verified host used such an override. The Playwright suite starts its own Next server and acceptance database. Do not start `pnpm dev`, which also starts the seed watcher.

No hosted HTTPS login/logout, production database operation or production deployment has been performed. Verify those properties in the intended hosted environment before claiming hosted readiness. Keep rollback fail closed: an old deployment must not reactivate an old fingerprint or credentials.
