# Driver Route Access API

Purpose: the native driver app verifies a scoped route context plus E.164 phone number before showing company guidance or any route/stop/customer details.

This is the first driver-facing contract for `clever-driver-app`. It intentionally returns only non-sensitive company/route guidance. Consent records and assigned-route reads are implemented as separate authenticated contracts; stop detail/actions, driver session issuance, and location collection remain follow-up APIs.

## Runtime registration

The route is registered with the existing Driver API runtime dependencies when `JWT_SECRET` is configured. Driver mobile clients still call this server, not Shopify Admin APIs.

## Route context

`routeContext` supports two lookup shapes:

- exact route context: an assigned `RoutePlan.id` UUID
- shared route/company scope: a non-UUID value stored at `RoutePlan.constraints.routeScope.routeScopeKey`

The server always combines `routeContext` with the normalized driver phone number before returning driver-facing context. UUID contexts bind directly to one route plan. Shared scope contexts may match zero, one, or multiple active route assignments for the phone number:

- zero active matches: `NOT_FOUND`
- one active match: normal `INVITED` response with `routeAccess.routeContext` set to the concrete route plan id
- multiple active matches: `MULTIPLE_MATCHES` response with only non-sensitive company/route display context and a resolution hint

The shared-scope path lets a dispatcher/company code show enough company guidance for the driver to identify the right operator while still requiring a route-specific invite link/code before route access is issued.

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
    "driverAccess": {
      "accessToken": "<short-lived-driver-jwt>",
      "tokenType": "Bearer",
      "expiresAt": "2026-05-12T06:55:00.000Z",
      "ttlSeconds": 900,
      "use": "consent_and_assigned_route"
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

Ambiguous shared route/company scope response:

```json
{
  "data": {
    "status": "MULTIPLE_MATCHES",
    "matches": [
      {
        "companyDisplayName": "Tomatono Toronto",
        "shopDomain": "tomatono.myshopify.com",
        "routeName": "Tuesday AM Route",
        "deliveryDate": "2026-05-12",
        "timezone": "America/Toronto",
        "pickupGuidance": "Meet at dispatch desk by 9:00 AM",
        "operatorSupportContact": "+14165550000"
      },
      {
        "companyDisplayName": "North Market",
        "shopDomain": "north-market.myshopify.com",
        "routeName": "North PM Route",
        "deliveryDate": "2026-05-12",
        "timezone": "America/Toronto",
        "pickupGuidance": "Use the route-specific invite link from dispatch.",
        "operatorSupportContact": "+14165550001"
      }
    ],
    "resolutionHint": "Use the route-specific invite link/code from dispatch."
  },
  "error": null
}
```

## Data minimization

The lookup response must not include delivery stops, customer addresses, coordinates, or order data. `INVITED` only returns enough non-sensitive context for the driver to confirm the company/shop/route before the consent gate, plus a short-lived bearer token for the matched driver/shop boundary.

`driverAccess.accessToken` is a server-signed HS256 JWT with audience `clever-delivery-driver`. It is scoped to the matched `driverId` and `shopDomain`, expires after 900 seconds, and is intended only for the next driver-app calls such as `POST /driver/consents` and `GET /driver/assigned-route`. Denial responses never include `driverAccess`. OTP/deep-link hardening, refresh sessions, and token rotation remain follow-up security work.

`MULTIPLE_MATCHES` responses are stricter than `INVITED`: they must not include `driverAccess`, `driverContext`, `routeAccess`, `routePlanId`, stops, customer names, customer addresses, coordinates, orders, proof-media data, or any other route-specific bearer credential. They are only for disambiguation and should prompt the app to ask the driver for a route-specific invite link/code from dispatch.

## Adjacent and follow-up APIs

Implemented adjacent contracts:

- consent record persistence: `docs/api/driver-consents.md`
- assigned route read after consent-gated app flow: `docs/api/driver-assigned-route.md`

Remaining follow-up contracts:

- stop detail read and stop action writes with assigned-driver boundary
- driver event/location update hardening and location usage/access logging
