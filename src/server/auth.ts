import { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { getRandomValues, createHash } from 'crypto';

const DUMMY_HASH = await Bun.password.hash('dummy');
export const MAX_PASSWORD_LENGTH = 128;

export class AuthError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'AuthError';
  }
}

export async function register(
  db: Database,
  email: string,
  password: string,
): Promise<{ id: string; email: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    throw new AuthError('invalid_email');
  }
  if (password.length < 8) {
    throw new AuthError('weak_password');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AuthError('password_too_long');
  }
  const passwordHash = await Bun.password.hash(password);
  const id = randomUUID();
  const createdAt = Date.now();
  try {
    db.run(
      'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
      [id, normalizedEmail, passwordHash, createdAt],
    );
  } catch (err) {
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new AuthError('email_taken');
    }
    throw err;
  }
  return { id, email: normalizedEmail };
}

export async function login(
  db: Database,
  email: string,
  password: string,
): Promise<{ token: string; userId: string; expiresAt: number }> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = db
    .prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .get(normalizedEmail) as { id: string; password_hash: string } | undefined;

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AuthError('invalid_credentials');
  }

  let valid = false;
  if (user) {
    valid = await Bun.password.verify(password, user.password_hash);
  } else {
    // Verify against a real hash so unknown emails cost the same as known ones
    await Bun.password.verify(password, DUMMY_HASH);
  }
  if (!valid) {
    throw new AuthError('invalid_credentials');
  }

  // At this point user is guaranteed to be defined (we threw above if not)
  const userId = user!.id;

  const rawBytes = new Uint8Array(32);
  getRandomValues(rawBytes);
  const token = Array.from(rawBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const sessionId = createHash('sha256').update(token).digest('hex');
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

  db.run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [
    sessionId,
    userId,
    expiresAt,
  ]);

  return { token, userId, expiresAt };
}

export function getSessionUser(
  db: Database,
  token: string | undefined,
): { id: string; email: string } | null {
  if (!token) return null;

  const sessionHash = createHash('sha256').update(token).digest('hex');
  const row = db
    .prepare(
      `SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(sessionHash) as { id: string; email: string; expires_at: number } | undefined;

  if (!row) return null;

  if (row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionHash);
    return null;
  }

  return { id: row.id, email: row.email };
}

export function logout(db: Database, token: string): void {
  const sessionHash = createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionHash);
}
