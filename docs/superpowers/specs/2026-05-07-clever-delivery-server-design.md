# clever-delivery-server MVP Design

## Status

- Planning issue: EVNSolution/clever-delivery-server#4
- Change-control issue: EVNSolution/clever-change-control#100
- Root project-start: EVNSolution/clever-change-control#99
- Linked branch: `cc-100-mvp-plan`
- Scope: design and implementation planning only; no server source implementation in this document change.

## Goal

Build a separate Shopify companion delivery data server that stores delivery-operational data in PostgreSQL, syncs Shopify orders through webhooks and Admin GraphQL, exposes a stable Driver API for delivery apps, and can run first on one AWS EC2 instance with an encrypted EBS-backed PostgreSQL volume.

## Non-goals for MVP

- No DB-only EC2 phase.
- No immediate RDS or Aurora dependency before operational need justifies it.
- No full vehicle-routing-problem solver with traffic, every capacity constraint, and hard time windows in the first pass.
- No direct Shopify API access from the delivery driver app.
- No production deployment during the planning issue.

## Recommended architecture

Use a modular Node.js/TypeScript API server with Fastify, Prisma, and PostgreSQL.

```text
Shopify Admin / Embedded App
        |
        | Admin API calls to this backend
        v
clever-delivery-server (Fastify + TypeScript)
  |-- Shopify webhook HTTPS endpoint
  |-- Shopify Admin GraphQL client
  |-- Admin/internal API for operations UI
  |-- Driver API for delivery mobile clients
  |-- Route optimization service
  |-- Prisma repositories
        |
        v
PostgreSQL on encrypted EBS volume
```

### Why Fastify over Express for this service

- Fastify has first-class TypeScript reference material and a typed content-type parser surface, which matters for Shopify webhook raw-body handling.
- Fastify's `inject` test helper supports fast HTTP route tests without binding real ports.
- The server is API-first, not page-rendering-first, so a lean HTTP framework is enough.

Express remains viable, but Fastify is the recommended default because webhook raw body parsing, typed route schemas, and route-level modularity are central to this service.

## Shopify integration design

### Admin GraphQL API version

Pin requests to Shopify Admin GraphQL API version `2026-04` for first implementation. As of 2026-05-07, Shopify's official versioning documentation shows `2026-04` as the current stable version released on April 1, 2026, with quarterly updates expected. The service should keep this in `SHOPIFY_API_VERSION` and schedule quarterly review.

### OAuth/token storage assumption

The companion server needs an offline Admin API access token per shop. MVP can store encrypted access tokens in PostgreSQL using an application-level encryption key from the environment.

Recommended table responsibility:

- `shops.accessTokenCiphertext`: encrypted offline token.
- `shops.shopDomain`: `{shop}.myshopify.com`, unique.
- `shops.apiVersion`: pinned version used by this server.
- `shops.installedAt` / `shops.uninstalledAt`: lifecycle state.

If the embedded Shopify app already owns OAuth, the first integration should define a server-to-app handoff route or shared install callback contract before implementation.

### Webhook topics

MVP should subscribe to these topics first:

- `ORDERS_CREATE`
- `ORDERS_UPDATED`
- `ORDERS_CANCELLED`
- `FULFILLMENTS_CREATE`
- `FULFILLMENTS_UPDATE`
- `APP_UNINSTALLED`
- Optional for large backfills: `BULK_OPERATIONS_FINISH`

Shopify supports webhook subscription creation through the GraphQL Admin mutation `webhookSubscriptionCreate`; app-specific subscriptions can also be managed through app configuration when that fits the app architecture.

### Webhook HMAC verification

The webhook endpoint must verify Shopify HTTPS webhooks before JSON parsing or persistence:

1. Read the raw request body bytes.
2. Get `X-Shopify-Hmac-Sha256` case-insensitively from headers.
3. Compute HMAC-SHA256 over the raw body using the Shopify app client secret.
4. Base64 encode the digest.
5. Compare with a constant-time comparison.
6. Reject failed verification with `401` and do not persist event data.

Persist verified events idempotently using `X-Shopify-Webhook-Id` and, when present, `X-Shopify-Event-Id`. The HTTP handler should acknowledge quickly after durable insert; processing can continue in a background worker loop inside the same server process for MVP.

### Order sync strategy

Use webhook-first ingestion plus reconciliation:

- Webhooks create durable work items in `shopify_webhook_events`.
- Worker fetches canonical order details from Admin GraphQL by order GID before upserting normalized tables.
- Incremental reconciliation runs by `updated_at` window to catch missed webhooks.
- Bulk operations are reserved for initial import or large re-syncs because Shopify documents bulk query workflows for large datasets and JSONL result downloads.

For normal sync calls, the GraphQL client must read cost/throttle metadata and back off gracefully. Shopify's Admin GraphQL API uses calculated query cost limits, with standard shops documented at 100 points/second.

## Data model design

Use UUID primary keys internally and store Shopify GIDs as external identifiers. All tenant-owned tables include `shopId`.

### Core tables

#### `shops`

Stores Shopify tenant/install metadata.

Key fields:

- `id uuid pk`
- `shopDomain text unique not null`
- `shopifyShopGid text unique`
- `apiVersion text not null`
- `accessTokenCiphertext text not null`
- `installedAt timestamptz not null`
- `uninstalledAt timestamptz`
- `createdAt`, `updatedAt`

#### `shopify_webhook_events`

Durable inbound event ledger and work queue.

Key fields:

- `id uuid pk`
- `shopId uuid fk shops`
- `webhookId text not null`
- `eventId text`
- `topic text not null`
- `apiVersion text`
- `triggeredAt timestamptz`
- `rawBodySha256 text not null`
- `payload jsonb not null`
- `status enum(received, processing, processed, failed, ignored)`
- `attemptCount int default 0`
- `lastError text`
- `receivedAt`, `processedAt`

Indexes/constraints:

- unique `(shopId, webhookId)`
- index `(shopId, topic, receivedAt)`
- index `(status, receivedAt)` for worker polling

#### `orders`

Canonical Shopify order projection for delivery operations.

Key fields:

- `id uuid pk`
- `shopId uuid fk shops`
- `shopifyOrderGid text not null`
- `shopifyOrderLegacyId bigint`
- `name text not null`
- `email text`
- `phone text`
- `financialStatus text`
- `fulfillmentStatus text`
- `cancelledAt timestamptz`
- `processedAt timestamptz`
- `updatedAtShopify timestamptz`
- `totalPriceAmount decimal(12,2)`
- `currencyCode text`
- `shippingAddress jsonb`
- `rawPayload jsonb not null`
- `deliveryStatus enum(pending, ready, assigned, out_for_delivery, delivered, failed, cancelled)`
- `createdAt`, `updatedAt`

Indexes/constraints:

- unique `(shopId, shopifyOrderGid)`
- index `(shopId, name)`
- index `(shopId, deliveryStatus, processedAt)`

#### `delivery_stops`

Normalized delivery unit generated from order shipping data.

Key fields:

- `id uuid pk`
- `shopId uuid fk shops`
- `orderId uuid fk orders`
- `recipientName text`
- `phone text`
- `address1`, `address2`, `city`, `province`, `postalCode`, `countryCode`
- `latitude decimal(10,7)`
- `longitude decimal(10,7)`
- `geocodeStatus enum(not_required, pending, resolved, failed)`
- `deliveryDate date`
- `timeWindowStart timestamptz`
- `timeWindowEnd timestamptz`
- `serviceMinutes int default 5`
- `priority int default 0`
- `instructions text`
- `status enum(pending, assigned, en_route, arrived, delivered, failed, skipped, cancelled)`
- `createdAt`, `updatedAt`

Indexes/constraints:

- index `(shopId, deliveryDate, status)`
- index `(shopId, orderId)`

#### `route_plans`

Route batch for one shop/date/driver/vehicle assignment.

Key fields:

- `id uuid pk`
- `shopId uuid fk shops`
- `planDate date not null`
- `status enum(draft, optimized, assigned, in_progress, completed, cancelled)`
- `driverId uuid fk drivers nullable`
- `vehicleId uuid fk vehicles nullable`
- `depotLatitude decimal(10,7)`
- `depotLongitude decimal(10,7)`
- `optimizerVersion text not null`
- `constraints jsonb not null`
- `metrics jsonb not null`
- `createdBy text`
- `createdAt`, `updatedAt`

Indexes:

- index `(shopId, planDate, status)`
- index `(shopId, driverId, status)`

#### `route_plan_stops`

Join table that stores stop sequence inside a route plan.

Key fields:

- `id uuid pk`
- `routePlanId uuid fk route_plans`
- `deliveryStopId uuid fk delivery_stops`
- `sequence int not null`
- `estimatedArrivalAt timestamptz`
- `distanceFromPreviousMeters int`
- `durationFromPreviousSeconds int`
- `createdAt`, `updatedAt`

Constraints:

- unique `(routePlanId, sequence)`
- unique `(routePlanId, deliveryStopId)`

#### `drivers`

Delivery worker identity controlled by this server.

Key fields:

- `id uuid pk`
- `shopId uuid fk shops`
- `displayName text not null`
- `phone text`
- `status enum(active, inactive, suspended)`
- `authSubject text unique`
- `lastSeenAt timestamptz`
- `createdAt`, `updatedAt`

#### `driver_sessions`

MVP simple auth session for Driver API. Managed identity can replace this later without changing route/stop/event tables.

Key fields:

- `id uuid pk`
- `driverId uuid fk drivers`
- `refreshTokenHash text unique not null`
- `expiresAt timestamptz not null`
- `revokedAt timestamptz`
- `createdAt`, `lastUsedAt`

#### `vehicles`

Delivery vehicle registry.

Key fields:

- `id uuid pk`
- `shopId uuid fk shops`
- `label text not null`
- `licensePlate text`
- `vehicleType enum(car, van, truck, bike, scooter, other)`
- `capacityUnits int default 0`
- `status enum(active, inactive, maintenance)`
- `createdAt`, `updatedAt`

Indexes:

- unique `(shopId, licensePlate)` where license plate is present; if Prisma cannot express the partial unique index cleanly, add it through SQL migration.

#### `driver_events`

Append-only driver telemetry and delivery status history.

Key fields:

- `id uuid pk`
- `shopId uuid fk shops`
- `driverId uuid fk drivers`
- `routePlanId uuid fk route_plans nullable`
- `deliveryStopId uuid fk delivery_stops nullable`
- `clientEventId text`
- `eventType enum(route_started, route_paused, route_completed, stop_arrived, stop_delivered, stop_failed, location_updated, note_added)`
- `occurredAt timestamptz not null`
- `latitude decimal(10,7)`
- `longitude decimal(10,7)`
- `payload jsonb not null`
- `createdAt timestamptz not null`

Constraints/indexes:

- unique `(driverId, clientEventId)` for idempotent mobile retries when `clientEventId` is supplied.
- index `(shopId, routePlanId, occurredAt)`
- index `(shopId, deliveryStopId, occurredAt)`

## Route optimization MVP

Use a deterministic heuristic, not a paid routing/geocoding provider, in the first pass:

1. Filter candidate `delivery_stops` by shop/date/status and require coordinates.
2. Keep stops without coordinates in a separate `unroutable` list.
3. Start from a configured depot coordinate.
4. Sort by priority and nearest-neighbor distance using Haversine distance.
5. Apply a small 2-opt improvement pass when stop count is below a configured cap.
6. Write `route_plans`, `route_plan_stops`, metrics, and optimizer version.

MVP route metrics:

- stop count
- unroutable stop count
- estimated straight-line distance meters
- optimization duration milliseconds
- optimizer version

This gives deterministic tests and operational value without locking the project into a routing provider. Later provider integration can replace distance/duration estimation behind a `DistanceMatrixProvider` interface.

## API design

### Health and readiness

- `GET /healthz`: process is alive.
- `GET /readyz`: database connection and required configuration are valid.

### Shopify webhook endpoint

- `POST /webhooks/shopify`
  - Auth: Shopify HMAC only.
  - Reads raw body.
  - Persists idempotent event.
  - Returns `200` after durable insert or duplicate recognition.
  - Returns `401` for HMAC failure.

### Admin/internal API

Initial protection: `Authorization: Bearer <CLEVER_ADMIN_API_TOKEN>` or integration with the embedded app's authenticated backend call once the Shopify app contract is confirmed.

- `GET /admin/orders`
- `POST /admin/sync/orders`
- `GET /admin/delivery-stops`
- `PATCH /admin/delivery-stops/:id`
- `GET /admin/route-plans`
- `POST /admin/route-plans`
- `POST /admin/route-plans/:id/optimize`
- `POST /admin/route-plans/:id/assign`
- `GET /admin/drivers`
- `POST /admin/drivers`
- `GET /admin/vehicles`
- `POST /admin/vehicles`

### Driver API

Drivers never call Shopify. They call only this server.

- `POST /driver/auth/login`
- `POST /driver/auth/refresh`
- `GET /driver/me`
- `GET /driver/routes/current`
- `GET /driver/routes/:routePlanId`
- `POST /driver/routes/:routePlanId/events`
- `POST /driver/stops/:deliveryStopId/status`
- `POST /driver/location`

MVP auth: short-lived driver JWT plus hashed refresh token in `driver_sessions`. Managed identity can replace the token issuer later.

## Deployment design: EC2 + EBS PostgreSQL

### Runtime layout

- One EC2 instance.
- Docker Compose services:
  - `app`: Node/TypeScript compiled server.
  - `postgres`: PostgreSQL with data directory mounted from encrypted EBS.
  - `nginx`: reverse proxy/TLS termination, either Compose-managed or host-managed.
- PostgreSQL data mount: `/mnt/clever-delivery-postgres/data`.
- Backup mount/path: `/mnt/clever-delivery-backups`.

### Environment categories

- App runtime: `NODE_ENV`, `PORT`, `LOG_LEVEL`, `PUBLIC_BASE_URL`.
- Database: `DATABASE_URL`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`.
- Shopify: `SHOPIFY_API_VERSION`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, token encryption key.
- Auth: admin API token, driver JWT secret, refresh token pepper.
- Routing: depot coordinates, route max stops, optional provider keys for later.
- Backup: retention days, optional S3 bucket/prefix for off-instance backup.

### Backup/restore

MVP backup:

- Nightly `pg_dump` custom-format backup to EBS backup path.
- Keep local rolling retention.
- Optionally sync encrypted backup artifacts to S3 when bucket is provisioned.
- Log backup result and size.

Restore drill:

1. Stop app writes.
2. Restore dump into clean PostgreSQL database using `pg_restore`.
3. Run Prisma migrations if needed.
4. Start app.
5. Run `/readyz` and a read-only order query smoke.

### RDS migration path

1. Provision RDS PostgreSQL with matching major version.
2. Snapshot/backup EC2 PostgreSQL.
3. Restore into RDS with `pg_restore` or controlled logical dump.
4. Run migration validation against RDS.
5. Update `DATABASE_URL` secret.
6. Restart app and run smoke checks.
7. Keep EC2 PostgreSQL read-only until rollback window closes.

## Verification plan

### Unit tests

- HMAC verification accepts a known valid signature and rejects tampering.
- Header casing does not affect webhook verification.
- Order mapper is deterministic and idempotent.
- Route optimizer returns stable stop sequence for seeded coordinates.
- Driver event validation rejects invalid state transitions.

### Integration tests

- Prisma schema applies to PostgreSQL test database.
- Webhook endpoint stores exactly one event on duplicate `webhookId`.
- Worker upserts order and delivery stop from mocked Admin GraphQL order payload.
- Admin route-plan optimize endpoint writes route plan and route stop sequence.
- Driver API records status/location events and updates stop status.

### Smoke checks

- `docker compose up` starts app + PostgreSQL.
- `/healthz` returns OK.
- `/readyz` confirms database readiness.
- Shopify webhook test delivery is accepted only with valid HMAC.
- Backup command creates a non-empty dump artifact.

## ADR

### Decision

Implement MVP as a modular Fastify + TypeScript + Prisma service on EC2 with EBS-backed PostgreSQL, webhook-first Shopify ingestion, Admin GraphQL reconciliation, deterministic route optimization, and a server-owned Driver API.

### Drivers

- Keep driver apps isolated from Shopify credentials and rate limits.
- Make delivery state queryable and auditable in PostgreSQL.
- Start with a simple EC2/EBS footprint while preserving an RDS migration path.
- Keep route optimization deterministic and testable before adding paid providers.

### Alternatives considered

1. **Embedded Shopify app only, no companion server**
   - Rejected because driver apps would either need Shopify access or the embedded app would become an overloaded proxy without durable delivery state.
2. **Immediate RDS deployment**
   - Rejected for MVP because project constraints choose EC2 + EBS first, with RDS after operational demand grows.
3. **Full routing provider integration first**
   - Rejected because geocoding/provider choice is still open and deterministic MVP routing is enough to validate data flow and APIs.
4. **Express instead of Fastify**
   - Viable, but not recommended because Fastify's typed parser and route test surfaces are better aligned with this API-only service.

### Consequences

- The first implementation must include robust raw-body handling before any generic JSON body parser touches Shopify webhook requests.
- Prisma migrations should be treated as part of the service contract from the first scaffold.
- Route plans need a join table to keep route sequence auditable.
- The embedded Shopify app integration contract remains a follow-up interface decision.

### Follow-ups

- Confirm how the embedded Shopify app transfers or shares offline Admin API tokens.
- Choose whether admin/internal APIs use a temporary admin token or app-authenticated service calls in the first deploy.
- Decide when a geocoding/distance provider becomes necessary.
- Add service context documentation to `clever-context-monorepo` after public API/deploy contracts are implemented.

## References checked on 2026-05-07

- Shopify API versioning: https://shopify.dev/docs/api/usage/versioning
- Shopify webhook overview and headers: https://shopify.dev/docs/apps/webhooks
- Shopify HTTPS webhook HMAC validation: https://shopify.dev/docs/apps/build/webhooks/subscribe/https
- Shopify webhook subscriptions: https://shopify.dev/docs/api/admin-graphql/latest/mutations/webhookSubscriptionCreate
- Shopify Admin GraphQL order query/object guidance: https://shopify.dev/docs/api/admin-graphql/latest/queries/order
- Shopify Admin GraphQL rate limits: https://shopify.dev/docs/api/usage/limits
- Shopify Admin GraphQL bulk operations: https://shopify.dev/api/usage/bulk-operations/queries
- Fastify TypeScript/content parser reference: https://fastify.dev/docs/latest/Reference/TypeScript/
- Prisma index/reference guidance: https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes
