import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/index.js';

describe('health endpoint', () => {
  it('returns 200 + status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
