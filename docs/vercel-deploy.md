# Vercel deployment notes

**Status: unverified.** These notes describe constraints to resolve before a hosted deployment. Local implementation work does not establish Vercel readiness, and no deployment or production database operation is authorized by this document.

## Configuration to resolve

The app uses the PostgreSQL driver adapter and expects a direct PostgreSQL `DATABASE_URL`; the previous Prisma Accelerate example did not match the runtime adapter. Confirm the selected hosted PostgreSQL provider's direct connection string and Vercel connectivity before configuring it. Also set `OPERATOR_APP_ORIGIN` to the exact HTTPS origin for the deployment. Do not use the local `.env.example` operator placeholders as active credentials.

Operator configuration requires `OPERATOR_EMAIL`, `OPERATOR_PASSWORD_HASH`, `OPERATOR_AUTH_EPOCH` and `OPERATOR_APP_ORIGIN`. Create a hash in an interactive terminal with `node --import tsx scripts/operator-auth.ts hash`; enter a passphrase of at least 20 characters at the hidden prompts. The output is escaped for Next.js `.env` parsing. For a provider dashboard, use the raw `scrypt$...` hash value with the backslashes removed and without `.env` quotes. Next.js explains `$` expansion and escaping in its [environment-variable guide](https://nextjs.org/docs/15/app/guides/environment-variables#referencing-other-variables). Never put the passphrase in a command argument, source file, build output or shared document.

The CLI uses Next.js's `@next/env` loader with process environment precedence. With `NODE_ENV` unset it loads development values; set `NODE_ENV=production` when using production-style local env files. Provider values must be available to both the running app and CLI when computing fingerprints or activating a configuration; activation against the wrong environment/database must not be attempted.

## Database and build constraints

Apply the additive auth migration to the intended database before activating operator configuration. Review migration history and schema parity first. Use `pnpm exec prisma migrate deploy` with the target `DATABASE_URL` supplied in the process environment or `.env`; the Prisma config does not use `.env.local`. Do not reset, seed or run `db:push` against a hosted/production database. Do not add schema mutation to the Vercel build. The build should generate Prisma Client and compile the app only.

Use `node --import tsx scripts/operator-auth.ts init` for the first explicit activation. For rotation, record the current public fingerprint using `node --import tsx scripts/operator-auth.ts fingerprint` before changing settings; set a fresh `OPERATOR_AUTH_EPOCH`, then run `node --import tsx scripts/operator-auth.ts activate --expected <CURRENT-ACTIVE-FINGERPRINT>`. `node --import tsx scripts/operator-auth.ts revoke-all` revokes all existing sessions. Do not replace these explicit operations with runtime startup or build hooks.

## Access and readiness

There are no default credentials and no Basic Auth fallback. Legacy `User` rows, roles and email cookies do not grant operator access. Signing in is intended to provide session status only; business inspection and writes remain disabled, including ingestion and export. Public data projections (#5) and map behavior (#6) remain separately pending.

Integrated unit/real-PostgreSQL (50 passed, none skipped), independent integration (9 passed), and dedicated Chromium (10 passed) checks completed locally. Production build, final post-merge typecheck and Prisma validation/migration/schema parity checks passed. Independent source/fix/acceptance review found no remaining local blocker; see the [verification record](verification/2026-11-05-issue-4.md). Hosted HTTPS login/logout and a production deployment are unverified. Before making a hosted-readiness claim, verify HTTPS login/logout, same-origin checks, cookie attributes, database session lifecycle, migration behavior, denied business actions and public browsing in the hosted environment. Until then, do not claim hosted authentication or deployment readiness. The legacy Python browser suite has not been run.
