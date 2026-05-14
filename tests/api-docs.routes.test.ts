import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

import { buildApp } from '../src/app.js';

describe('API documentation routes', () => {
  test('GET /docs serves a Swagger UI page pointing at the deployed OpenAPI document', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/docs' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('CLEVER Delivery Server API Docs');
      expect(response.body).toContain('/docs/openapi.yaml');
      expect(response.body).toContain('SwaggerUIBundle');
    } finally {
      await app.close();
    }
  });

  test('GET /docs allows the Swagger UI CDN assets required by the browser page', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/docs' });
      const csp = String(response.headers['content-security-policy']);

      expect(response.statusCode).toBe(200);
      expect(csp).toContain('https://cdn.jsdelivr.net');
      expect(csp).toContain("script-src 'self' https://cdn.jsdelivr.net");
    } finally {
      await app.close();
    }
  });

  test('GET /docs/openapi.yaml serves the committed OpenAPI contract', async () => {
    const app = await buildApp();
    const expected = await readFile(new URL('../docs/api/openapi.yaml', import.meta.url), 'utf8');

    try {
      const response = await app.inject({ method: 'GET', url: '/docs/openapi.yaml' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('yaml');
      expect(response.body).toBe(expected);
    } finally {
      await app.close();
    }
  });
});
