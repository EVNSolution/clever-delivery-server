# clever-delivery-server

Shopify companion delivery data server for CLEVER/Tomatono delivery operations.

Initial deployment target: AWS EC2 with EBS-backed PostgreSQL. Growth path: move PostgreSQL to RDS when scale or operational requirements justify it.

## Current repo state

This repository currently contains the basic Node.js/TypeScript API scaffold only:

- Fastify app factory
- `/healthz` liveness endpoint
- `/readyz` readiness endpoint for the current HTTP scaffold
- TypeScript build, lint, typecheck, and Vitest test scripts

Shopify ingestion, Prisma/PostgreSQL schema, route optimization, Driver API, Docker, and EC2/EBS deployment work are intentionally left for follow-up issue-linked branches.

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

## Project references

- `AGENTS.md` for agent execution rules
- `docs/project-brief.md` for project scope
- `docs/superpowers/specs/2026-05-07-clever-delivery-server-design.md` for initial design direction
