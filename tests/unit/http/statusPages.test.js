import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../index.js';

// The /status-pages routes read the static registry only (no cached chain
// data or background services), so the app can be built without loading data.
let app;
beforeAll(async () => {
  app = await buildApp({ logger: false, loadDataOnStartup: false });
});
afterAll(async () => {
  await app.close();
});

describe('GET /status-pages', () => {
  it('lists chain and coin entries', async () => {
    const res = await app.inject({ method: 'GET', url: '/status-pages' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBeGreaterThan(0);
    expect(Array.isArray(body.statusPages)).toBe(true);
    expect(body.count).toBe(body.statusPages.length);
    expect(Array.isArray(body.coins)).toBe(true);
    expect(body.coinCount).toBe(body.coins.length);
  });
});

describe('GET /status-pages/:id (by chainId)', () => {
  it('returns the status page for a known chain', async () => {
    const res = await app.inject({ method: 'GET', url: '/status-pages/8453' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.chainId).toBe(8453);
    expect(body.statusPage).toMatch(/^https:\/\//);
    expect(body.project).toHaveProperty('id');
  });

  it('404s for a numeric chainId with no known page', async () => {
    const res = await app.inject({ method: 'GET', url: '/status-pages/999999999999' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toHaveProperty('error');
  });

  it('400s for a non-numeric chainId', async () => {
    const res = await app.inject({ method: 'GET', url: '/status-pages/notanid' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
  });
});

describe('GET /status-pages/symbol/:symbol (by coin)', () => {
  it('returns the status page for a known coin, case-insensitively', async () => {
    const res = await app.inject({ method: 'GET', url: '/status-pages/symbol/sol' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.symbol).toBe('SOL');
    expect(body.statusPage).toMatch(/^https:\/\//);
  });

  it('404s for an unknown coin symbol', async () => {
    const res = await app.inject({ method: 'GET', url: '/status-pages/symbol/NOTACOIN' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toHaveProperty('error');
  });

  it('400s for an invalid coin symbol', async () => {
    const res = await app.inject({ method: 'GET', url: '/status-pages/symbol/%21%21' });
    expect(res.statusCode).toBe(400);
  });

  it('does not resolve a coin via the chainId route', async () => {
    // SOL is a coin symbol, not numeric — must 400 on the chainId route.
    const res = await app.inject({ method: 'GET', url: '/status-pages/SOL' });
    expect(res.statusCode).toBe(400);
  });
});
