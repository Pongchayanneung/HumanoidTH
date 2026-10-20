# Vercel Deployment

## Required Vercel Environment Variables

Set these in Vercel Project Settings -> Environment Variables:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname?schema=public
NEXT_PUBLIC_APP_URL=https://your-project.vercel.app
ADMIN_BASIC_USER=creativelab.co.th@gmail.com
ADMIN_BASIC_PASSWORD=<strong unique password>
ADMIN_SESSION_SECRET=<random 32+ byte secret, e.g. from `openssl rand -hex 32`>
YOUTUBE_API_KEY=
GITHUB_TOKEN=
```

`DATABASE_URL` must be a direct PostgreSQL connection string (e.g. from Supabase, Neon, Railway, or Vercel Postgres's non-pooling URL). This app's Prisma client uses `@prisma/adapter-pg`, which does not support Prisma Accelerate's `prisma+postgres://` proxy URLs.

`ADMIN_SESSION_SECRET` signs the admin session cookie (see `lib/auth.ts`). It must be set for admin login to work at all.

## Deploy Flow

1. Connect this GitHub repo to Vercel.
2. Add the environment variables above.
3. Deploy.
4. Run schema push once from your local machine or Vercel CLI:

```bash
pnpm db:push
pnpm db:seed
```

Do not run `db:push` automatically during every Vercel build. Builds should generate Prisma Client and build Next.js only.

## Protected Routes

In production, these routes require Basic Auth:

- `/admin/*`
- `/data-pulls`
- `/api/ingest/*`
- `/api/export`

If `ADMIN_BASIC_USER` or `ADMIN_BASIC_PASSWORD` is unset, protected API routes return `503` instead of falling back to a default credential.
