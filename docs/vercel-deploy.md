# Vercel Deployment

## Required Vercel Environment Variables

Set these in Vercel Project Settings -> Environment Variables:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname?schema=public
NEXT_PUBLIC_APP_URL=https://your-project.vercel.app
ADMIN_BASIC_USER=creativelab.co.th@gmail.com
ADMIN_BASIC_PASSWORD=<strong unique password>
YOUTUBE_API_KEY=
GITHUB_TOKEN=
```

`DATABASE_URL` must be a direct PostgreSQL connection string (use the provider's non-pooling URL if it offers both). This app's Prisma client uses `@prisma/adapter-pg`, which does not support Prisma Accelerate proxy URLs.

## Deploy Flow

1. Connect this GitHub repo to Vercel.
2. Add the environment variables above.
3. Deploy.
4. Apply the migrations once from your local machine or Vercel CLI, with `DATABASE_URL` exported for the target database:

```bash
npx prisma migrate deploy
```

Do not run migrations automatically during every Vercel build. Builds should generate Prisma Client and build Next.js only.

`pnpm install` runs `prisma generate`, which does not need a database. If your pnpm version skips the Prisma build scripts, run `./node_modules/.bin/prisma generate` yourself after installing; it does not need `DATABASE_URL` either.

## Seeding

Never run the seed script against a hosted or production database. It is refused unless `ATLAS_ALLOW_SEED=1` is set and `DATABASE_URL` points at `localhost` or `127.0.0.1`, so there is no supported way to seed a hosted database from this repository. The flag is read only from the command line: a value in `.env` or any other env file the repository loads is ignored. This does not cover a file you load into the environment yourself, for example `node --env-file` or a `dotenv/config` preload. The guard checks the hostname string only, so a tunnel or port forward on `localhost` counts as local. Seeding:

- resets `relevanceStatus` of seeded source records to the seed value,
- re-grants the ADMIN role to the seed admin account,
- overwrites perspective stance and sentiment, and
- appends a duplicate `SourcePullJob` and `SubmittedData` row on every run.

Use it only on a disposable or empty local database:

```bash
ATLAS_ALLOW_SEED=1 pnpm db:seed
# or, without pnpm (pnpm 11 cannot run `pnpm run` scripts here):
ATLAS_ALLOW_SEED=1 node --import tsx prisma/seed.ts
```

Per Prisma's documented behaviour, `prisma migrate reset` and a `prisma migrate dev` that resets the database run the same seed command, and the guard refuses that seed step without the flag. `migrate reset` was observed once on macOS against a disposable local database (seed step refused, User=0); the `migrate dev` reset path follows Prisma's documented behaviour and was not run. They are destructive in their own right: `migrate reset` drops the target database before the seed runs, and the guard does not stop that. Run them only against a disposable database.

Ordinary startup (`pnpm dev`, `next start`) does not seed. `pnpm dev` starts the dataset watcher only with both `WATCH_SEED=1` and `ATLAS_ALLOW_SEED=1`. Running `pnpm seed:watch` directly needs `ATLAS_ALLOW_SEED=1` inline and a local URL.

## Protected Routes

In production, these routes require Basic Auth:

- `/admin/*`
- `/data-pulls`
- `/api/ingest/*`
- `/api/export`

If `ADMIN_BASIC_PASSWORD` is left as `change-this-before-deploy`, protected routes return `503`.
