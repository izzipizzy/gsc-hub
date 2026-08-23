import { randomBytes, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Db } from './db';

export type Role = 'admin' | 'manager';
export interface User { id: string; email: string; role: Role; created_at: number }
export interface UserWithHash extends User { password_hash: string }

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}
export function verifyPassword(h: string, password: string): Promise<boolean> {
  return verify(h, password);
}

// Exported so anything keyed by email (the login throttle) agrees with the
// spelling used to look the user up. Otherwise a leading space is a new bucket.
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
const norm = normalizeEmail;

// Synchronous, so callers can insert the user inside a transaction. Hashing is
// the slow, async half — do it before opening one.
export function createUserWithHash(
  db: Db,
  input: { email: string; password_hash: string; role: Role }
): User {
  const id = randomUUID();
  const email = norm(input.email);
  const created_at = Date.now();
  db.prepare(
    'INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?,?,?,?,?)'
  ).run(id, email, input.password_hash, input.role, created_at);
  return { id, email, role: input.role, created_at };
}

export async function createUser(
  db: Db,
  input: { email: string; password: string; role: Role }
): Promise<User> {
  const password_hash = await hashPassword(input.password);
  return createUserWithHash(db, { email: input.email, password_hash, role: input.role });
}

export function getUserByEmail(db: Db, email: string): UserWithHash | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(norm(email)) as
    | UserWithHash | undefined;
}
export function getUserById(db: Db, id: string): User | undefined {
  const r = db.prepare('SELECT id, email, role, created_at FROM users WHERE id = ?').get(id) as
    | User | undefined;
  return r;
}
export function listUsers(db: Db): User[] {
  return db.prepare('SELECT id, email, role, created_at FROM users ORDER BY created_at ASC')
    .all() as User[];
}
export function deleteUser(db: Db, id: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}
export async function setPassword(db: Db, id: string, password: string): Promise<void> {
  const password_hash = await hashPassword(password);
  // Sessions do not carry the password, so without this a change of password
  // leaves whoever is already signed in with up to 30 more days of access —
  // which is exactly what the change was meant to end.
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  })();
}
export function setRole(db: Db, id: string, role: Role): void {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
}
export function countAdmins(db: Db): number {
  const r = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number };
  return r.n;
}

export function countUsers(db: Db): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return r.n;
}

export async function verifyLogin(db: Db, email: string, password: string): Promise<User | null> {
  const u = getUserByEmail(db, email);
  if (!u) return null;
  const ok = await verifyPassword(u.password_hash, password);
  if (!ok) return null;
  return { id: u.id, email: u.email, role: u.role, created_at: u.created_at };
}

export function createSession(db: Db, userId: string): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, userId, now, now + SESSION_TTL_MS);
  return token;
}
export function getSession(db: Db, token: string): User | null {
  const s = db.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?').get(token) as
    | { user_id: string; expires_at: number } | undefined;
  if (!s) return null;
  if (s.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
    return null;
  }
  return getUserById(db, s.user_id) ?? null;
}
export function destroySession(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
}

export async function seedAdminFromEnv(
  db: Db, email: string | undefined, password: string | undefined
): Promise<void> {
  if (!email || !password) return;
  if (countAdmins(db) > 0) return;
  await createUser(db, { email, password, role: 'admin' });
}

export function backfillAccountOwners(db: Db): void {
  const admin = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY created_at ASC LIMIT 1")
    .get() as { id: string } | undefined;
  if (!admin) return;
  db.prepare('UPDATE google_accounts SET owner_id = ? WHERE owner_id IS NULL').run(admin.id);
}

export async function initAuth(
  db: Db, env: { ADMIN_EMAIL?: string; ADMIN_PASSWORD?: string }
): Promise<void> {
  await seedAdminFromEnv(db, env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  backfillAccountOwners(db);
}
