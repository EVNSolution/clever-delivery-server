# Runtime log inspection

Use the **Inspect EC2 Runtime** GitHub Actions workflow when direct SSH is not
available. It runs on the EC2 self-hosted runner and prints only safe operational
diagnostics:

- Docker Compose service status.
- recent `api` container logs.
- recent `caddy` container logs.
- optional non-secret route plan DB summary.

Recommended inputs:

```text
since=2h
tail=300
include_database=true
```

To confirm whether the Shopify embedded UI called the route plan API:

1. Open GitHub Actions.
2. Run **Inspect EC2 Runtime** on `dev`.
3. Check the `api logs` group for:
   - `POST /admin/route-plans`
   - `GET /admin/route-plans`
   - `GET /admin/route-plans/<id>`
4. Check the `route plan database summary` group for newly created
   `route_plans` rows.

The inspection script intentionally does not print `.env`, process environment
variables, Shopify secrets, JWT secrets, or database passwords.

## Caddy access logs

`Caddyfile.example` includes an access-log block that writes Caddy request logs
to stdout. Because the deployed `Caddyfile` is host-managed, copy the `log`
block into `/srv/clever-delivery-server/Caddyfile` on the EC2 host if it is not
already present, then reload/redeploy. Once enabled, the same inspection workflow
shows public edge requests in the `caddy logs` group.
