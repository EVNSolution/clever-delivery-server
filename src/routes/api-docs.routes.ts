import { readFile } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';

const OPENAPI_DOCUMENT_URL = new URL('../../docs/api/openapi.yaml', import.meta.url);
const SWAGGER_UI_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' https://cdn.jsdelivr.net data:",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "script-src-attr 'none'",
  "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
  "connect-src 'self'",
  'upgrade-insecure-requests'
].join(';');

export function registerApiDocsRoutes(app: FastifyInstance): void {
  app.get('/docs', (_request, reply) => {
    return reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('Content-Security-Policy', SWAGGER_UI_CSP)
      .send(renderSwaggerUiHtml());
  });

  app.get('/docs/openapi.yaml', async (_request, reply) => {
    const openApiDocument = await readFile(OPENAPI_DOCUMENT_URL, 'utf8');

    return reply
      .type('application/yaml; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(openApiDocument);
  });
}

function renderSwaggerUiHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CLEVER Delivery Server API Docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #ffffff; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/docs/openapi.yaml',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout'
      });
    </script>
  </body>
</html>`;
}
