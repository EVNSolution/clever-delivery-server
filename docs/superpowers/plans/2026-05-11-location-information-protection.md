# Location Information Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auditable, documented, and retention-aware location information safeguards to `clever-delivery-server` without over-claiming controls that are not implemented.

**Architecture:** Introduce a small compliance/audit module around existing Fastify route dependencies and Prisma repositories. Keep location audit/usage records separate from operational order/driver tables, sanitize duplicated raw payload coordinates, and add a retention cleanup script that can be run manually first and scheduled later.

**Tech Stack:** Node 22, TypeScript, Fastify, Prisma, PostgreSQL, Vitest, ESLint, GitHub Actions EC2 deployment.

---

## Source and scope notes

Official references checked on 2026-05-11:

- 위치정보법 Article 16: https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=1001048442
- 위치정보법 시행령 Article 20: https://www.law.go.kr/LSW/lumLsLinkPop.do?chrClsCd=010202&lspttninfSeq=79542
- 위치정보의 관리적·기술적 보호조치 기준: https://law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000211939

Current implementation facts:

- Admin auth uses Shopify session token verification in `src/routes/admin-orders.routes.ts` and `src/routes/admin-route-plans.routes.ts`.
- Driver auth uses bearer JWT verification in `src/routes/driver-events.routes.ts`.
- Location-bearing DB columns exist in `DeliveryStop`, `RoutePlan`, and `DriverEvent` in `prisma/schema.prisma`.
- `Order.rawPayload` can duplicate source snapshot fields, including coordinates if present in the incoming app payload.
- The Shopify Admin GraphQL query no longer requests `email`, but `Order.email` and email search still exist for legacy/app-supplied values.

## File structure

Create:

- `src/modules/compliance/location-audit.types.ts` — enums and input types for audit/usage records.
- `src/modules/compliance/location-audit.repository.ts` — Prisma writes and retention cleanup queries.
- `src/modules/compliance/location-audit.service.ts` — safe fire-and-forget wrapper for route logging and usage records.
- `src/modules/compliance/location-audit.dependencies.ts` — dependency loader wiring for production server.
- `src/modules/compliance/location-retention.service.ts` — retention cleanup implementation.
- `scripts/location-retention-cleanup.ts` — manual retention cleanup entry point.
- `tests/location-audit.repository.test.ts` — repository writes and retention query tests.
- `tests/location-audit.service.test.ts` — service does not break API requests if audit insert fails.
- `tests/location-retention.service.test.ts` — coordinate nulling/deletion policy tests.
- `docs/compliance/evidence/location-protection/*.md` — evidence templates.

Modify:

- `prisma/schema.prisma` — add audit/usage/retention models and enums.
- `src/server.ts` — load compliance dependencies.
- `src/app.ts` — pass optional audit dependency to route modules.
- `src/routes/admin-orders.routes.ts` — log admin order location reads and sync writes.
- `src/routes/admin-route-plans.routes.ts` — log route plan location reads/creates.
- `src/routes/driver-events.routes.ts` — log driver location collection events.
- `src/modules/shopify/order-sync.repository.ts` — sanitize raw payload before storing and remove email from search.
- `src/modules/route-plans/route-plan.repository.ts` — avoid adding coordinates to route plan raw metadata; reuse timezone helper if extracted.
- `package.json` — add `location:retention:cleanup` script.
- `docs/deployment/ec2-ebs.md` — document retention command and evidence capture.
- `docs/compliance/location-data-handling.md` — update after implementation if actual field names change.

---

### Task 1: Add Prisma audit and usage-record models

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `tests/location-audit.repository.test.ts`

- [ ] **Step 1: Write failing model-shape tests**

Create `tests/location-audit.repository.test.ts` with this initial expectation against a Prisma mock:

```ts
import { describe, expect, test, vi } from 'vitest';

import { PrismaLocationAuditRepository } from '../src/modules/compliance/location-audit.repository.js';

describe('PrismaLocationAuditRepository', () => {
  test('records a location access log without storing coordinates in metadata', async () => {
    const create = vi.fn(() => Promise.resolve({ id: 'log-id' }));
    const repository = new PrismaLocationAuditRepository({
      locationAccessLog: { create },
      locationUsageRecord: { create: vi.fn() },
      retentionJobRun: { create: vi.fn(), update: vi.fn() }
    } as never);

    await repository.recordAccess({
      action: 'READ_ADMIN_ORDERS',
      actorId: 'shopify-user-id',
      actorType: 'ADMIN',
      ipAddress: '203.0.113.10',
      metadata: { orderCount: 2, latitude: 43.1, longitude: -79.1 },
      resourceId: null,
      resourceType: 'ORDER',
      result: 'SUCCESS',
      routeScopeKey: '2026-05-08|DELIVERY||',
      shopId: 'shop-id',
      userAgent: 'vitest'
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'READ_ADMIN_ORDERS',
        actorId: 'shopify-user-id',
        actorType: 'ADMIN',
        metadata: { orderCount: 2 },
        result: 'SUCCESS',
        shopId: 'shop-id'
      })
    });
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
npm test -- tests/location-audit.repository.test.ts
```

Expected: fail because `src/modules/compliance/location-audit.repository.ts` does not exist.

- [ ] **Step 3: Add Prisma enums and models**

Append near existing enums/models in `prisma/schema.prisma`:

```prisma
enum LocationActorType {
  ADMIN
  DRIVER
  SYSTEM
}

enum LocationAuditAction {
  SYNC_ORDERS
  READ_ADMIN_ORDERS
  CREATE_ROUTE_PLAN
  READ_ROUTE_PLAN
  RECORD_DRIVER_EVENT
  RUN_RETENTION_CLEANUP
}

enum LocationResourceType {
  ORDER
  DELIVERY_STOP
  ROUTE_PLAN
  DRIVER_EVENT
  SHOP
  SYSTEM
}

enum LocationAuditResult {
  SUCCESS
  DENIED
  ERROR
}

model LocationAccessLog {
  id            String               @id @default(uuid()) @db.Uuid
  shopId        String?              @db.Uuid
  shop          Shop?                @relation(fields: [shopId], references: [id], onDelete: SetNull)
  actorType     LocationActorType
  actorId       String?              @db.Text
  action        LocationAuditAction
  resourceType  LocationResourceType
  resourceId    String?              @db.Text
  routeScopeKey String?              @db.Text
  ipAddress     String?              @db.Text
  userAgent     String?              @db.Text
  result        LocationAuditResult
  metadata      Json
  occurredAt    DateTime             @default(now()) @db.Timestamptz(6)
  retentionUntil DateTime            @db.Timestamptz(6)

  @@index([shopId, occurredAt])
  @@index([actorType, actorId, occurredAt])
  @@index([action, occurredAt])
  @@index([retentionUntil])
  @@map("location_access_logs")
}

model LocationUsageRecord {
  id             String               @id @default(uuid()) @db.Uuid
  shopId         String?              @db.Uuid
  shop           Shop?                @relation(fields: [shopId], references: [id], onDelete: SetNull)
  actorType      LocationActorType
  actorId        String?              @db.Text
  action         LocationAuditAction
  subjectType    LocationResourceType
  subjectId      String?              @db.Text
  sourcePath     String               @db.Text
  purpose        String               @db.Text
  recipientType  String?              @db.Text
  recipientId    String?              @db.Text
  routeScopeKey  String?              @db.Text
  metadata       Json
  occurredAt     DateTime             @default(now()) @db.Timestamptz(6)
  retentionUntil DateTime             @db.Timestamptz(6)

  @@index([shopId, occurredAt])
  @@index([subjectType, subjectId, occurredAt])
  @@index([retentionUntil])
  @@map("location_usage_records")
}

model RetentionJobRun {
  id             String   @id @default(uuid()) @db.Uuid
  jobName        String   @db.Text
  status         String   @db.Text
  startedAt      DateTime @default(now()) @db.Timestamptz(6)
  finishedAt     DateTime? @db.Timestamptz(6)
  deletedCount   Int      @default(0)
  anonymizedCount Int     @default(0)
  errorMessage   String?  @db.Text
  metadata       Json

  @@index([jobName, startedAt])
  @@map("retention_job_runs")
}
```

Also add relation arrays to `Shop` if Prisma requires opposite relation fields:

```prisma
locationAccessLogs  LocationAccessLog[]
locationUsageRecords LocationUsageRecord[]
```

- [ ] **Step 4: Validate Prisma schema**

Run:

```bash
npm run prisma:generate
npm run prisma:validate
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma tests/location-audit.repository.test.ts
git commit -m "Add location audit data model"
```

---

### Task 2: Implement audit repository and safe metadata sanitizer

**Files:**
- Create: `src/modules/compliance/location-audit.types.ts`
- Create: `src/modules/compliance/location-audit.repository.ts`
- Test: `tests/location-audit.repository.test.ts`

- [ ] **Step 1: Define input types**

Create `src/modules/compliance/location-audit.types.ts`:

```ts
export type LocationActorType = 'ADMIN' | 'DRIVER' | 'SYSTEM';
export type LocationAuditAction =
  | 'SYNC_ORDERS'
  | 'READ_ADMIN_ORDERS'
  | 'CREATE_ROUTE_PLAN'
  | 'READ_ROUTE_PLAN'
  | 'RECORD_DRIVER_EVENT'
  | 'RUN_RETENTION_CLEANUP';
export type LocationResourceType = 'ORDER' | 'DELIVERY_STOP' | 'ROUTE_PLAN' | 'DRIVER_EVENT' | 'SHOP' | 'SYSTEM';
export type LocationAuditResult = 'SUCCESS' | 'DENIED' | 'ERROR';

export type RecordLocationAccessInput = {
  action: LocationAuditAction;
  actorId: string | null;
  actorType: LocationActorType;
  ipAddress: string | null;
  metadata: Record<string, unknown>;
  resourceId: string | null;
  resourceType: LocationResourceType;
  result: LocationAuditResult;
  routeScopeKey: string | null;
  shopId: string | null;
  userAgent: string | null;
};

export type RecordLocationUsageInput = {
  action: LocationAuditAction;
  actorId: string | null;
  actorType: LocationActorType;
  metadata: Record<string, unknown>;
  purpose: string;
  recipientId: string | null;
  recipientType: string | null;
  routeScopeKey: string | null;
  shopId: string | null;
  sourcePath: string;
  subjectId: string | null;
  subjectType: LocationResourceType;
};
```

- [ ] **Step 2: Implement repository**

Create `src/modules/compliance/location-audit.repository.ts`:

```ts
import type { Prisma, PrismaClient } from '@prisma/client';

import type { RecordLocationAccessInput, RecordLocationUsageInput } from './location-audit.types.js';

const ACCESS_LOG_RETENTION_DAYS = Number(process.env.LOCATION_ACCESS_LOG_RETENTION_DAYS ?? 400);
const USAGE_RECORD_RETENTION_DAYS = Number(process.env.LOCATION_USAGE_RECORD_RETENTION_DAYS ?? 215);

const SENSITIVE_METADATA_KEYS = new Set([
  'address',
  'address1',
  'address2',
  'email',
  'latitude',
  'longitude',
  'phone',
  'postalCode',
  'recipientName',
  'shippingAddress'
]);

type LocationAuditPrismaClient = Pick<PrismaClient, 'locationAccessLog' | 'locationUsageRecord' | 'retentionJobRun'>;

export class PrismaLocationAuditRepository {
  constructor(private readonly prisma: LocationAuditPrismaClient) {}

  recordAccess(input: RecordLocationAccessInput): Promise<{ id: string }> {
    return this.prisma.locationAccessLog.create({
      data: {
        action: input.action,
        actorId: input.actorId,
        actorType: input.actorType,
        ipAddress: input.ipAddress,
        metadata: toJson(sanitizeMetadata(input.metadata)),
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        result: input.result,
        retentionUntil: addDays(new Date(), ACCESS_LOG_RETENTION_DAYS),
        routeScopeKey: input.routeScopeKey,
        shopId: input.shopId,
        userAgent: input.userAgent
      }
    });
  }

  recordUsage(input: RecordLocationUsageInput): Promise<{ id: string }> {
    return this.prisma.locationUsageRecord.create({
      data: {
        action: input.action,
        actorId: input.actorId,
        actorType: input.actorType,
        metadata: toJson(sanitizeMetadata(input.metadata)),
        purpose: input.purpose,
        recipientId: input.recipientId,
        recipientType: input.recipientType,
        retentionUntil: addDays(new Date(), USAGE_RECORD_RETENTION_DAYS),
        routeScopeKey: input.routeScopeKey,
        shopId: input.shopId,
        sourcePath: input.sourcePath,
        subjectId: input.subjectId,
        subjectType: input.subjectType
      }
    });
  }
}

function sanitizeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !SENSITIVE_METADATA_KEYS.has(key))
  );
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
```

- [ ] **Step 3: Run repository test**

Run:

```bash
npm test -- tests/location-audit.repository.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/compliance/location-audit.types.ts src/modules/compliance/location-audit.repository.ts tests/location-audit.repository.test.ts
git commit -m "Record sanitized location audit logs"
```

---

### Task 3: Add fire-and-forget audit service and dependencies

**Files:**
- Create: `src/modules/compliance/location-audit.service.ts`
- Create: `src/modules/compliance/location-audit.dependencies.ts`
- Modify: `src/server.ts`
- Modify: `src/app.ts`
- Test: `tests/location-audit.service.test.ts`

- [ ] **Step 1: Write service failure-isolation test**

Create `tests/location-audit.service.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';

import { LocationAuditService } from '../src/modules/compliance/location-audit.service.js';

describe('LocationAuditService', () => {
  test('does not throw when audit repository insert fails', async () => {
    const service = new LocationAuditService({
      recordAccess: vi.fn(() => Promise.reject(new Error('db down'))),
      recordUsage: vi.fn(() => Promise.reject(new Error('db down')))
    });

    await expect(
      service.recordAccess({
        action: 'READ_ADMIN_ORDERS',
        actorId: 'admin',
        actorType: 'ADMIN',
        ipAddress: null,
        metadata: {},
        resourceId: null,
        resourceType: 'ORDER',
        result: 'SUCCESS',
        routeScopeKey: null,
        shopId: 'shop-id',
        userAgent: null
      })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement service**

Create `src/modules/compliance/location-audit.service.ts`:

```ts
import type { RecordLocationAccessInput, RecordLocationUsageInput } from './location-audit.types.js';

export type LocationAuditRepository = {
  recordAccess(input: RecordLocationAccessInput): Promise<{ id: string }>;
  recordUsage(input: RecordLocationUsageInput): Promise<{ id: string }>;
};

export class LocationAuditService {
  constructor(private readonly repository: LocationAuditRepository) {}

  async recordAccess(input: RecordLocationAccessInput): Promise<void> {
    try {
      await this.repository.recordAccess(input);
    } catch {
      // Audit logging must not break the operational API path.
    }
  }

  async recordUsage(input: RecordLocationUsageInput): Promise<void> {
    try {
      await this.repository.recordUsage(input);
    } catch {
      // Usage-record logging must not break the operational API path.
    }
  }
}
```

- [ ] **Step 3: Implement dependency loader**

Create `src/modules/compliance/location-audit.dependencies.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

import { PrismaLocationAuditRepository } from './location-audit.repository.js';
import { LocationAuditService } from './location-audit.service.js';

export function createLocationAuditDependencies(prisma: PrismaClient): LocationAuditService {
  return new LocationAuditService(new PrismaLocationAuditRepository(prisma));
}
```

- [ ] **Step 4: Wire optional dependency through `app.ts` and `server.ts`**

Add to route dependency options:

```ts
locationAudit?: LocationAuditService;
```

In `src/server.ts`, create once from Prisma and pass to admin/driver route dependency factories. Preserve tests by keeping it optional.

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/location-audit.service.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/compliance/location-audit.service.ts src/modules/compliance/location-audit.dependencies.ts src/app.ts src/server.ts tests/location-audit.service.test.ts
git commit -m "Wire location audit service"
```

---

### Task 4: Log admin and driver location access/usage events

**Files:**
- Modify: `src/routes/admin-orders.routes.ts`
- Modify: `src/routes/admin-route-plans.routes.ts`
- Modify: `src/routes/driver-events.routes.ts`
- Test: `tests/admin-orders.routes.test.ts`
- Test: `tests/admin-route-plans.routes.test.ts`
- Test: `tests/driver-events.routes.test.ts`

- [ ] **Step 1: Extend route dependency types**

For each route dependency type, add optional dependency:

```ts
locationAudit?: {
  recordAccess(input: RecordLocationAccessInput): Promise<void>;
  recordUsage(input: RecordLocationUsageInput): Promise<void>;
};
```

Import input types from `src/modules/compliance/location-audit.types.ts`.

- [ ] **Step 2: Add request metadata helpers**

In each route file, add:

```ts
function requestIp(headers: Record<string, unknown>, fallbackIp?: string): string | null {
  const forwarded = headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    return forwarded.split(',')[0]?.trim() ?? null;
  }
  return fallbackIp ?? null;
}

function userAgent(headers: Record<string, unknown>): string | null {
  const value = headers['user-agent'];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
```

- [ ] **Step 3: Log `GET /admin/orders`**

After `orders` are returned, call:

```ts
await dependencies.locationAudit?.recordAccess({
  action: 'READ_ADMIN_ORDERS',
  actorId: authenticated.subject,
  actorType: 'ADMIN',
  ipAddress: requestIp(request.headers, request.ip),
  metadata: { orderCount: orders.length, filters },
  resourceId: null,
  resourceType: 'ORDER',
  result: 'SUCCESS',
  routeScopeKey: filters.routeScopeKey ?? null,
  shopId: null,
  userAgent: userAgent(request.headers)
});
```

Because current route auth returns `shopDomain` but not `shopId`, store `shopId: null` in route-level logging until dependency can resolve shop id. Repository-level logging can fill shop id later if needed.

- [ ] **Step 4: Log `PATCH /admin/orders/sync`**

After sync result:

```ts
await dependencies.locationAudit?.recordUsage({
  action: 'SYNC_ORDERS',
  actorId: authenticated.subject,
  actorType: 'ADMIN',
  metadata: { received: result.sync.received, readyToPlan: result.sync.readyToPlan, needsReview: result.sync.needsReview },
  purpose: 'Normalize Shopify order locations into delivery stops',
  recipientId: null,
  recipientType: 'clever-delivery-server',
  routeScopeKey: null,
  shopId: null,
  sourcePath: '/admin/orders/sync',
  subjectId: null,
  subjectType: 'ORDER'
});
```

- [ ] **Step 5: Log route plan create/read**

For `POST /admin/route-plans`, log `CREATE_ROUTE_PLAN` access and usage with `routeScope.routeScopeKey ?? null`. For detail reads, log `READ_ROUTE_PLAN` with `resourceId: request.params.routePlanId`.

- [ ] **Step 6: Log driver event location collection**

For `POST /driver/events`, when `eventInput.latitude !== null || eventInput.longitude !== null`, call usage logging:

```ts
await dependencies.locationAudit?.recordUsage({
  action: 'RECORD_DRIVER_EVENT',
  actorId: driverContext.driverId,
  actorType: 'DRIVER',
  metadata: { eventType: eventInput.eventType, duplicate: result.duplicate },
  purpose: 'Record driver route progress/location event',
  recipientId: null,
  recipientType: 'clever-delivery-server',
  routeScopeKey: null,
  shopId: null,
  sourcePath: '/driver/events',
  subjectId: result.eventId,
  subjectType: 'DRIVER_EVENT'
});
```

- [ ] **Step 7: Add route tests**

In each route test harness, add `locationAudit` mocks and assert relevant calls. Example for admin orders list:

```ts
expect(locationAudit.recordAccess).toHaveBeenCalledWith(
  expect.objectContaining({
    action: 'READ_ADMIN_ORDERS',
    actorId: 'shopify-user-id',
    actorType: 'ADMIN',
    result: 'SUCCESS'
  })
);
```

- [ ] **Step 8: Run route tests**

```bash
npm test -- tests/admin-orders.routes.test.ts tests/admin-route-plans.routes.test.ts tests/driver-events.routes.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add src/routes/admin-orders.routes.ts src/routes/admin-route-plans.routes.ts src/routes/driver-events.routes.ts tests/admin-orders.routes.test.ts tests/admin-route-plans.routes.test.ts tests/driver-events.routes.test.ts
git commit -m "Log location access in API routes"
```

---

### Task 5: Sanitize raw payload and remove email search

**Files:**
- Modify: `src/modules/shopify/order-sync.repository.ts`
- Modify: `src/modules/shopify/order-sync.mapper.ts` if raw payload is better sanitized before repository
- Test: `tests/order-sync.repository.test.ts`
- Test: `tests/shopify-order-sync.mapper.test.ts`

- [ ] **Step 1: Add failing tests**

In `tests/order-sync.repository.test.ts`, assert persisted `rawPayload` removes duplicate location and email:

```ts
expect(prisma.order.upsert).toHaveBeenCalledWith(
  expect.objectContaining({
    create: expect.objectContaining({
      rawPayload: expect.not.objectContaining({ email: 'customer@example.com' })
    })
  })
);
```

Also check nested shipping address:

```ts
const rawPayload = (prisma.order.upsert.mock.calls[0]?.[0] as { create: { rawPayload: unknown } }).create.rawPayload;
expect(rawPayload).toEqual(
  expect.objectContaining({
    shippingAddress: expect.not.objectContaining({ latitude: 43.589, longitude: -79.644 })
  })
);
```

For search, assert email is not in `where.OR`:

```ts
await repository.listCanonicalOrders({ filters: { search: 'customer@example.com' }, shopDomain: 'example.myshopify.com' });
expect(prisma.order.findMany).toHaveBeenCalledWith(
  expect.objectContaining({
    where: expect.objectContaining({
      OR: expect.not.arrayContaining([expect.objectContaining({ email: expect.anything() })])
    })
  })
);
```

- [ ] **Step 2: Implement sanitizer**

In `src/modules/shopify/order-sync.repository.ts`:

```ts
function sanitizeOrderRawPayload(value: unknown): Prisma.InputJsonValue {
  const raw = objectOrNull(value) ?? {};
  const shippingAddress = objectOrNull(raw.shippingAddress);
  const sanitizedShippingAddress = shippingAddress === null
    ? raw.shippingAddress
    : Object.fromEntries(
        Object.entries(shippingAddress).filter(([key]) => key !== 'latitude' && key !== 'longitude')
      );
  const sanitized = Object.fromEntries(
    Object.entries({ ...raw, shippingAddress: sanitizedShippingAddress }).filter(([key]) => key !== 'email')
  );
  return toJson(sanitized);
}
```

Change `toOrderWrite`:

```ts
rawPayload: sanitizeOrderRawPayload(input.rawPayload),
```

- [ ] **Step 3: Remove email search**

In `toOrderWhere`, replace:

```ts
where.OR = [
  { name: { contains: search, mode: 'insensitive' } },
  { email: { contains: search, mode: 'insensitive' } },
  { phone: { contains: search, mode: 'insensitive' } }
];
```

with:

```ts
where.OR = [
  { name: { contains: search, mode: 'insensitive' } },
  { phone: { contains: search, mode: 'insensitive' } }
];
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/order-sync.repository.test.ts tests/shopify-order-sync.mapper.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopify/order-sync.repository.ts src/modules/shopify/order-sync.mapper.ts tests/order-sync.repository.test.ts tests/shopify-order-sync.mapper.test.ts
git commit -m "Minimize stored Shopify location payloads"
```

---

### Task 6: Add retention cleanup service and manual command

**Files:**
- Create: `src/modules/compliance/location-retention.service.ts`
- Create: `scripts/location-retention-cleanup.ts`
- Modify: `package.json`
- Test: `tests/location-retention.service.test.ts`

- [ ] **Step 1: Write cleanup test**

Create `tests/location-retention.service.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';

import { LocationRetentionService } from '../src/modules/compliance/location-retention.service.js';

describe('LocationRetentionService', () => {
  test('deletes expired access and usage records and anonymizes old driver coordinates', async () => {
    const prisma = {
      driverEvent: { updateMany: vi.fn(() => Promise.resolve({ count: 3 })) },
      locationAccessLog: { deleteMany: vi.fn(() => Promise.resolve({ count: 4 })) },
      locationUsageRecord: { deleteMany: vi.fn(() => Promise.resolve({ count: 5 })) },
      retentionJobRun: {
        create: vi.fn(() => Promise.resolve({ id: 'job-id' })),
        update: vi.fn(() => Promise.resolve({ id: 'job-id' }))
      }
    };
    const service = new LocationRetentionService(prisma as never, () => new Date('2026-05-11T00:00:00.000Z'));

    const result = await service.runCleanup();

    expect(result).toEqual({ anonymizedCount: 3, deletedCount: 9, jobRunId: 'job-id' });
    expect(prisma.driverEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ latitude: null, longitude: null })
      })
    );
  });
});
```

- [ ] **Step 2: Implement service**

Create `src/modules/compliance/location-retention.service.ts`:

```ts
import type { Prisma, PrismaClient } from '@prisma/client';

const DRIVER_LOCATION_EVENT_RETENTION_DAYS = Number(process.env.DRIVER_LOCATION_EVENT_RETENTION_DAYS ?? 90);

type RetentionPrismaClient = Pick<
  PrismaClient,
  'driverEvent' | 'locationAccessLog' | 'locationUsageRecord' | 'retentionJobRun'
>;

export class LocationRetentionService {
  constructor(
    private readonly prisma: RetentionPrismaClient,
    private readonly now: () => Date = () => new Date()
  ) {}

  async runCleanup(): Promise<{ anonymizedCount: number; deletedCount: number; jobRunId: string }> {
    const started = await this.prisma.retentionJobRun.create({
      data: { jobName: 'location-retention-cleanup', status: 'RUNNING', metadata: {} }
    });

    try {
      const now = this.now();
      const driverCutoff = addDays(now, -DRIVER_LOCATION_EVENT_RETENTION_DAYS);
      const accessDeleted = await this.prisma.locationAccessLog.deleteMany({
        where: { retentionUntil: { lt: now } }
      });
      const usageDeleted = await this.prisma.locationUsageRecord.deleteMany({
        where: { retentionUntil: { lt: now } }
      });
      const driverAnonymized = await this.prisma.driverEvent.updateMany({
        data: {
          latitude: null,
          longitude: null,
          payload: Prisma.JsonNull
        },
        where: {
          eventType: 'LOCATION_UPDATED',
          occurredAt: { lt: driverCutoff },
          OR: [{ latitude: { not: null } }, { longitude: { not: null } }]
        }
      });

      await this.prisma.retentionJobRun.update({
        data: {
          anonymizedCount: driverAnonymized.count,
          deletedCount: accessDeleted.count + usageDeleted.count,
          finishedAt: now,
          status: 'SUCCESS'
        },
        where: { id: started.id }
      });

      return {
        anonymizedCount: driverAnonymized.count,
        deletedCount: accessDeleted.count + usageDeleted.count,
        jobRunId: started.id
      };
    } catch (error) {
      await this.prisma.retentionJobRun.update({
        data: {
          errorMessage: error instanceof Error ? error.message : 'Unknown retention cleanup error',
          finishedAt: this.now(),
          status: 'ERROR'
        },
        where: { id: started.id }
      });
      throw error;
    }
  }
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
```

- [ ] **Step 3: Add manual script**

Create `scripts/location-retention-cleanup.ts`:

```ts
import { PrismaClient } from '@prisma/client';

import { LocationRetentionService } from '../src/modules/compliance/location-retention.service.js';

const prisma = new PrismaClient();
const service = new LocationRetentionService(prisma);

try {
  const result = await service.runCleanup();
  console.log(JSON.stringify({ data: result, error: null }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ data: null, error: error instanceof Error ? error.message : 'Unknown error' }, null, 2));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
```

Modify `package.json`:

```json
"location:retention:cleanup": "tsx scripts/location-retention-cleanup.ts"
```

- [ ] **Step 4: Run tests and dry command**

```bash
npm test -- tests/location-retention.service.test.ts
npm run typecheck
npm run location:retention:cleanup
```

Expected: tests/typecheck pass. The cleanup command requires `DATABASE_URL`; against a dev DB it should print JSON result.

- [ ] **Step 5: Commit**

```bash
git add src/modules/compliance/location-retention.service.ts scripts/location-retention-cleanup.ts package.json tests/location-retention.service.test.ts
git commit -m "Add location retention cleanup"
```

---

### Task 7: Add evidence templates and deployment/runbook updates

**Files:**
- Create: `docs/compliance/evidence/location-protection/01-access-authentication.md`
- Create: `docs/compliance/evidence/location-protection/02-network-encryption-firewall.md`
- Create: `docs/compliance/evidence/location-protection/03-access-log-and-usage-records.md`
- Create: `docs/compliance/evidence/location-protection/04-security-programs-monitoring.md`
- Create: `docs/compliance/evidence/location-protection/05-retention-and-deletion-runs.md`
- Modify: `docs/deployment/ec2-ebs.md`
- Modify: `docs/compliance/location-data-handling.md`

- [ ] **Step 1: Create evidence template files**

Each evidence file should use this structure:

```md
# Evidence: <control name>

Date captured: YYYY-MM-DD
Environment: local | staging | production
Owner: <name/team>

## Control claim

<One concrete claim that matches actual implementation.>

## Evidence source

- Command/workflow/screenshot path:
- Commit/PR:
- Runtime host or environment:

## Captured evidence

```text
<paste concise output or link to artifact>
```

## Gaps / next review

- <gap or "None recorded">
```

- [ ] **Step 2: Add retention runbook section**

In `docs/deployment/ec2-ebs.md`, add:

```md
## Location retention cleanup

Run manually after deployment or from a scheduled host cron once production retention policy is approved:

```bash
npm run location:retention:cleanup
```

Capture the JSON output in `docs/compliance/evidence/location-protection/05-retention-and-deletion-runs.md` or the operational evidence store. Do not paste raw location coordinates into evidence docs.
```

- [ ] **Step 3: Update data handling reference**

Update `docs/compliance/location-data-handling.md` Known current gaps after implementation. Remove any gap that is actually closed and add new gaps discovered during tests.

- [ ] **Step 4: Commit**

```bash
git add docs/compliance docs/deployment/ec2-ebs.md
git commit -m "Document location protection evidence workflow"
```

---

### Task 8: Final verification and PR

**Files:**
- All changed files

- [ ] **Step 1: Run full verification**

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run check:workspace
git diff --check
```

Expected:

- All tests pass.
- ESLint passes.
- TypeScript passes.
- Build passes.
- Workspace check passes.
- No whitespace errors.

- [ ] **Step 2: Create PR**

```bash
git push -u origin cc-99-location-protection

gh pr create \
  --base dev \
  --head cc-99-location-protection \
  --title "Add location information protection controls" \
  --body "## Summary
- Add location access and usage recording for admin/driver location flows.
- Add retention cleanup for audit/usage records and stale driver coordinates.
- Minimize duplicated raw Shopify location payloads and document evidence workflow.

## Verification
- npm test
- npm run lint
- npm run typecheck
- npm run build
- npm run check:workspace

## Links
- Fixes #36
- Change-control: EVNSolution/clever-change-control#99"
```

- [ ] **Step 3: Merge and deploy only after checks pass**

Use the repo’s normal PR-to-`dev` flow. After merge, watch the EC2 deployment workflow and run the Inspect EC2 Runtime workflow.

---

## Self-review

- Spec coverage: plan covers inventory, data handling, access/usage logging, retention periods, deletion/anonymization, evidence docs, and current risky claims to avoid.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation tasks remain.
- Type consistency: route tasks use `RecordLocationAccessInput` / `RecordLocationUsageInput`; Prisma model enums match TypeScript string unions.
- Known implementation risk: Prisma `payload: Prisma.JsonNull` for old driver events removes full payload, not just coordinate keys. If payload contains useful non-location event data, replace with a JSON sanitizer before implementation.
