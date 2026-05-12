# Driver Proof Media API

Purpose: allow the native driver app to upload proof-of-delivery photo files after the driver has a server-issued bearer token and an assigned route/stop context.

This endpoint is a binary upload companion to `POST /driver/events`. The driver app uploads photo bytes first, receives durable media evidence, then includes the returned media reference in later `STOP_DELIVERED` or `STOP_FAILED` event payloads.

## Runtime registration

The route is registered with the Driver API runtime when `JWT_SECRET` is configured. Runtime dependencies include `DRIVER_PROOF_MEDIA_STORAGE_DIR`, which defaults to `var/driver-proof-media` when unset. That default local path is ignored by git and is suitable for local/dev smoke only.

The repository writes and removes bytes through a `DriverProofMediaStorageBackend` contract. The current runtime wires the local filesystem backend, while a production deployment can replace that backend with object storage without changing route scope checks, metadata persistence, EXIF stripping, scan-hook placement, or retention cleanup orchestration.

`DRIVER_PROOF_MEDIA_RETENTION_DAYS` defines the default proof-media cleanup window for cleanup jobs and defaults to 180 days when unset. Production object storage ownership, signed retrieval/access, scanner integration/deployment evidence, and private evidence storage remain hardening work. Do not treat the local filesystem storage path as the final production object-storage design.

JPEG uploads are sanitized before byte persistence: valid EXIF APP1 segments are removed, and returned/stored `sha256` plus `sizeBytes` describe the sanitized bytes. If a `DriverProofMediaScanner` is configured, the scanner receives the sanitized bytes, content type, storage key, and sanitized SHA-256 before any byte write or metadata create. A rejected scan aborts persistence and maps to `422 PROOF_MEDIA_REJECTED`. This reduces accidental location/device metadata retention and provides a server-side scanner integration point, but it is not proof that a production malware scanner, signed access, or private object storage control is deployed.

Manual or cron-style retention cleanup uses:

```bash
npm run driver:proof-media:cleanup
```

The command does not start the HTTP server. It connects Prisma, applies `DRIVER_PROOF_MEDIA_RETENTION_DAYS`, runs the proof-media repository cleanup, disconnects Prisma, and prints JSON with `scanned`, `deleted`, `missingFiles`, `uploadedBefore`, and `deletedAt`.

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

Scanner-rejected proof media returns `422` without route/stop details, scanner internals, stored bytes, or metadata:

```json
{
  "data": null,
  "error": { "code": "PROOF_MEDIA_REJECTED", "message": "Proof media rejected by safety scan" }
}
```

## Persistence model

`DriverProofMedia` stores upload metadata under the JWT shop/driver boundary:

- shop, driver, route plan, and delivery stop references
- `kind: PHOTO`
- source (`CAMERA` or `LIBRARY`)
- MIME type, original filename, storage key, sanitized byte size, sanitized SHA-256 hash
- upload timestamp and optional future deletion timestamp

The repository checks all of the following before writing bytes or metadata:

- `shopDomain` from the bearer token resolves to an installed shop
- `driverId` from the bearer token belongs to that shop
- `routePlanId` belongs to that shop and is assigned to that driver in an active/assigned route state
- `deliveryStopId` is a stop in that route plan
- any configured `DriverProofMediaScanner` returns `status: "clean"` for the sanitized bytes

## Data minimization and retention notes

- The API returns metadata only; it does not echo raw file bytes.
- Do not log multipart bodies, file bytes, customer addresses, or real proof images.
- Use synthetic proof images in tests and public PR evidence.
- JPEG EXIF APP1 metadata is stripped before local byte storage and before `sha256` / `sizeBytes` are recorded.
- The scan hook runs after EXIF stripping and before storage/metadata writes; scan rejection should not leak scanner rule names or signature details to the driver response.
- `PrismaDriverProofMediaRepository.deleteExpiredProofMedia()` selects undeleted metadata older than the configured cutoff, removes stored bytes through the configured storage backend, and marks rows with `deletedAt`.
- Missing local files are treated idempotently and still result in `deletedAt` metadata so repeated cleanup can converge.
- Storage keys are resolved under the configured storage root before deletion; keys that escape the root are rejected before metadata is updated.
- `src/scripts/cleanup-driver-proof-media.ts` is the operational entry point for manual or scheduled cleanup. The default runtime backend is local filesystem storage.
- Object storage, signed URL access, production virus/malware scanner deployment evidence, and private evidence storage remain follow-up hardening items.

## Adjacent APIs

- Driver route access lookup: `docs/api/driver-route-access.md`
- Driver consent record: `docs/api/driver-consents.md`
- Driver assigned route read: `docs/api/driver-assigned-route.md`
- Driver events, including `STOP_DELIVERED` and `STOP_FAILED` proof references: `POST /driver/events`
