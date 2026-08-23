import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import {
  createUser, getUserByEmail, listUsers, deleteUser, setPassword, setRole,
  countAdmins, verifyLogin, createSession, getSession, destroySession
} from '../src/lib/server/auth-session';

describe('auth-session', () => {
  let dir: string; let db: Db;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gsc-hub-')); db = openDb(join(dir, 't.db')); });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it('creates a user with a hashed password and verifies login', async () => {
    const u = await createUser(db, { email: 'A@Ex.com', password: 'pw12345', role: 'manager' });
    expect(u.email).toBe('a@ex.com'); // lowercased
    expect(u.role).toBe('manager');
    const ok = await verifyLogin(db, 'a@ex.com', 'pw12345');
    expect(ok?.id).toBe(u.id);
    const bad = await verifyLogin(db, 'a@ex.com', 'wrong');
    expect(bad).toBeNull();
    expect(getUserByEmail(db, 'a@ex.com')?.password_hash).not.toBe('pw12345');
  });

  it('counts admins and lists users', async () => {
    await createUser(db, { email: 'm@x.com', password: 'pw12345', role: 'manager' });
    await createUser(db, { email: 'ad@x.com', password: 'pw12345', role: 'admin' });
    expect(countAdmins(db)).toBe(1);
    expect(listUsers(db).map((u) => u.email).sort()).toEqual(['ad@x.com', 'm@x.com']);
  });

  it('setPassword changes the verifiable password; setRole updates role; deleteUser removes', async () => {
    const u = await createUser(db, { email: 'm@x.com', password: 'old12345', role: 'manager' });
    await setPassword(db, u.id, 'new12345');
    expect(await verifyLogin(db, 'm@x.com', 'old12345')).toBeNull();
    expect(await verifyLogin(db, 'm@x.com', 'new12345')).not.toBeNull();
    setRole(db, u.id, 'admin');
    expect(countAdmins(db)).toBe(1);
    deleteUser(db, u.id);
    expect(getUserByEmail(db, 'm@x.com')).toBeUndefined();
  });

  it('sessions: create/get/destroy', async () => {
    const u = await createUser(db, { email: 'm@x.com', password: 'pw12345', role: 'manager' });
    const token = createSession(db, u.id);
    expect(getSession(db, token)?.id).toBe(u.id);
    destroySession(db, token);
    expect(getSession(db, token)).toBeNull();
    expect(getSession(db, 'nope')).toBeNull();
  });

  it('revokes existing sessions when the password changes', async () => {
    // Changing a password is how an account is taken back after it is
    // compromised. A session that keeps working for its full 30 days makes that
    // action useless against whoever is already logged in.
    const u = await createUser(db, { email: 'a@ex.com', password: 'pw12345678', role: 'admin' });
    const other = await createUser(db, { email: 'b@ex.com', password: 'pw12345678', role: 'admin' });
    const token = createSession(db, u.id);
    const otherToken = createSession(db, other.id);
    expect(getSession(db, token)?.id).toBe(u.id);

    await setPassword(db, u.id, 'a completely different one');

    expect(getSession(db, token)).toBeNull();
    expect(getSession(db, otherToken)?.id).toBe(other.id);
  });
});
