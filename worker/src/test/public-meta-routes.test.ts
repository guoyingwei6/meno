import { describe, expect, it } from 'vitest';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('public metadata routes', () => {
  it('returns aggregated public tags', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/public/tags', {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tags: [
        { tag: 'cloudflare', count: 1 },
        { tag: 'meno', count: 1 },
        { tag: 'serverless', count: 1 },
      ],
    });
  });

  it('returns public calendar counts', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/public/calendar', {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      days: [{ date: '2026-03-24', count: 2 }],
    });
  });

  it('returns public heatmap cells', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/public/heatmap', {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cells: [{ date: '2026-03-24', count: 2 }],
    });
  });
});
