# clever-delivery-server MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working MVP of `clever-delivery-server`: Shopify webhook/order ingestion, PostgreSQL/Prisma delivery data model, route optimization MVP, Driver API skeleton, and EC2/EBS deployment readiness.

**Architecture:** A modular Fastify + TypeScript API server owns Shopify Admin GraphQL sync, webhook ingestion, delivery-route data, and driver-facing APIs. PostgreSQL is the source of truth for delivery operations; Prisma owns schema/migrations; Docker Compose runs app + PostgreSQL for local and first EC2 deployment.

**Tech Stack:** Node.js LTS, TypeScript, Fastify, Prisma ORM, PostgreSQL, Vitest, Docker Compose, Nginx on EC2, Shopify Admin GraphQL API `2026-04`.

---

## Execution governance

- Planning branch: `cc-100-mvp-plan`
- Planning issue: EVNSolution/clever-delivery-server#4
- Planning change-control: EVNSolution/clever-change-control#100
- Actual source implementation should start only after this planning work is reviewed. Recommended first implementation issue is a new target issue titled `Scaffold clever-delivery-server Node/TypeScript MVP` linked to a new change-control child issue of #100/#99, with branch name `cc-<new-change-control-number>-server-scaffold` from `dev`.
- Do not implement server source on `dev` directly.

## File structure to create during implementation

```text
.env.example
Dockerfile
docker-compose.yml
package.json
package-lock.json
prisma/schema.prisma
prisma/migrations/<timestamp>_init/migration.sql
src/app.ts
src/server.ts
src/config/env.ts
src/plugins/prisma.ts
src/plugins/auth.ts
src/routes/health.routes.ts
src/routes/shopify-webhook.routes.ts
src/routes/admin.routes.ts
src/routes/driver.routes.ts
src/modules/shopify/admin-graphql.client.ts
src/modules/shopify/order-sync.service.ts
src/modules/shopify/order.mapper.ts
src/modules/shopify/webhook-verifier.ts
src/modules/shopify/webhook-event.repository.ts
src/modules/orders/order.repository.ts
src/modules/delivery-stops/delivery-stop.repository.ts
src/modules/routes/route-optimizer.ts
src/modules/routes/route-plan.repository.ts
src/modules/drivers/driver-auth.service.ts
src/modules/drivers/driver-event.service.ts
src/modules/drivers/driver.repository.ts
src/modules/vehicles/vehicle.repository.ts
src/shared/errors.ts
src/shared/http.ts
src/shared/ids.ts
tests/health.test.ts
tests/shopify-webhook-verifier.test.ts
tests/shopify-webhook.routes.test.ts
tests/order.mapper.test.ts
tests/route-optimizer.test.ts
tests/driver-api.test.ts
tests/prisma.integration.test.ts
scripts/backup-postgres.sh
scripts/restore-postgres.sh
docs/deploy/ec2-ebs-runbook.md
docs/api/admin-api.md
docs/api/driver-api.md
```

## Task 1: Scaffold TypeScript/Fastify service shell

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/app.ts`
- Create: `src/server.ts`
- Create: `src/config/env.ts`
- Create: `src/routes/health.routes.ts`
- Create: `tests/health.test.ts`

- [ ] **Step 1: Write failing health route test**

Create `tests/health.test.ts` with a Fastify `app.inject()` test for `GET /healthz` and `GET /readyz`. Expected initial failure: app module does not exist.

- [ ] **Step 2: Add package scripts and dependencies**

Add scripts:

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "check:workspace": "npm run lint && npm run typecheck && npm run test"
  }
}
```

Core runtime dependencies: `fastify`, `@fastify/helmet`, `@fastify/cors`, `@prisma/client`.
Core dev dependencies: `typescript`, `tsx`, `vitest`, `eslint`, `typescript-eslint`, `prisma`, `@types/node`.

- [ ] **Step 3: Implement app factory**

`src/app.ts` should export `buildApp()` and register health routes. `src/server.ts` should only load env, build the app, and listen.

- [ ] **Step 4: Run verification**

Run:

```bash
npm run typecheck
npm run test -- tests/health.test.ts
```

Expected: both pass.

- [ ] **Step 5: Commit**

Commit with Lore protocol. Intent line example:

```text
Establish a typed API shell before delivery-specific behavior
```

## Task 2: Add Prisma schema and PostgreSQL integration

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/plugins/prisma.ts`
- Create: `tests/prisma.integration.test.ts`
- Modify: `.env.example`
- Modify: `package.json`

- [ ] **Step 1: Write schema validation expectation**

Add a test or CI step that runs Prisma validation. Expected initial failure: schema is missing.

- [ ] **Step 2: Define Prisma models**

Implement the models from the design spec:

- `Shop`
- `ShopifyWebhookEvent`
- `Order`
- `DeliveryStop`
- `RoutePlan`
- `RoutePlanStop`
- `Driver`
- `DriverSession`
- `Vehicle`
- `DriverEvent`

Use enum fields for lifecycle/status values. Use `Json` for raw Shopify payloads, webhook payloads, route constraints, route metrics, and driver event payloads.

- [ ] **Step 3: Add indexes and uniqueness**

Required unique constraints:

- `Shop.shopDomain`
- `(shopId, webhookId)` on webhook events
- `(shopId, shopifyOrderGid)` on orders
- `(routePlanId, sequence)` and `(routePlanId, deliveryStopId)` on route plan stops
- `(driverId, clientEventId)` on driver events when `clientEventId` is present; if Prisma cannot model the partial unique constraint cleanly, add a SQL migration comment and implement through generated migration SQL.

- [ ] **Step 4: Generate and validate migration**

Run:

```bash
npx prisma format
npx prisma validate
npx prisma migrate dev --name init
npm run typecheck
```

Expected: Prisma validates and migration is generated.

- [ ] **Step 5: Commit**

Intent line example:

```text
Make delivery operations auditable from the first database migration
```

## Task 3: Implement Shopify webhook HMAC verification and event ledger

**Files:**
- Create: `src/modules/shopify/webhook-verifier.ts`
- Create: `src/modules/shopify/webhook-event.repository.ts`
- Create: `src/routes/shopify-webhook.routes.ts`
- Create: `tests/shopify-webhook-verifier.test.ts`
- Create: `tests/shopify-webhook.routes.test.ts`
- Modify: `src/app.ts`
- Modify: `src/config/env.ts`

- [ ] **Step 1: Write HMAC verifier tests**

Test cases:

- valid HMAC over raw body returns verified metadata;
- tampered raw body fails;
- missing HMAC fails;
- lowercase header name still works;
- unequal digest lengths do not throw timing comparison errors.

- [ ] **Step 2: Implement verifier**

Use Node `crypto.createHmac('sha256', secret).update(rawBody).digest('base64')` and `crypto.timingSafeEqual` after length-safe buffer checks.

- [ ] **Step 3: Add Fastify raw-body route handling**

Register a content-type parser or route-specific raw body handling so `POST /webhooks/shopify` verifies the exact raw payload before JSON parsing.

- [ ] **Step 4: Persist verified events idempotently**

Insert into `ShopifyWebhookEvent` with unique `(shopId, webhookId)`. Duplicate delivery should return `200` without reprocessing.

- [ ] **Step 5: Run verification**

```bash
npm run test -- tests/shopify-webhook-verifier.test.ts tests/shopify-webhook.routes.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

Intent line example:

```text
Trust Shopify events only after raw-body signature verification
```

## Task 4: Implement Admin GraphQL order sync client and mapper

**Files:**
- Create: `src/modules/shopify/admin-graphql.client.ts`
- Create: `src/modules/shopify/order-sync.service.ts`
- Create: `src/modules/shopify/order.mapper.ts`
- Create: `src/modules/orders/order.repository.ts`
- Create: `src/modules/delivery-stops/delivery-stop.repository.ts`
- Create: `tests/order.mapper.test.ts`
- Modify: `src/modules/shopify/webhook-event.repository.ts`

- [ ] **Step 1: Write mapper tests**

Seed representative Admin GraphQL order payloads:

- order with shipping address creates one delivery stop;
- cancelled order maps delivery status to `cancelled`;
- order without shippable address is stored but creates no routable stop;
- repeated sync updates same order/stop instead of duplicating.

- [ ] **Step 2: Implement GraphQL client**

Use `SHOPIFY_API_VERSION=2026-04`, offline access token from `shops`, JSON POST to `/admin/api/${version}/graphql.json`, response error handling, and throttle metadata logging.

- [ ] **Step 3: Implement order fetch and upsert**

Worker behavior:

1. Read `received` webhook events.
2. Mark `processing`.
3. Fetch canonical order by GID when topic is order/fulfillment related.
4. Upsert `orders` and `delivery_stops` transactionally.
5. Mark `processed` or `failed` with `attemptCount` and `lastError`.

- [ ] **Step 4: Add reconciliation service**

Add a method that syncs orders by `updated_at` window for missed webhook recovery.

- [ ] **Step 5: Run verification**

```bash
npm run test -- tests/order.mapper.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

Intent line example:

```text
Reconcile Shopify webhooks through canonical order reads
```

## Task 5: Implement route optimization MVP

**Files:**
- Create: `src/modules/routes/route-optimizer.ts`
- Create: `src/modules/routes/route-plan.repository.ts`
- Create: `tests/route-optimizer.test.ts`

- [ ] **Step 1: Write deterministic optimizer tests**

Test cases:

- nearest-neighbor sequence is stable for fixed depot/stops;
- stops without coordinates are returned as `unroutable`;
- higher priority stops are considered before normal priority groups;
- output metrics include distance estimate and optimizer version.

- [ ] **Step 2: Implement Haversine distance helper**

Keep it dependency-free and deterministic.

- [ ] **Step 3: Implement optimizer**

Inputs:

- depot latitude/longitude;
- candidate stops with IDs, coordinates, priority, service minutes;
- max stops cap.

Outputs:

- ordered stop IDs;
- unroutable stop IDs;
- metrics JSON;
- optimizer version string.

- [ ] **Step 4: Persist route plans**

Create `route_plans` and `route_plan_stops` in one transaction.

- [ ] **Step 5: Run verification**

```bash
npm run test -- tests/route-optimizer.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

Intent line example:

```text
Provide deterministic routing before adopting a distance provider
```

## Task 6: Add Admin/internal API endpoints

**Files:**
- Create: `src/routes/admin.routes.ts`
- Create: `src/plugins/auth.ts`
- Create: `docs/api/admin-api.md`
- Modify: `src/app.ts`

- [ ] **Step 1: Write route tests for authorization and happy paths**

Endpoints to cover:

- `GET /admin/orders`
- `POST /admin/sync/orders`
- `GET /admin/delivery-stops`
- `POST /admin/route-plans/:id/optimize`
- `GET /admin/drivers`
- `GET /admin/vehicles`

- [ ] **Step 2: Implement admin bearer-token guard**

Use `CLEVER_ADMIN_API_TOKEN` for MVP. Keep the auth plugin isolated so embedded app session auth can replace it later.

- [ ] **Step 3: Register admin routes**

Return stable JSON response envelopes:

```json
{
  "data": {},
  "error": null
}
```

- [ ] **Step 4: Document API contract**

`docs/api/admin-api.md` should describe auth, endpoints, request/response shapes, and status codes.

- [ ] **Step 5: Run verification**

```bash
npm run test -- tests/admin-api.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

Intent line example:

```text
Expose delivery operations through a replaceable internal API guard
```

## Task 7: Add Driver API skeleton and event ingestion

**Files:**
- Create: `src/routes/driver.routes.ts`
- Create: `src/modules/drivers/driver-auth.service.ts`
- Create: `src/modules/drivers/driver-event.service.ts`
- Create: `src/modules/drivers/driver.repository.ts`
- Create: `src/modules/vehicles/vehicle.repository.ts`
- Create: `tests/driver-api.test.ts`
- Create: `docs/api/driver-api.md`
- Modify: `src/app.ts`

- [ ] **Step 1: Write Driver API tests**

Test cases:

- unauthenticated driver routes return `401`;
- valid login issues access and refresh tokens;
- `GET /driver/routes/current` returns assigned route;
- posting a `stop_delivered` event records a driver event and updates stop status;
- duplicate `clientEventId` does not duplicate events.

- [ ] **Step 2: Implement MVP driver auth**

Use short-lived JWT access tokens and hashed refresh tokens stored in `driver_sessions`. Store only hashes for refresh tokens.

- [ ] **Step 3: Implement route/status/location endpoints**

Endpoints:

- `POST /driver/auth/login`
- `POST /driver/auth/refresh`
- `GET /driver/me`
- `GET /driver/routes/current`
- `POST /driver/routes/:routePlanId/events`
- `POST /driver/stops/:deliveryStopId/status`
- `POST /driver/location`

- [ ] **Step 4: Document Driver API contract**

`docs/api/driver-api.md` should state that the driver app never calls Shopify directly.

- [ ] **Step 5: Run verification**

```bash
npm run test -- tests/driver-api.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

Intent line example:

```text
Keep driver workflows behind a Shopify-isolated API boundary
```

## Task 8: Add Docker Compose, EC2/EBS runbook, and backup scripts

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `scripts/backup-postgres.sh`
- Create: `scripts/restore-postgres.sh`
- Create: `docs/deploy/ec2-ebs-runbook.md`
- Modify: `.env.example`

- [ ] **Step 1: Write Compose smoke checklist**

Document expected local smoke:

```bash
cp .env.example .env
# edit .env with local-only secret values before starting compose
docker compose up --build
curl -f http://localhost:3000/healthz
curl -f http://localhost:3000/readyz
```

- [ ] **Step 2: Add Dockerfile**

Use multi-stage build:

1. install dependencies;
2. generate Prisma client;
3. build TypeScript;
4. run compiled server as non-root user.

- [ ] **Step 3: Add Docker Compose services**

Services:

- `app`
- `postgres`
- optional `nginx` profile or documented host Nginx handoff

Mount PostgreSQL data to `/mnt/clever-delivery-postgres/data` for EC2/EBS deployment.

- [ ] **Step 4: Add backup/restore scripts**

`backup-postgres.sh` should create a timestamped custom-format `pg_dump` artifact and prune by retention days. `restore-postgres.sh` should restore a named dump into the configured database after explicit operator confirmation.

- [ ] **Step 5: Write EC2/EBS runbook**

Include EBS mount, Docker Compose startup, Nginx/TLS, backup, restore, and RDS migration steps.

- [ ] **Step 6: Run verification**

```bash
npm run build
docker compose config
git diff --check
```

- [ ] **Step 7: Commit**

Intent line example:

```text
Make the first EC2 deployment recoverable before launch
```

## Task 9: Add final workspace checks and PR evidence

**Files:**
- Modify: `.github/PULL_REQUEST_TEMPLATE.md` only if new evidence fields are needed
- Modify: `README.md`
- Modify: `docs/project-brief.md` only if implemented contracts differ from current brief

- [ ] **Step 1: Run required validation**

```bash
npm run check:workspace
npm run lint
npm run typecheck
npm run build
npm run test
git diff --check
```

- [ ] **Step 2: Run Docker smoke if Docker is available**

```bash
docker compose up --build -d
curl -f http://localhost:3000/healthz
curl -f http://localhost:3000/readyz
docker compose down
```

- [ ] **Step 3: Check context-monorepo update need**

Because this implementation creates public API/deploy/runtime contracts, update or create service context in:

```text
clever-context-monorepo/docs/services/clever-delivery-server/index.md
```

If the context repo has no service page yet, create one in a separate context-doc issue/branch or include it in the implementation PR only if AGENTS.md for that repo permits the same scope.

- [ ] **Step 4: Open PR to `dev`**

PR body must include:

- target issue;
- change-control issue;
- linked branch;
- Concurrent Work Gate decision;
- PR Scope Grouping Gate decision;
- validation results;
- context/wiki update result.

- [ ] **Step 5: After merge, clean branch**

Follow AGENTS.md branch cleanup sequence from `dev`.

## Acceptance criteria

- [ ] API server builds and starts locally.
- [ ] PostgreSQL schema includes shops, Shopify webhook events, orders, delivery stops, route plans, route plan stops, drivers, driver sessions, vehicles, and driver events.
- [ ] Shopify webhook endpoint verifies HMAC on raw body and is idempotent.
- [ ] Order sync can upsert a Shopify order and normalized delivery stop from mocked Admin GraphQL payload.
- [ ] Route optimizer produces deterministic route plans and metrics.
- [ ] Driver API can authenticate, read assigned route, and submit delivery/location events without Shopify access.
- [ ] Docker Compose starts app + PostgreSQL.
- [ ] Backup script creates a non-empty PostgreSQL dump artifact.
- [ ] Required validation commands pass or unresolved environment gaps are documented in the PR.

## Risks and mitigations

- **Shopify token ownership unclear:** isolate token storage and document embedded-app handoff before implementing OAuth-specific behavior.
- **Webhook raw body parser regression:** keep dedicated tests that fail if JSON parsing mutates the body before HMAC verification.
- **Prisma partial index limitations:** use generated SQL migrations for partial unique indexes that Prisma schema cannot express clearly.
- **Route quality limited without provider:** label optimizer version and metrics clearly; later provider can replace distance estimation behind an interface.
- **Single EC2 operational risk:** make backup/restore and RDS migration path part of MVP readiness, not a post-launch afterthought.

## Sources checked on 2026-05-07

- Shopify API versioning: https://shopify.dev/docs/api/usage/versioning
- Shopify webhook overview and headers: https://shopify.dev/docs/apps/webhooks
- Shopify HTTPS webhook HMAC validation: https://shopify.dev/docs/apps/build/webhooks/subscribe/https
- Shopify webhook subscription mutation: https://shopify.dev/docs/api/admin-graphql/latest/mutations/webhookSubscriptionCreate
- Shopify Admin GraphQL order query: https://shopify.dev/docs/api/admin-graphql/latest/queries/order
- Shopify Admin GraphQL rate limits: https://shopify.dev/docs/api/usage/limits
- Shopify Admin GraphQL bulk operations: https://shopify.dev/api/usage/bulk-operations/queries
- Fastify TypeScript reference: https://fastify.dev/docs/latest/Reference/TypeScript/
- Prisma index guidance: https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes
