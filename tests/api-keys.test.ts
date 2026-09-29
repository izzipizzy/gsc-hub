import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { createApiKey, listApiKeys, revokeApiKey, verifyApiKey } from '../src/lib/server/api-keys';
import { requireApiToken } from '../src/lib/server/api-token';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => { db.close(); });

const req = (auth?: string) =>
  new Request('http://x/api/v1/site-events', auth ? { headers: { authorization: auth } } : undefined);

describe('api keys', () => {
  it('shows the key once and stores only its hash', () => {
    const created = createApiKey(db, 'agent');
    expect(created.key).toMatch(/^gsk_[A-Za-z0-9_-]{32}$/);
    const stored = db.prepare('SELECT * FROM api_keys').all() as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(created.key);
    expect(listApiKeys(db)[0]).toMatchObject({ name: 'agent', prefix: created.key.slice(0, 8), revokedAt: null });
  });

  it('verifies a live key and records when it was used', () => {
    const { key } = createApiKey(db, 'agent');
    expect(listApiKeys(db)[0].lastUsedAt).toBeNull();
    expect(verifyApiKey(db, key)).toMatchObject({ sites: [] });
    expect(listApiKeys(db)[0].lastUsedAt).toBeGreaterThan(0);
  });

  it('refuses a revoked, unknown or empty key', () => {
    const { id, key } = createApiKey(db, 'agent');
    revokeApiKey(db, id);
    expect(verifyApiKey(db, key)).toBeNull();
    expect(verifyApiKey(db, 'gsk_' + 'x'.repeat(32))).toBeNull();
    expect(verifyApiKey(db, '')).toBeNull();
  });

  it('requires a name', () => {
    expect(() => createApiKey(db, '   ')).toThrow();
  });
});

describe('requireApiToken with stored keys', () => {
  afterEach(() => { delete process.env.SERP_API_TOKEN; });

  it('lets a stored key in even when the env token is not configured', () => {
    const { key } = createApiKey(db, 'agent');
    expect(() => requireApiToken(req(`Bearer ${key}`), () => db)).not.toThrow();
  });

  it('keeps the serpmonitor env token working next to stored keys', () => {
    process.env.SERP_API_TOKEN = 'secret';
    createApiKey(db, 'agent');
    expect(() => requireApiToken(req('Bearer secret'), () => db)).not.toThrow();
  });

  it('refuses a revoked key', () => {
    const { id, key } = createApiKey(db, 'agent');
    revokeApiKey(db, id);
    expect(() => requireApiToken(req(`Bearer ${key}`), () => db)).toThrow();
  });
});

describe('область ключа по сайтам', () => {
  it('без области ключ видит все сайты', () => {
    const { key } = createApiKey(db, 'всё');
    expect(verifyApiKey(db, key)).toMatchObject({ sites: [] });
    expect(listApiKeys(db)[0].sites).toEqual([]);
  });

  it('область сохраняется и читается', () => {
    const { key } = createApiKey(db, 'испания', ['sc-domain:a.es', 'https://b.es/']);
    expect(verifyApiKey(db, key)!.sites).toEqual(['sc-domain:a.es', 'https://b.es/']);
    expect(listApiKeys(db)[0].sites).toHaveLength(2);
  });

  it('дубли и пустые строки в области отбрасываются', () => {
    const created = createApiKey(db, 'дубли', ['sc-domain:a.es', ' sc-domain:a.es ', '', '   ']);
    expect(created.sites).toEqual(['sc-domain:a.es']);
  });

  it('ключей может быть несколько, у каждого своя область', () => {
    const one = createApiKey(db, 'подрядчик', ['sc-domain:a.es']);
    const two = createApiKey(db, 'агент', ['sc-domain:b.fr', 'sc-domain:c.fr']);
    expect(verifyApiKey(db, one.key)!.sites).toEqual(['sc-domain:a.es']);
    expect(verifyApiKey(db, two.key)!.sites).toHaveLength(2);
  });

  it('область ключа видна в requireApiToken', () => {
    const { key } = createApiKey(db, 'агент', ['sc-domain:a.es']);
    const caller = requireApiToken(req(`Bearer ${key}`), () => db);
    expect(caller).toMatchObject({ kind: 'key', sites: ['sc-domain:a.es'] });
  });
});
