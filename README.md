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
- Shopify session-token verifier, token-exchange client, API route, and env-driven runtime wiring
- Shopify HTTPS webhook HMAC verifier, receive route, and idempotent receipt-storage contract
- Shopify Admin GraphQL client plus order-sync query/mapper/service foundation
- Driver API bearer-token verifier, route+phone access lookup, consent persistence, assigned route read, proof-media upload metadata/storage/scan hook, and idempotent driver-event ingest route

Shopify webhook order processing, live Admin GraphQL sync validation, route optimization, driver login/session issuance APIs, stop-detail/action APIs, production object-store/retention/scanner deployment hardening for proof media, dedicated location access/usage logging, and live EC2/EBS deployment work are intentionally left for follow-up issue-linked branches.

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

Docker/Compose runtime preparation:

```bash
docker compose config
docker compose up --build
```

See `docs/deployment/ec2-ebs.md` for EC2/EBS deployment, backup/restore, and RDS migration-path notes.

## Repository governance

- Contribution flow: `CONTRIBUTING.md`
- Security reporting and data-handling expectations: `SECURITY.md`
- Product scope and release constraints: `docs/project-brief.md`
- Agent workflow rules: `AGENTS.md`

## Database schema

The repository now includes the first Prisma/PostgreSQL schema at `prisma/schema.prisma`.

The `Shop` model is prepared for automatic Shopify app/token connection flows:

- `shopDomain` uniquely identifies the Shopify shop.
- `adminAccessTokenCiphertext` stores the encrypted Admin API access token.
- `adminAccessTokenExpiresAt`, `adminRefreshTokenCiphertext`, and `adminRefreshTokenExpiresAt` reserve space for expiring offline-token refresh flows.
- `tokenScopes` records the granted Admin API scopes.

Local schema validation does not require a running PostgreSQL server:

```bash
npm run prisma:generate
npm run prisma:validate
npm run prisma:format
```

Actual migration files and live PostgreSQL smoke validation are intentionally left for the follow-up DB/runtime branch.

## Shopify auth token exchange API readiness

Embedded Shopify apps can exchange App Bridge session tokens for Admin API access tokens. The first server-side route contract is now prepared for that flow:

```http
POST /shopify/auth/token-exchange
Authorization: Bearer <Shopify App Bridge session token>
Content-Type: application/json

{
  "shopDomain": "example.myshopify.com"
}
```

The route dependencies are injectable for tests. The production server registers the route when `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, and `SHOPIFY_TOKEN_ENCRYPTION_KEY` are configured. The route contract:

- rejects missing or invalid bearer session tokens;
- verifies Shopify JWT session-token signature and claims before accepting the request;
- exchanges the verified session token against Shopify's token-exchange endpoint;
- stores returned Admin API token metadata through the encrypted shop-token service;
- returns `{ tokenStored: true, shopDomain, tokenScopes }` without exposing token plaintext.

The storage foundation for the route includes:

- `loadShopifyTokenEncryptionKey()` reads `SHOPIFY_TOKEN_ENCRYPTION_KEY`.
- `encryptSecret()` / `decryptSecret()` use AES-256-GCM with associated shop context.
- `ShopTokenService.storeAdminApiToken()` encrypts access/refresh tokens and writes only ciphertext through the repository.
- `ShopTokenService.getAdminAccessToken()` decrypts the stored Admin API token for future Shopify Admin GraphQL calls.

Shopify app credentials used by this runtime route are represented in `.env.example`:

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_API_VERSION`
- `SHOPIFY_TOKEN_ENCRYPTION_KEY`

Generate a local encryption key with:

```bash
openssl rand -base64 32
```

Store it as:

```env
SHOPIFY_TOKEN_ENCRYPTION_KEY=base64:<generated-value>
```

Do not commit real Shopify Admin API tokens or production encryption keys.

## Shopify webhook receive API readiness

The server can also prepare to receive HTTPS-delivered Shopify webhooks:

```http
POST /shopify/webhooks
X-Shopify-Hmac-Sha256: <base64 HMAC>
X-Shopify-Topic: orders/create
X-Shopify-Shop-Domain: example.myshopify.com
X-Shopify-Webhook-Id: <uuid>
X-Shopify-Event-Id: <uuid>
X-Shopify-API-Version: 2026-04
Content-Type: application/json
```

The route is registered when `SHOPIFY_API_SECRET` is configured. It:

- verifies `X-Shopify-Hmac-Sha256` against the raw request body using the Shopify app secret;
- normalizes Shopify webhook headers case-insensitively through Fastify's header map;
- stores webhook receipt metadata with `rawBodySha256`, topic, shop domain, webhook ID, optional event ID, API version, and triggered timestamp;
- returns `202` for a newly recorded webhook and `200` for a duplicate receipt.

Webhook payload processing is not implemented yet. The current contract records receipt idempotently so later order-sync work can safely consume `orders/create`, `orders/updated`, and related topics.

## Shopify Admin GraphQL order sync foundation

The repository includes a credential-free foundation for pulling Shopify orders later:

- `ShopifyAdminGraphqlClient` posts to `https://{shop}/admin/api/{version}/graphql.json` with `X-Shopify-Access-Token`.
- `buildOrdersUpdatedSinceQuery()` creates a paginated `orders` query filtered by `updated_at`.
- `mapShopifyOrderNodeToDeliveryInputs()` maps Shopify order nodes into local `Order` and optional `DeliveryStop` write inputs.
- `ShopifyOrderSyncService.syncUpdatedOrdersPage()` fetches one page and persists each mapped order through an injectable repository.
- `PrismaOrderSyncRepository` upserts orders by `(shopId, shopifyOrderGid)` and delivery stops by `(shopId, orderId)`.

Live sync still requires an installed shop token in the `shops` table and a real Shopify store. By default Shopify order access is limited to recent orders unless the app has appropriate order scopes/access.

## Driver route access lookup API readiness

Driver clients should call this server, not Shopify Admin APIs directly. The first route+phone access contract is now prepared:

```http
POST /driver/route-access/lookup
Content-Type: application/json

{
  "routeContext": "<route-plan-id-uuid-or-shared-route-scope>",
  "phoneE164": "+14165550123"
}
```

The route is registered when `JWT_SECRET` is configured with the Driver API runtime. It validates that route context and E.164 phone are present before lookup, then checks the existing shop/route plan/assigned driver boundary. A matched active driver receives non-sensitive company guidance, `nextState: "consent_required"`, and a 900-second `driverAccess` bearer token for consent and assigned-route calls.

`routeContext` may be an exact `RoutePlan.id` UUID or a shared company/route scope stored at `RoutePlan.constraints.routeScope.routeScopeKey`. A shared scope with one active phone match resolves to the concrete route plan id. A shared scope with multiple active phone matches returns `MULTIPLE_MATCHES` with only company/route display context and a dispatch resolution hint; it does not include `driverAccess`, `driverContext`, `routeAccess`, `routePlanId`, stops, customer addresses, coordinates, order data, or proof data. Missing route, phone mismatch, inactive driver, and suspended driver responses also omit tokens, stop/customer/location details, and driver internals.

See `docs/api/driver-route-access.md` for the response contract and minimization notes.

## Driver consent API readiness

After a matched route+phone lookup returns `nextState: "consent_required"`, driver clients can persist required notice acceptance before requesting assigned route details:

```http
POST /driver/consents
Authorization: Bearer <server-issued driver JWT>
Content-Type: application/json

{
  "routeContext": "<route-plan-id-uuid>",
  "recordedAt": "2026-05-12T05:50:00.000Z",
  "deviceContext": { "platform": "ios" },
  "appContext": { "appVersion": "0.1.0" },
  "consents": [
    { "type": "LOCATION_INFORMATION", "version": "location-v1", "accepted": true },
    { "type": "PERSONAL_INFORMATION", "version": "privacy-v1", "accepted": true }
  ]
}
```

The route is registered when `JWT_SECRET` is configured. It verifies the Driver API bearer token, records consent rows under the token driver/shop boundary, and returns only `CONSENT_RECORDED` evidence. It does not return route stops, customer addresses, coordinates, or order data.

See `docs/api/driver-consents.md` for the request/response contract, persistence model, and minimization notes.

## Driver assigned route API readiness

After consent is recorded, driver clients can read the route assigned to the bearer-token driver:

```http
GET /driver/assigned-route?routeContext=<route-plan-id-uuid>
Authorization: Bearer <server-issued driver JWT>
```

The route is registered when `JWT_SECRET` is configured. It verifies the Driver API bearer token, scopes the read by token shop and driver, optionally binds the read to `routeContext`, and returns either `ASSIGNED_ROUTE` with ordered stop context or `NO_ASSIGNED_ROUTE`. Unlike route access lookup and consent submission, this response can include stop addresses and coordinates after the driver boundary is verified.

See `docs/api/driver-assigned-route.md` for the response contract, data boundary, and compliance notes.


## Driver proof media API readiness

The native driver app can upload proof photos before sending stop-completion proof events:

```http
POST /driver/proof-media
Authorization: Bearer <server-issued driver JWT>
Content-Type: multipart/form-data
```

Fields are `deliveryStopId`, `routePlanId`, `source` (`camera` or `library`), and image `file`. The route verifies the Driver API bearer token, validates multipart image payloads, checks that the route/stop belongs to the token driver/shop boundary, strips JPEG EXIF APP1 metadata before persistence, runs an optional `DriverProofMediaScanner` hook on sanitized bytes before storage, writes accepted bytes through the proof-media storage backend, and stores `DriverProofMedia` metadata with `storageKey`, sanitized `sizeBytes`, and sanitized `sha256`. Scanner rejections return `422 PROOF_MEDIA_REJECTED` without storing bytes or metadata. The default backend writes under `DRIVER_PROOF_MEDIA_STORAGE_DIR` (default `var/driver-proof-media`). Cleanup jobs can use `DRIVER_PROOF_MEDIA_RETENTION_DAYS` (default 180) and `deleteExpiredProofMedia()` to remove expired local bytes and mark metadata with `deletedAt`; production object storage, signed retrieval/access, scanner integration evidence, and private evidence storage remain hardening work.

Manual or cron-style cleanup command:

```bash
npm run driver:proof-media:cleanup
```

The command prints JSON with `scanned`, `deleted`, `missingFiles`, `uploadedBefore`, and `deletedAt`.

See `docs/api/driver-proof-media.md` for the request/response contract and production storage/retention caveats.

## Driver API event ingest readiness

Driver clients should call this server, not Shopify Admin APIs directly. The first Driver API event route is prepared as:

```http
POST /driver/events
Authorization: Bearer <server-issued driver JWT>
Content-Type: application/json

{
  "clientEventId": "mobile-event-1",
  "eventType": "LOCATION_UPDATED",
  "occurredAt": "2026-05-07T06:09:30.000Z",
  "routePlanId": "route-plan-id",
  "deliveryStopId": "stop-id",
  "latitude": 40.7128,
  "longitude": -74.006
}
```

The route is registered when `JWT_SECRET` is configured. It verifies HS256 bearer tokens with audience `clever-delivery-driver`, extracts driver/shop context, validates event payloads, and records driver events idempotently by `(driverId, clientEventId)`.

Driver login/session issuance, production proof-media object storage/access/scanner deployment and scheduled deployment evidence, stop action status mutation semantics, and dedicated location access/usage ledgers are still follow-up work.

## Project references

- `AGENTS.md` for agent execution rules
- `docs/project-brief.md` for project scope
- `docs/superpowers/specs/2026-05-07-clever-delivery-server-design.md` for initial design direction
