# Location Data Handling Reference

_Last reviewed: 2026-05-11_

This document records how `clever-delivery-server` should treat location information so later implementation, evidence collection, and retention decisions are easy to review. It is an engineering control reference, not legal advice.

## Legal / regulatory anchors checked

- `위치정보의 보호 및 이용 등에 관한 법률` Article 16 requires management/technical safeguards and automatic recording/preservation of location collection/use/provision confirmation data. Source: 국가법령정보센터, Article 16, law effective 2025-10-01: https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=1001048442
- Enforcement Decree Article 20 lists management controls and technical controls including access authority limitation, ledger operation, authentication, firewall/access blocking, access-log preservation, security programs, and encryption or equivalent measures. Source: 국가법령정보센터, 시행령 Article 20, effective 2026-02-10: https://www.law.go.kr/LSW/lumLsLinkPop.do?chrClsCd=010202&lspttninfSeq=79542
- Detailed standard: `위치정보의 관리적·기술적 보호조치 기준` [방송통신위원회고시 제2022-11호, 2022-06-09]. Source: https://law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000211939

## Current location data inventory

| Data | Current storage | Why it exists | Sensitivity | Handling hint |
| --- | --- | --- | --- | --- |
| Delivery stop latitude/longitude | `DeliveryStop.latitude`, `DeliveryStop.longitude` | Dispatch planning, routing, geocode status | High | Keep as canonical coordinate; restrict admin/driver access by shop and route/stop ownership. |
| Driver event latitude/longitude | `DriverEvent.latitude`, `DriverEvent.longitude`, `DriverEvent.payload` | Driver route progress, live/update events | High | Treat as personal location if tied to a driver; retain raw update events for the shortest operational period. |
| Depot coordinates | `RoutePlan.depotLatitude`, `RoutePlan.depotLongitude`, route plan request | Dispatch start point | Medium | Usually business location; still keep behind admin auth. |
| Route plan stop sequence/location context | `RoutePlanStop`, related `DeliveryStop` | Route execution and audit | High when joined with customer address | Log accesses when returned through admin/driver APIs. |
| Shopify snapshot coordinates | `Order.rawPayload.shippingAddress.latitude/longitude` if app sends full snapshot | Original source snapshot | High and duplicated | Remove from raw payload in a hardening pass; keep coordinates only in `DeliveryStop`. |
| Shipping address | `Order.shippingAddress`, `DeliveryStop.address*` | Delivery destination | Personal data, can infer location | Apply same access logging and minimization mindset even without explicit GPS coordinates. |
| Email | `Order.email`, route plan payloads, tests | Legacy/customer contact | Protected customer data risk | Do not query from Shopify Admin API; stop searching/storing unless app explicitly and lawfully provides it. |

## Proposed internal retention policy

These are engineering defaults for the next implementation. They intentionally separate raw location data from legally required confirmation/audit records.

| Record class | Proposed default | Reason | Deletion/anonymization behavior |
| --- | ---: | --- | --- |
| `LocationAccessLog` | 400 days | Access fact logs should be available for at least 1 year plus operational buffer. | Delete after retention unless litigation/incident hold is active. |
| `LocationUsageRecord` | 215 days | Location collection/use/provision confirmation data should be available for at least 6 months plus buffer. | Delete after retention unless legal/incident hold is active. |
| `DriverEvent` with `LOCATION_UPDATED` and raw coordinates | 90 days after occurrence | High-volume live driver GPS is rarely needed after delivery operations settle. | Null `latitude`, `longitude`, and coordinate fields inside `payload`; keep non-location event metadata if still operationally useful. |
| Other `DriverEvent` rows tied to proof of delivery/failure | 180 days after occurrence | Needed for customer support and delivery dispute handling. | Remove embedded coordinate fields from `payload` after 90 days; keep event type/timestamps longer if needed. |
| `DeliveryStop.latitude/longitude` | 180 days after `deliveryDate` by default | Needed for active routing, route review, and short-term support. | Null coordinates and mark retained address data separately if order history must remain. |
| `Order.rawPayload` location/customer extras | Sanitize at write time | Raw source snapshots duplicate sensitive values and are hard to govern. | Store only normalized operational fields; omit email and raw latitude/longitude. |
| PostgreSQL backups | 35 days rolling, unless incident hold | Backups can contain location and customer data. | Encrypt at rest; expire backup files; document restore access. |

Retention values should be environment-configurable before production hardening:

```env
LOCATION_ACCESS_LOG_RETENTION_DAYS=400
LOCATION_USAGE_RECORD_RETENTION_DAYS=215
DRIVER_LOCATION_EVENT_RETENTION_DAYS=90
DELIVERY_STOP_COORDINATE_RETENTION_DAYS=180
POSTGRES_BACKUP_RETENTION_DAYS=35
```

## Processing rules for future code changes

1. **Minimize duplicate coordinates**: canonical GPS belongs in `DeliveryStop` or `DriverEvent`; do not also keep it in `Order.rawPayload` unless a test documents why.
2. **Log reads, not just writes**: returning admin orders, route plan details, driver route/stop details, or driver location events should emit access/usage records.
3. **Prefer resource IDs over full payloads in logs**: audit logs should store `orderId`, `deliveryStopId`, `routePlanId`, `driverId`, `routeScopeKey`; avoid addresses, phone, email, and coordinates in audit metadata.
4. **Tenant boundary first**: every query touching location data must include `shopId`/`shopDomain` scoping.
5. **Driver boundary second**: driver APIs must only expose route/stop data assigned to that driver or active session context.
6. **Use immutable-ish logs**: application code should insert audit rows, not update them. Retention cleanup is the only planned deleter.
7. **Evidence must match reality**: do not claim DRF, Traefik, MQTT, AES-256 field encryption, 8-level RBAC, or GuardDuty unless the deployed system actually has it.

## Evidence folder shape

When implemented, store screenshots/log exports/run outputs under:

```text
docs/compliance/evidence/location-protection/
  01-access-authentication.md
  02-network-encryption-firewall.md
  03-access-log-and-usage-records.md
  04-security-programs-monitoring.md
  05-retention-and-deletion-runs.md
```

Each evidence file should include date, environment, command/source, captured output summary, and owner.

## Known current gaps

- No dedicated `LocationAccessLog` / `LocationUsageRecord` models yet.
- No automatic retention cleanup job yet.
- Raw payloads can still duplicate coordinates from Shopify/app snapshots.
- Admin order search still includes `Order.email` at repository level even though Shopify query no longer requests email.
- Route plan scope validation is implemented, but top-level route-scope fields on order inputs should be accepted to reduce app coupling to `rawPayload`.
- Route-plan time-window conversion should reuse the same Toronto timezone helper as order sync.
