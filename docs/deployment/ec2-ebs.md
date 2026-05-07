# EC2 + EBS deployment readiness

This service starts with a single AWS EC2 host running the Node API and PostgreSQL on an EBS-backed volume. PostgreSQL should move to RDS when operational load, backup requirements, or availability requirements exceed a single-host profile.

## Runtime units

- API: `clever-delivery-server` Node 22 container
- Database: PostgreSQL 17 container backed by an EBS-mounted Docker volume path
- Public ingress: HTTPS reverse proxy or load balancer terminating TLS before the API
- Health checks: `GET /healthz`, `GET /readyz`

## Required environment

Copy `.env.example` to `.env` and set at minimum:

```env
DATABASE_URL=postgresql://clever:<password>@postgres:5432/clever_delivery
POSTGRES_DB=clever_delivery
POSTGRES_USER=clever
POSTGRES_PASSWORD=<strong-password>
SHOPIFY_API_KEY=<shopify-app-api-key>
SHOPIFY_API_SECRET=<shopify-app-api-secret>
SHOPIFY_API_VERSION=2026-04
SHOPIFY_TOKEN_ENCRYPTION_KEY=base64:<32-byte-base64-key>
JWT_SECRET=<driver-api-secret-when-driver-api-exists>
```

Never commit real `.env` files, Shopify secrets, DB passwords, or token-encryption keys.

## Local compose smoke

```bash
cp .env.example .env
# Fill required secrets before enabling Shopify routes.
docker compose config
docker compose up --build
curl http://localhost:3000/healthz
curl http://localhost:3000/readyz
```

## EC2/EBS host outline

1. Create an EC2 instance with Docker Engine and Compose plugin installed.
2. Attach and mount a dedicated EBS volume for PostgreSQL data.
3. Keep the repo checkout and `.env` outside the PostgreSQL data mount.
4. Run `docker compose up -d --build` from the repo root.
5. Confirm health endpoints.
6. Configure reverse proxy/TLS and Shopify app webhook URL to point to the public API origin.

Example EBS mount target:

```text
/mnt/clever-delivery-postgres
```

For production, bind the `postgres-data` volume to the mounted EBS path using a host path or Docker volume driver configuration before first database initialization.

## Backup

Install PostgreSQL client tools on the host or run the scripts from a container that has `pg_dump` / `pg_restore`.

```bash
DATABASE_URL=postgresql://clever:<password>@localhost:5432/clever_delivery \
  BACKUP_DIR=/mnt/clever-delivery-backups \
  scripts/postgres-backup.sh
```

The script writes custom-format dumps named `clever_delivery_<UTC timestamp>.dump`.

## Restore

Restore only into an explicitly selected target database:

```bash
DATABASE_URL=postgresql://clever:<password>@localhost:5432/clever_delivery \
  BACKUP_FILE=/mnt/clever-delivery-backups/clever_delivery_YYYYMMDDTHHMMSSZ.dump \
  scripts/postgres-restore.sh
```

`pg_restore --clean --if-exists` can delete target database objects. Do not run restore against production until the target DB and backup file are verified.

## RDS migration path

1. Stop background sync/webhook processing or put the app into maintenance mode.
2. Take a final EBS PostgreSQL backup with `scripts/postgres-backup.sh`.
3. Restore into the RDS PostgreSQL instance.
4. Run Prisma validation/migrations against RDS.
5. Update `DATABASE_URL` to RDS and restart API containers.
6. Verify `/readyz`, Shopify auth/token exchange, webhook receive, and order-sync smoke.
7. Keep the EBS volume read-only until RDS cutover is accepted.

## Current gaps

- No real AWS resources are provisioned by this repo yet.
- No CI image publish workflow exists yet.
- No live DB migration has been run yet.
- Secrets management is still `.env`/host-managed; move to AWS SSM/Secrets Manager before production hardening.
