# clever-delivery-server

Shopify companion delivery data server for CLEVER/Tomatono delivery operations.

Initial deployment target: AWS EC2 with EBS-backed PostgreSQL. Growth path: move PostgreSQL to RDS when scale or operational requirements justify it.

## Current repo state

This repository currently contains the basic Node.js/TypeScript API scaffold plus the first Prisma schema and shop-token storage foundation:

- Fastify app factory
- `/healthz` liveness endpoint
- `/readyz` readiness endpoint for the current HTTP scaffold
- TypeScript build, lint, typecheck, and Vitest test scripts
- Prisma/PostgreSQL schema for delivery operations
- AES-GCM helper for encrypting Shopify Admin API tokens before database storage
- Shop-token service/repository for encrypted per-shop token persistence

Shopify webhook ingestion, Admin GraphQL order sync, route optimization, Driver API, Docker, and EC2/EBS deployment work are intentionally left for follow-up issue-linked branches.

## Local development

Recommended Node version: 22 LTS. The repo includes `.nvmrc` with `22`.

```bash
npm install
cp .env.example .env
npm run dev
```

Health checks:

```bash
curl http://localhost:3000/healthz
curl http://localhost:3000/readyz
```

Validation:

```bash
npm run check:workspace
npm run lint
npm run typecheck
npm run test
npm run build
```

## Database schema

The repository now includes the first Prisma/PostgreSQL schema at `prisma/schema.prisma`.

The `Shop` model is prepared for automatic Shopify app/token connection flows:

- `shopDomain` uniquely identifies the Shopify shop.
- `adminAccessTokenCiphertext` stores the encrypted Admin API access token.
- `adminAccessTokenExpiresAt`, `adminRefreshTokenCiphertext`, and `adminRefreshTokenExpiresAt` reserve space for expiring offline-token refresh flows.
- `tokenScopes` records the granted Admin API scopes.

Local schema validation does not require a running PostgreSQL server:

```bash
npm run prisma:validate
npm run prisma:format
```

Actual migrations and database connectivity are intentionally left for the follow-up DB/runtime branch.

## Shopify shop token storage

Embedded Shopify apps can exchange App Bridge session tokens for Admin API access tokens. This repo does not implement the HTTP route yet, but it now has the storage foundation for that flow:

- `loadShopifyTokenEncryptionKey()` reads `SHOPIFY_TOKEN_ENCRYPTION_KEY`.
- `encryptSecret()` / `decryptSecret()` use AES-256-GCM with associated shop context.
- `ShopTokenService.storeAdminApiToken()` encrypts access/refresh tokens and writes only ciphertext through the repository.
- `ShopTokenService.getAdminAccessToken()` decrypts the stored Admin API token for future Shopify Admin GraphQL calls.

Generate a local encryption key with:

```bash
openssl rand -base64 32
```

Store it as:

```env
SHOPIFY_TOKEN_ENCRYPTION_KEY=base64:<generated-value>
```

Do not commit real Shopify Admin API tokens or production encryption keys.

## Project references

- `AGENTS.md` for agent execution rules
- `docs/project-brief.md` for project scope
- `docs/superpowers/specs/2026-05-07-clever-delivery-server-design.md` for initial design direction
