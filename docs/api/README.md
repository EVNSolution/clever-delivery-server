# API Documentation Storage Strategy

This directory is the service-local source of truth for public HTTP contracts
owned by `clever-delivery-server`: Shopify embedded/admin app calls, Shopify
webhook ingress, native driver mobile calls, and operational health endpoints.

## Artifact layout

| Artifact | Role | Owner / update trigger |
| --- | --- | --- |
| `docs/api/openapi.yaml` | Machine-readable Swagger/OpenAPI contract for every registered HTTP route in `src/routes/*.routes.ts`. It is served by the API at `/docs/openapi.yaml`; the browser Swagger UI is `/docs` and its Swagger UI CSS/JS/initialization assets are served from same-origin `/docs/swagger-ui/*` paths. | Update in the same PR as any route method/path/auth/request/response change. |
| `docs/api/*.md` | Human-readable behavior notes, examples, persistence model, data-minimization notes, and rollout caveats that do not fit well in OpenAPI. | Update when semantics, validation, data boundaries, or operational expectations change. |
| `README.md` | Quick-start and high-level readiness summary only. | Link to this directory; avoid duplicating full contracts there. |
| `clever-context-monorepo/docs/services/clever-delivery-server/index.md` | Cross-repo service context pointer. | Update only when service responsibility, API ownership, or data-flow boundaries change across repos. |

Generated HTML, copied Swagger UI bundles, Postman collections, or SDK stubs are
not source artifacts. Generate them from `docs/api/openapi.yaml` into temporary
local output or a release evidence workspace, and do not commit generated files
unless a release issue explicitly requests them. The deployed `/docs` route reads
the `swagger-ui-dist` package at runtime instead of committing generated vendor
assets.

## Deployed web addresses

- Swagger UI: `https://clever-delivery.3-39-216-177.sslip.io/docs`
- Raw OpenAPI YAML: `https://clever-delivery.3-39-216-177.sslip.io/docs/openapi.yaml`

These paths are served by `src/routes/api-docs.routes.ts` and are deployed with
the Node API container. The Docker image copies `docs/api` into the runtime image
so the hosted YAML is the same committed source artifact. `/docs` intentionally
uses same-origin Swagger UI assets from the API container, not a public CDN, so
the interactive docs can load wherever the delivery server host itself is
reachable.

## Consumer map

| Consumer | Contract surface | Auth boundary | Human docs |
| --- | --- | --- | --- |
| Shopify embedded/admin UI | `/shopify/auth/token-exchange`, `/admin/orders*`, `/admin/drivers*`, `/admin/route-plans*` | Shopify App Bridge session token verified by the server | `shopify-and-admin-api.md`, `admin-route-plans.md` |
| Shopify HTTPS webhooks | `/shopify/webhooks` | Raw-body HMAC with `X-Shopify-Hmac-Sha256` and Shopify metadata headers | `shopify-and-admin-api.md` |
| Native driver app | `/driver/route-access/lookup`, `/driver/consents`, `/driver/assigned-route`, `/driver/proof-media*`, `/driver/events` | Phone lookup first; then short-lived server-issued driver JWT | `driver-route-access.md`, `driver-consents.md`, `driver-assigned-route.md`, `driver-proof-media.md` |
| Operations / deployment monitors | `/healthz`, `/readyz` | None in current local contract | `openapi.yaml`, deployment docs |

## Source-of-truth rules

1. Runtime behavior is implemented in `src/routes/*.routes.ts` and verified by
   tests in `tests/*.routes.test.ts`.
2. `docs/api/openapi.yaml` is the canonical review artifact for the HTTP shape:
   method, path, auth, request body, query/path/header parameters, status codes,
   and response envelopes.
3. Markdown files are the canonical review artifact for semantics: persistence,
   data minimization, compliance notes, rollout caveats, and cross-consumer flow.
4. When code, OpenAPI, and Markdown disagree, treat the code/tests as current
   behavior and fix the docs before marking the change complete.
5. Do not store real Shopify shop domains, access tokens, driver phones, proof
   images, object-storage keys, or customer data in public docs. Use synthetic
   examples such as `example.myshopify.com`, UUID fixtures, and fake E.164
   numbers.

## Versioning policy

- The current public path shape is unversioned while the product is pre-1.0.
- `info.version` in `openapi.yaml` tracks the package/service contract version.
- Additive fields and new endpoints can stay on the same paths.
- Breaking changes for mobile clients require an explicit migration plan and
  either an additive compatibility window or a versioned path such as `/v2/...`.
- Shopify Admin API version is runtime configuration (`SHOPIFY_API_VERSION`) and
  stored token metadata. Do not hardcode the current Shopify API version as a
  contract invariant except in examples.

## Update checklist for API changes

- [ ] Update the route implementation and nearest route tests.
- [ ] Update `docs/api/openapi.yaml` for method/path/auth/body/query/status
      changes.
- [ ] Update the matching Markdown contract in this directory for behavior,
      persistence, minimization, or rollout changes.
- [ ] If a `/driver/*` response consumed by `clever-driver-app` changes, update
      the mobile client parser/types/tests in `../clever-driver-app/src/domain`
      or keep the change backward compatible.
- [ ] If service ownership or cross-repo data flow changes, update
      `clever-context-monorepo/docs/services/clever-delivery-server/index.md`.
- [ ] Run documentation verification before completion:

```bash
ruby -e 'require "yaml"; YAML.load_file("docs/api/openapi.yaml"); puts "openapi yaml ok"'
ruby - <<'RUBY'
require 'yaml'
source = Dir['src/routes/*.routes.ts'].map { |path| File.read(path) }.join("\n")
actual = source.scan(/app\.(get|post|patch|delete|put)[\s\S]{0,240}?\(\s*['\"]([^'\"]+)['\"]/).map do |method, path|
  [method.downcase, path.gsub(/:([A-Za-z0-9_]+)/, '{\\1}')]
end.uniq.sort
spec = YAML.load_file('docs/api/openapi.yaml')
verbs = %w[get post patch delete put]
spec_ops = spec.fetch('paths').flat_map do |path, methods|
  methods.keys.select { |key| verbs.include?(key) }.map { |method| [method, path] }
end.sort
missing = actual - spec_ops
extra = spec_ops - actual
puts "route operations: #{actual.length}; openapi operations: #{spec_ops.length}"
abort "missing in openapi: #{missing.inspect}; extra in openapi: #{extra.inspect}" unless missing.empty? && extra.empty?
RUBY
git diff --check
```

## External references

- Shopify webhook headers and duplicate-event guidance:
  <https://shopify.dev/docs/apps/webhooks>
- Shopify HTTPS webhook HMAC validation guidance:
  <https://shopify.dev/docs/apps/build/webhooks/subscribe/https>
- Shopify session token to access-token exchange:
  <https://shopify.dev/docs/apps/auth/get-access-tokens/token-exchange/>
