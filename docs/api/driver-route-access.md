# Driver Route Access API

Purpose: the native driver app verifies a scoped route context plus E.164 phone number before showing company guidance or any route/stop/customer details.

This is the first driver-facing contract for `clever-driver-app`. It intentionally returns only non-sensitive company/route guidance. Assigned route reads, stop detail reads, consent records, and location collection remain follow-up APIs.

## Runtime registration

The route is registered with the existing Driver API runtime dependencies when `JWT_SECRET` is configured. Driver mobile clients still call this server, not Shopify Admin APIs.

## Route context for this slice

MVP `routeContext` is the assigned `RoutePlan.id` UUID. Future issues may replace or wrap it with a signed invite link, route code, or company/route access code. Non-UUID route contexts are treated as `NOT_FOUND` by the Prisma repository so they do not leak lookup details.

Phone numbers must be normalized to E.164 before request.

## POST `/driver/route-access/lookup`

Request:

```http
POST /driver/route-access/lookup
Content-Type: application/json
```

```json
{
  "routeContext": "11111111-1111-4111-8111-111111111111",
  "phoneE164": "+14165550123"
}
```

Validation failures return `400` before repository lookup:

```json
{
  "data": null,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid route access lookup payload"
  }
}
```

Matched active assigned driver response:

```json
{
  "data": {
    "status": "INVITED",
    "routeAccess": {
      "routeContext": "11111111-1111-4111-8111-111111111111",
      "routePlanId": "11111111-1111-4111-8111-111111111111",
      "nextState": "consent_required"
    },
    "companyGuidance": {
      "companyDisplayName": "Tomatono Toronto",
      "shopDomain": "tomatono.myshopify.com",
      "routeName": "Tuesday AM Route",
      "deliveryDate": "2026-05-12",
      "timezone": "America/Toronto",
      "pickupGuidance": "Meet at dispatch desk by 9:00 AM",
      "operatorSupportContact": "+14165550000",
      "driverInstructions": ["Bring insulated bag"]
    }
  },
  "error": null
}
```

Safe denial statuses return `200` with no guidance payload:

```json
{ "data": { "status": "NOT_FOUND" }, "error": null }
{ "data": { "status": "DISABLED" }, "error": null }
{ "data": { "status": "BLOCKED" }, "error": null }
```

`NOT_FOUND` covers missing route, no assigned driver, and phone mismatch. This avoids telling a caller which part of the route+phone pair is valid.

## Data minimization

The lookup response must not include delivery stops, customer addresses, coordinates, or order data. It only returns enough non-sensitive context for the driver to confirm the company/shop/route before the consent gate.

## Follow-up APIs

- consent record persistence
- assigned route read after consent
- stop detail read with assigned-driver boundary
- driver event/location update hardening and location usage/access logging
