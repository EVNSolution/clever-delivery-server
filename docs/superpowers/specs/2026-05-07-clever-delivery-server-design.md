# clever-delivery-server Initial Design

Initial direction: build a separate Shopify companion delivery data server. Start with EC2 + EBS PostgreSQL on the same instance. Do not create a DB-only EC2 phase. Migrate to RDS PostgreSQL when operational scale or reliability requirements justify it.

Core responsibilities:

- Shopify Admin GraphQL API order sync
- Shopify webhook ingestion with HMAC verification and idempotency
- Internal delivery data storage
- Route optimization MVP
- Driver/vehicle APIs for a future delivery mobile app
- Backup/restore and RDS migration readiness
