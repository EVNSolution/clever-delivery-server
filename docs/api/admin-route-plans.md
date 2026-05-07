# Admin Route Plans API

Purpose: the Shopify embedded UI saves selected delivery orders into the delivery
server as the route/order/delivery source of truth. The first MVP optimizer keeps
the user-selected order sequence and stores a `DRAFT` route plan.

## Authentication

All routes require a Shopify embedded app session token:

```http
Authorization: Bearer <shopify-session-token>
```

The server verifies the token with `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`.
`shopDomain` is derived from the token, not from request payload. If the embedded
UI runs from another origin, configure `SHOPIFY_APP_URL` so CORS allows that app
origin.

## POST `/admin/route-plans`

Creates a draft route plan for the authenticated shop.

Request:

```json
{
  "name": "Tomatono route draft",
  "planDate": "2026-05-08",
  "depot": {
    "address": "Shopify departure location",
    "latitude": 43.6532,
    "longitude": -79.3832
  },
  "orders": [
    {
      "shopifyOrderGid": "gid://shopify/Order/123",
      "name": "#1035",
      "email": "customer@example.com",
      "phone": "+14165550000",
      "financialStatus": "PENDING",
      "fulfillmentStatus": "UNFULFILLED",
      "processedAt": "2026-05-07T12:00:00.000Z",
      "totalPriceAmount": "95.00",
      "currencyCode": "CAD",
      "recipientName": "Noah Yoon",
      "shippingAddress": {
        "address1": "300 City Centre Dr",
        "address2": "#08",
        "city": "Mississauga",
        "province": "ON",
        "postalCode": "L5B 3C1",
        "countryCode": "CA"
      },
      "latitude": 43.589,
      "longitude": -79.644,
      "deliveryArea": "Mississauga",
      "deliveryDay": "Thursday",
      "attributes": [{ "key": "Delivery Area", "value": "Mississauga" }],
      "rawPayload": {}
    }
  ]
}
```

Persistence contract:

- `Shop` is upserted by token-derived `shopDomain`.
- `Order` is upserted by `(shopId, shopifyOrderGid)`.
- `DeliveryStop` is upserted by `(shopId, orderId)`.
- `RoutePlan` is created with `status=DRAFT`,
  `optimizerVersion=manual-sequence-mvp`, depot coordinates, constraints, and
  metrics JSON.
- `RoutePlanStop.sequence` is assigned from request order, starting at `1`.

Response `201`:

```json
{
  "data": {
    "routePlan": {
      "id": "uuid",
      "name": "Tomatono route draft",
      "status": "DRAFT",
      "planDate": "2026-05-08",
      "stopsCount": 1,
      "missingCoordinates": 0,
      "deliveryAreas": ["Mississauga"],
      "deliveryDays": ["Thursday"],
      "depot": {
        "latitude": 43.6532,
        "longitude": -79.3832
      },
      "createdAt": "2026-05-07T12:30:00.000Z",
      "updatedAt": "2026-05-07T12:30:00.000Z"
    }
  },
  "error": null
}
```

## GET `/admin/route-plans`

Returns route plans for the authenticated shop only.

Response `200`:

```json
{
  "data": {
    "routePlans": [
      {
        "id": "uuid",
        "name": "Tomatono route draft",
        "status": "DRAFT",
        "planDate": "2026-05-08",
        "stopsCount": 1,
        "missingCoordinates": 0,
        "deliveryAreas": ["Mississauga"],
        "deliveryDays": ["Thursday"],
        "depot": { "latitude": 43.6532, "longitude": -79.3832 },
        "createdAt": "2026-05-07T12:30:00.000Z",
        "updatedAt": "2026-05-07T12:30:00.000Z"
      }
    ]
  },
  "error": null
}
```

## GET `/admin/route-plans/:routePlanId`

Returns a route plan detail for the authenticated shop. A route plan ID owned by
another shop returns `404`.

Response `200`:

```json
{
  "data": {
    "routePlan": {
      "id": "uuid",
      "name": "Tomatono route draft",
      "status": "DRAFT",
      "planDate": "2026-05-08",
      "stopsCount": 1,
      "missingCoordinates": 0,
      "deliveryAreas": ["Mississauga"],
      "deliveryDays": ["Thursday"],
      "depot": { "latitude": 43.6532, "longitude": -79.3832 },
      "createdAt": "2026-05-07T12:30:00.000Z",
      "updatedAt": "2026-05-07T12:30:00.000Z"
    },
    "stops": [
      {
        "sequence": 1,
        "deliveryStopId": "uuid",
        "orderId": "uuid",
        "shopifyOrderGid": "gid://shopify/Order/123",
        "orderName": "#1035",
        "recipientName": "Noah Yoon",
        "address": {
          "address1": "300 City Centre Dr",
          "address2": "#08",
          "city": "Mississauga",
          "province": "ON",
          "postalCode": "L5B 3C1",
          "countryCode": "CA"
        },
        "financialStatus": "PENDING",
        "fulfillmentStatus": "UNFULFILLED",
        "paymentStatus": "PENDING",
        "status": "PENDING",
        "attributes": [{ "key": "Delivery Area", "value": "Mississauga" }],
        "coordinates": { "latitude": 43.589, "longitude": -79.644 },
        "deliveryArea": "Mississauga",
        "deliveryDay": "Thursday"
      }
    ]
  },
  "error": null
}
```

Common errors:

- `401` with `UNAUTHORIZED`: missing or invalid Shopify session token.
- `400` with `BAD_REQUEST`: invalid create payload.
- `404` with `NOT_FOUND`: route plan does not exist for the token shop.
