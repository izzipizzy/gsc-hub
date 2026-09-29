import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { requireApiToken } from '../src/lib/server/api-token';
import { openDb } from '../src/lib/server/db';

// Своя база в памяти: неверный токен дальше проверяется по ключам со страницы /api,
// и без подмены тест открыл бы настоящий ./data/gsc-hub.db.
const mem = openDb(':memory:');
const memDb = () => mem;

const req = (auth?: string) =>
  new Request('http://x/api/v1/sites', auth ? { headers: { authorization: auth } } : undefined);

describe('requireApiToken', () => {
  beforeEach(() => { process.env.SERP_API_TOKEN = 'secret'; });
  afterEach(() => { delete process.env.SERP_API_TOKEN; });

  it('accepts the configured token', () => {
    expect(() => requireApiToken(req('Bearer secret'), memDb)).not.toThrow();
  });

  it('rejects a wrong or missing token', () => {
    expect(() => requireApiToken(req('Bearer nope'), memDb)).toThrow();
    expect(() => requireApiToken(req(), memDb)).toThrow();
  });

  it('rejects everything when the token is not configured', () => {
    delete process.env.SERP_API_TOKEN;
    expect(() => requireApiToken(req('Bearer anything'), memDb)).toThrow();
  });
});
