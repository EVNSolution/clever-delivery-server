# Project Brief

## 이 파일의 역할

이 문서는 `clever-delivery-server`가 무엇을 만들지, 왜 필요한지, 현재 어디까지 확정됐는지를 기록한다. Agent 실행 절차는 루트 `AGENTS.md`를 따른다.

## 연결값

- project-start issue: EVNSolution/clever-change-control#99
- target repo issue: EVNSolution/clever-delivery-server#1
- target repo: EVNSolution/clever-delivery-server
- target service: clever-delivery-server
- template lineage: node-ec2-delivery-server@0.1.0 / ec2-ebs-postgres / adopt

## 문제 정의

Shopify embedded app에서 주문/배송/경로 데이터를 매번 Shopify Admin GraphQL API로 직접 조회하면 속도 제한, 운영 데이터 확장성, 배송원 앱 연동, 경로 최적화 이력 관리가 어려워진다.

## 기대 결과

Shopify 앱 옆에 별도 delivery data server를 두고, 초기에는 EC2 단일 서버 + EBS-backed PostgreSQL로 운영 데이터를 저장한다. 데이터와 운영 요구가 커지면 DB는 RDS PostgreSQL로 이전한다.

## 제약

- 별도 DB-only EC2 단계는 만들지 않는다.
- 초기 DB는 같은 EC2의 PostgreSQL을 사용하되 데이터는 전용 encrypted EBS volume에 둔다.
- Shopify GraphiQL은 개발용 쿼리 탐색 도구이고, 서버는 Shopify Admin GraphQL API를 호출한다.
- 배송원 앱은 Shopify API를 직접 호출하지 않고 이 서버의 driver API만 호출한다.
- 구현 전 CLEVER target repo agent 문서, project brief, PR template, ruleset script가 먼저 있어야 한다.

## 초기 범위

### 포함

- Shopify order ingestion and reconciliation
- Webhook HMAC verification and idempotent event storage
- Internal PostgreSQL schema for shops, orders, delivery stops, routes, drivers, vehicles, driver events, and driver proof media
- Basic route optimization MVP
- Driver mobile API skeleton
- EC2/EBS deployment and backup readiness

### 제외

- DB-only EC2 server phase
- Immediate RDS/Aurora adoption before MVP scale requires it
- Full VRP optimizer with all capacity/time-window constraints in the first pass

## 사용자와 운영 맥락

- primary user: Shopify merchant/admin operator
- operator or admin: CLEVER/Tomatono operations team
- runtime environment: AWS EC2 with Docker, Nginx, PostgreSQL, and EBS data volume
- deploy target: EC2 first; RDS migration path later

## 기능 초안

1. Shopify webhook/order sync pipeline
2. Delivery stop normalization and internal DB API
3. Route plan generation and assignment
4. Driver route/status/location API
5. Backup, restore, and RDS migration runbook

## 데이터와 연동

- input data: Shopify orders, fulfillments, shipping addresses, delivery custom attributes, driver app events
- output data: normalized orders, delivery stops, route plans, driver assignments, delivery status history, proof-of-delivery metadata
- external systems: Shopify Admin GraphQL API, Shopify webhooks, AWS EC2/EBS, later RDS/S3 as needed
- public contract: Admin API for the Shopify app and driver API for mobile clients

## 검증 초안

- local verification: lint/typecheck/test once server stack is scaffolded
- automated tests: webhook verification, order upsert idempotency, route optimizer deterministic output, driver API auth/status flows
- smoke test: local Docker Compose starts app + PostgreSQL and health endpoint responds
- release evidence: EC2 deployment health check, DB backup output, Shopify webhook test delivery

## 미정 사항

- Final server framework: Node/TypeScript Fastify selected for the initial scaffold
- Driver app authentication depth after route+phone lookup: route access lookup, short-lived driver access token issuance, consent record persistence, assigned-route read API, driver event ingest, proof-media upload metadata/storage, local proof-media retention cleanup support, and a manual/cron-style cleanup runner are available; stronger OTP/deep-link/session hardening plus production proof-media object storage, signed access, malware scanning, and scheduled deployment evidence remain pending
- Geocoding/routing provider for MVP

## 다음 작업 목록

1. Add Prisma schema and initial migration readiness.
2. Implement Shopify webhook verification and order sync client.
3. Add Docker Compose for app + PostgreSQL + Nginx-compatible local runtime.
4. Implement route optimization and Driver API MVP slices.
