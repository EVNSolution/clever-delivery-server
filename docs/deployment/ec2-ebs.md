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

## GitHub-based EC2 deployment

The MVP host can be deployed from GitHub Actions after the EC2 host has a checked-in deploy script and the host keeps runtime-only files outside Git:

- repository checkout: `/srv/clever-delivery-server`
- runtime secrets: `/srv/clever-delivery-server/.env` (not committed)
- TLS reverse proxy config: `/srv/clever-delivery-server/Caddyfile` (not committed; copy from `Caddyfile.example`)
- compose files: `docker-compose.yml` + `docker-compose.prod.yml`

Required GitHub repository secrets:

```text
EC2_HOST=3.39.216.177
EC2_USER=ubuntu
EC2_APP_DIR=/srv/clever-delivery-server
EC2_SSH_KEY=<private key for the EC2 key pair>
```

Deployment behavior:

1. GitHub Actions connects to the EC2 host over SSH.
2. `scripts/deploy-ec2.sh` initializes or updates a git checkout in `EC2_APP_DIR`.
3. The script preserves `.env` and `Caddyfile` as host-managed runtime files.
4. Docker Compose rebuilds the API image and restarts the API/PostgreSQL/Caddy stack.
5. Prisma applies the current schema with `prisma db push --skip-generate`.
6. The script verifies local `/healthz` and `/readyz` before completing.

The workflow runs automatically after changes merge to `dev`, and can also be run manually with `workflow_dispatch` for a selected ref.

### Proof-media S3-compatible storage

Production proof-media storage can be selected with `DRIVER_PROOF_MEDIA_STORAGE_BACKEND=s3`. Required runtime secrets/config are:

- `DRIVER_PROOF_MEDIA_S3_BUCKET`
- `DRIVER_PROOF_MEDIA_S3_REGION`
- `DRIVER_PROOF_MEDIA_S3_ACCESS_KEY_ID`
- `DRIVER_PROOF_MEDIA_S3_SECRET_ACCESS_KEY`

Optional values are `DRIVER_PROOF_MEDIA_S3_ENDPOINT`, `DRIVER_PROOF_MEDIA_S3_FORCE_PATH_STYLE`, and `DRIVER_PROOF_MEDIA_S3_SESSION_TOKEN` for S3-compatible providers, path-style endpoints, and temporary credentials. The backend signs PUT/DELETE requests and presigned GET read access with AWS Signature Version 4. Keep credentials in the host/container secret mechanism and record only sanitized bucket/IAM policy evidence in change-control issues.

A production release still needs private evidence for bucket ownership, IAM least-privilege policy, credential rotation/custody, signed URL smoke, malware scanner deployment, scanner alerting, and cleanup scheduler deployment.

### Proof-media cleanup scheduler evidence

Proof-media retention cleanup can be run manually or by a host scheduler:

```bash
npm run driver:proof-media:cleanup
```

The command removes expired proof-media bytes through the configured storage backend, marks deleted metadata, and records a sanitized `RetentionJobRun` row. `DRIVER_PROOF_MEDIA_CLEANUP_EVIDENCE_REF` can point to a private scheduler/log/evidence location; do not store proof images, storage keys, customer data, coordinates, phone numbers, or raw logs in that value. A production release still needs deployed scheduler evidence showing the command runs on the selected environment.

For runtime request inspection without direct SSH, use the **Inspect EC2
Runtime** workflow. See `docs/deployment/log-inspection.md`.

### Self-hosted runner note

The MVP host currently uses a repository self-hosted runner named `clever-delivery-server-mvp` with labels:

```text
self-hosted, Linux, X64, clever-delivery-server, mvp-ec2
```

This avoids opening SSH to GitHub-hosted runner IP ranges. The workflow runs on the EC2 host itself and executes `scripts/deploy-ec2.sh` locally. The only required GitHub secret for this mode is:

```text
EC2_APP_DIR=/srv/clever-delivery-server
```

The older SSH secrets (`EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`) can remain for break-glass/manual recovery but are not used by the current workflow.
