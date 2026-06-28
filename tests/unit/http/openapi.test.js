import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../index.js';

// Exercises the OpenAPI surface added to the app factory: the machine-readable
// spec, the Swagger UI, route auto-tagging, and the docs-only CSP relaxation.
describe('OpenAPI / docs', () => {
  let app;

  beforeAll(async () => {
    app = await buildApp({ logger: false, loadDataOnStartup: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a valid OpenAPI 3 document at /openapi.json', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const spec = res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe('Chains API');
    expect(spec.info.version).toBeTruthy();
    // A representative spread of routes is documented.
    expect(spec.paths['/chains']).toBeDefined();
    expect(spec.paths['/chains/{id}']).toBeDefined();
    expect(spec.paths['/search']).toBeDefined();
    expect(spec.paths['/scaling']).toBeDefined();
  });

  it('auto-tags routes by resource and hides internal surfaces', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json();
    expect(spec.paths['/chains'].get.tags).toContain('Chains');
    expect(spec.paths['/scaling'].get.tags).toContain('Scaling');
    // Static UI and the raw-spec route are hidden from the documented paths.
    expect(Object.keys(spec.paths).some(p => p.startsWith('/ui'))).toBe(false);
    expect(spec.paths['/openapi.json']).toBeUndefined();
  });

  it('serves Swagger UI at /docs with a relaxed CSP', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-security-policy']).toContain("'unsafe-inline'");
  });

  it('keeps the strict CSP on API responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).not.toContain("'unsafe-inline'");
  });
});
