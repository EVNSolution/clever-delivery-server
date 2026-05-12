# Contributing to clever-delivery-server

This repository is the Shopify companion delivery API for Clever/Tomatono delivery operations. Keep product scope in `docs/project-brief.md` and agent workflow rules in `AGENTS.md`.

## Branch and issue flow

1. Work from `dev` through a target issue in `EVNSolution/clever-delivery-server`.
2. Link the target issue to the related `EVNSolution/clever-change-control` issue.
3. Use an issue-linked branch named `cc-<change-control-issue-number>-<short-scope>`.
4. Open PRs against `dev`; do not push directly to `main` or `dev` after branch protection is active.
5. Fill `.github/PULL_REQUEST_TEMPLATE.md`, including concurrent-work gate, validation evidence, and context/wiki completion.

## Local setup

Recommended Node version: 22 LTS.

```bash
nvm use
npm install
cp .env.example .env
npm run dev
```

Local PostgreSQL is required for runtime database testing. Schema generation and validation use the fallback `DATABASE_URL` from the package scripts when no local value is configured.

Do not commit `.env*` files other than `.env.example`.

## Required checks before PR

```bash
npm run check:workspace
npm run build
npm audit --audit-level=moderate
git diff --check
```

`npm run check:workspace` runs Prisma generate/validate, lint, typecheck, and the Vitest suite.

## Privacy and safety review points

- Do not treat phone number alone as a global driver identity; route/company context is part of the access boundary.
- Do not expose stop, customer, address, coordinate, event, or proof-media data before server-side tenant/company and assigned-driver scope checks pass.
- Keep Shopify Admin API tokens and driver JWT secrets out of logs, responses, fixtures, and committed files.
- Treat proof-media bytes as private operational evidence; storage, retrieval, retention, deletion, and malware-scanning behavior require explicit docs and tests when changed.
- Any change to public API contracts, env vars, data retention, or deployment behavior must update owner-repo docs and record the context/wiki decision in the PR.

## Generated and sensitive files

Generated build outputs, local env files, local runtime state, dependency folders, logs, coverage, and proof-media storage directories must stay untracked. Review `.gitignore` before adding new tooling, generated clients, database dumps, or deployment artifacts.

## Repository baseline files

- `.editorconfig` and `.gitattributes` keep source-controlled text UTF-8/LF across macOS, Linux, and Windows contributors.
- `.gitignore` and `.dockerignore` exclude local env files, Node/TypeScript outputs, proof-media runtime files, DB dumps/backups, private release/smoke/security evidence, logs, caches, and local key/certificate material.
- Do not commit ignored artifacts by force unless an owner explicitly approves the exception and the artifact contains no secrets, customer data, driver phone numbers, location data, proof media, database dumps, or private operational evidence.

## License

No public license has been selected for this repository. `package.json` currently declares `UNLICENSED`; do not add reuse or redistribution terms without an explicit owner decision.
