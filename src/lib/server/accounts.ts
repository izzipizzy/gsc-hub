import type { Db } from './db';

export type AccountStatus = 'active' | 'revoked' | 'error';

export interface AccountRow {
  id: string;
  email: string;
  label: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  status: AccountStatus;
  last_error: string | null;
  added_at: number;
}

export interface UpsertInput {
  id: string;
  email: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}

export function upsertAccount(db: Db, a: UpsertInput): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `
    INSERT INTO google_accounts
      (id, email, label, access_token, refresh_token, expires_at, scope, status, last_error, added_at)
    VALUES
      (@id, @email, NULL, @access_token, @refresh_token, @expires_at, @scope, 'active', NULL, @added_at)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      scope = excluded.scope,
      status = 'active',
      last_error = NULL
    `
  ).run({ ...a, added_at: now });
}

export function listAccounts(db: Db): AccountRow[] {
  return db
    .prepare('SELECT * FROM google_accounts ORDER BY added_at ASC, rowid ASC')
    .all() as AccountRow[];
}

export function getAccount(db: Db, id: string): AccountRow | undefined {
  return db.prepare('SELECT * FROM google_accounts WHERE id = ?').get(id) as
    | AccountRow
    | undefined;
}

export function deleteAccount(db: Db, id: string): void {
  db.prepare('DELETE FROM google_accounts WHERE id = ?').run(id);
}

export function relabelAccount(db: Db, id: string, label: string | null): void {
  db.prepare('UPDATE google_accounts SET label = ? WHERE id = ?').run(label, id);
}

export function markRevoked(db: Db, id: string, reason: string): void {
  db.prepare(
    "UPDATE google_accounts SET status = 'revoked', last_error = ? WHERE id = ?"
  ).run(reason, id);
}

export function markError(db: Db, id: string, reason: string): void {
  db.prepare(
    "UPDATE google_accounts SET status = 'error', last_error = ? WHERE id = ?"
  ).run(reason, id);
}

export function markActive(db: Db, id: string): void {
  db.prepare(
    "UPDATE google_accounts SET status = 'active', last_error = NULL WHERE id = ?"
  ).run(id);
}

export function updateTokens(
  db: Db,
  id: string,
  patch: { access_token: string; expires_at: number }
): void {
  db.prepare(
    'UPDATE google_accounts SET access_token = ?, expires_at = ? WHERE id = ?'
  ).run(patch.access_token, patch.expires_at, id);
}
