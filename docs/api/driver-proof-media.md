# Driver Proof Media API

Purpose: allow the native driver app to upload proof-of-delivery photo files after the driver has a server-issued bearer token and an assigned route/stop context.

This endpoint is a binary upload companion to `POST /driver/events`. The driver app uploads photo bytes first, receives durable media evidence, then includes the returned media reference in later `STOP_DELIVERED` or `STOP_FAILED` event payloads.

## Runtime registration

The route is registered with the Driver API runtime when `JWT_SECRET` is configured. Runtime dependencies include `DRIVER_PROOF_MEDIA_STORAGE_DIR`, which defaults to `var/driver-proof-media` when unset. That default local path is ignored by git and is suitable for local/dev smoke only.

`DRIVER_PROOF_MEDIA_RETENTION_DAYS` defines the default proof-media cleanup window for cleanup jobs and defaults to 180 days when unset. Production object storage ownership, signed retrieval/access, malware scanning, and private evidence storage remain hardening work. Do not treat the local filesystem storage path as the final production object-storage design.

## POST `/driver/proof-media`

Request:

```http
POST /driver/proof-media
Authorization: Bearer <server-issued driver JWT>
Content-Type: multipart/form-data; boundary=...
```

Multipart fields:

| Field | Required | Notes |
| --- | ---: | --- |
| `deliveryStopId` | Yes | Stop id from the authenticated driver's assigned route. |
| `routePlanId` | Yes | Route plan id from route access/assigned route context. |
| `source` | Yes | `camera` or `library`. |
| `file` | Yes | Image file part. Current route accepts image MIME types and enforces a 10 MiB file limit. |

Success:

```json
{
  "data": {
    "kind": "photo",
    "mediaId": "11111111-1111-4111-8111-111111111111",
    "storageKey": "driver-proof/example.myshopify.com/route-plan-id/stop-id/11111111-1111-4111-8111-111111111111.jpg",
    "contentType": "image/jpeg",
    "source": "camera",
    "uploadedAt": "2026-05-12T10:00:00.000Z",
    "sizeBytes": 12345,
    "sha256": "sha256-hex"
  },
  "error": null
}
```

Missing or invalid bearer tokens return `401`:

```json
{
  "data": null,
  "error": { "code": "UNAUTHORIZED", "message": "Missing driver bearer token" }
}
```

Invalid multipart payloads return `400`:

```json
{
  "data": null,
  "error": { "code": "BAD_REQUEST", "message": "Invalid proof media upload payload" }
}
```

A bearer-token driver that is not assigned to the `routePlanId`/`deliveryStopId` scope receives `403` without route/stop details:

```json
{
  "data": null,
  "error": { "code": "FORBIDDEN", "message": "Proof media route scope rejected" }
}
```

## Persistence model

`DriverProofMedia` stores upload metadata under the JWT shop/driver boundary:

- shop, driver, route plan, and delivery stop references
- `kind: PHOTO`
- source (`CAMERA` or `LIBRARY`)
- MIME type, original filename, storage key, byte size, SHA-256 hash
- upload timestamp and optional future deletion timestamp

The repository checks all of the following before writing bytes or metadata:

- `shopDomain` from the bearer token resolves to an installed shop
- `driverId` from the bearer token belongs to that shop
- `routePlanId` belongs to that shop and is assigned to that driver in an active/assigned route state
- `deliveryStopId` is a stop in that route plan

## Data minimization and retention notes

- The API returns metadata only; it does not echo raw file bytes.
- Do not log multipart bodies, file bytes, customer addresses, or real proof images.
- Use synthetic proof images in tests and public PR evidence.
- `PrismaDriverProofMediaRepository.deleteExpiredProofMedia()` selects undeleted metadata older than the configured cutoff, removes local stored bytes under the configured storage root, and marks rows with `deletedAt`.
- Missing local files are treated idempotently and still result in `deletedAt` metadata so repeated cleanup can converge.
- Storage keys are resolved under the configured storage root before deletion; keys that escape the root are rejected before metadata is updated.
- Object storage, signed URL access, virus/malware scanning, and private evidence storage remain follow-up hardening items.

## Adjacent APIs

- Driver route access lookup: `docs/api/driver-route-access.md`
- Driver consent record: `docs/api/driver-consents.md`
- Driver assigned route read: `docs/api/driver-assigned-route.md`
- Driver events, including `STOP_DELIVERED` and `STOP_FAILED` proof references: `POST /driver/events`
