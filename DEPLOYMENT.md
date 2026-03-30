# Deployment Guide

This project is already structured for a Vercel-style deployment with PostgreSQL, Auth.js, and S3-compatible object storage.

## 1. Recommended Target

- Hosting: Vercel
- Database: PostgreSQL compatible with Prisma
- Storage: S3-compatible object storage
- Auth callback base URL: `NEXTAUTH_URL`

## 2. Environment Separation

Use separate resources for `Preview` and `Production` whenever possible.

- Database:
  - Production uses its own database
  - Preview uses its own database
- Object storage:
  - Prefer different buckets, or
  - Use different prefixes such as `prod/` and `preview/`

This prevents preview uploads or migrations from polluting production data.

## 3. Required Environment Variables

Required in hosted environments:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `AUTH_TRUST_HOST=true`
- `ADMIN_SEED_EMAIL`
- `ADMIN_SEED_NAME`
- `ADMIN_SEED_PASSWORD`
- `STORAGE_PROVIDER=s3`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_KEY_PREFIX`

At least one of the following should be available for image URLs:

- `S3_PUBLIC_BASE_URL`
- `S3_ENDPOINT`

Auth URL guidance:

- Production:
  - set `NEXTAUTH_URL=https://your-domain`
- Preview:
  - either set `NEXTAUTH_URL`
  - or rely on `VERCEL_URL`

## 4. Preflight Before Deploy

Prepare a private env file first:

- copy `.env.production.example` to `.env.production.local`
- or copy `.env.preview.example` to `.env.preview.local`
- fill in the real hosted values

Generate a fresh auth secret if needed:

```bash
npm run auth:secret
```

Run the deployment preflight locally or in CI:

```bash
npm run deploy:check -- --env-file=.env.production.local --stage=production
```

What it checks:

- deployment stage detection
- app URL presence
- storage readiness
- database connectivity

If any item fails, the command exits with a non-zero status.

## 5. Build And Migration Flow

The repository already includes:

- `vercel.json`
- `npm run vercel-build`

Vercel build flow:

1. `prisma generate`
2. `prisma migrate deploy`
3. `next build`

Important notes:

- commit Prisma migration files to the repository
- keep preview and production databases separated
- do not use `STORAGE_PROVIDER=local` in hosted environments

## 6. Post-Deploy Checks

After a successful deployment:

1. Open `/api/health`
2. Confirm the response is `200`
3. Confirm the JSON contains `ok: true`
4. Log into `/admin/login`
5. Verify question management and import pages load correctly
6. Upload or import at least one image-backed question
7. Start a play session and submit one leaderboard score

## 7. First Production Seed

Run this once after the first production deployment:

```bash
npm run seed:prod-admin:file
```

This command reads `.env.production.local`, then creates or updates the admin account. It does not insert demo questions.

For local development, continue using:

```bash
npm run seed:dev
```

## 8. Common Problems

### Health check returns storage errors

Cause:

- `STORAGE_PROVIDER` is still `local`
- or required S3 variables are missing

Fix:

- switch to `STORAGE_PROVIDER=s3`
- fill in the missing storage variables

### Login fails in preview or production

Usually one of these is missing:

- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `DATABASE_URL`

### Images upload but cannot be opened

Usually image URL generation is incomplete.

Check:

- `S3_PUBLIC_BASE_URL`
- or `S3_ENDPOINT`

### Preview uploads overwrite production images

Cause:

- preview and production share the same storage path

Fix:

- use different buckets
- or separate `S3_KEY_PREFIX`, such as `preview/` and `prod/`
