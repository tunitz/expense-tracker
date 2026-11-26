import { describe, it, expect } from 'bun:test';
import { openDb } from './db';
import { register, login, getSessionUser, logout, AuthError } from './auth';
import { createHash } from 'crypto';

describe('auth', () => {
  it('register succeeds', async () => {
    const db = openDb(':memory:');
    const result = await register(db, 'alice@example.com', 'password123');
    expect(result.id).toBeDefined();
    expect(result.email).toBe('alice@example.com');
  });

  it('duplicate email (different case) => email_taken', async () => {
    const db = openDb(':memory:');
    await register(db, 'alice@example.com', 'password123');
    try {
      await register(db, 'Alice@Example.com', 'password123');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).code).toBe('email_taken');
    }
  });

  it('bad email => invalid_email', async () => {
    const db = openDb(':memory:');
    try {
      await register(db, 'not-an-email', 'password123');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).code).toBe('invalid_email');
    }
  });

  it('weak password => weak_password', async () => {
    const db = openDb(':memory:');
    try {
      await register(db, 'alice@example.com', 'short');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).code).toBe('weak_password');
    }
  });

  it('login returns 64-char hex token', async () => {
    const db = openDb(':memory:');
    await register(db, 'alice@example.com', 'password123');
    const { token } = await login(db, 'alice@example.com', 'password123');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sessions table does NOT contain the raw token', async () => {
    const db = openDb(':memory:');
    await register(db, 'alice@example.com', 'password123');
    const { token } = await login(db, 'alice@example.com', 'password123');
    const rows = db.prepare('SELECT id FROM sessions').all() as { id: string }[];
    expect(rows.length).toBe(1);
    const storedId = rows[0]!.id;
    expect(storedId).not.toBe(token);
    expect(storedId.length).toBe(64);
  });

  it('getSessionUser returns the user', async () => {
    const db = openDb(':memory:');
    await register(db, 'alice@example.com', 'password123');
    const { token } = await login(db, 'alice@example.com', 'password123');
    const user = getSessionUser(db, token);
    expect(user).not.toBeNull();
    expect(user!.email).toBe('alice@example.com');
  });

  it('wrong password => invalid_credentials', async () => {
    const db = openDb(':memory:');
    await register(db, 'alice@example.com', 'password123');
    try {
      await login(db, 'alice@example.com', 'wrongpassword');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).code).toBe('invalid_credentials');
    }
  });

  it('unknown email => invalid_credentials', async () => {
    const db = openDb(':memory:');
    try {
      await login(db, 'nobody@example.com', 'password123');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).code).toBe('invalid_credentials');
    }
  });

  it('after logout getSessionUser is null', async () => {
    const db = openDb(':memory:');
    await register(db, 'alice@example.com', 'password123');
    const { token } = await login(db, 'alice@example.com', 'password123');
    logout(db, token);
    expect(getSessionUser(db, token)).toBeNull();
  });

  it('expired session => null and row deleted', async () => {
    const db = openDb(':memory:');
    await register(db, 'alice@example.com', 'password123');
    const { token } = await login(db, 'alice@example.com', 'password123');
    db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
    expect(getSessionUser(db, token)).toBeNull();
    const rows = db.prepare('SELECT id FROM sessions').all() as { id: string }[];
    expect(rows.length).toBe(0);
  });

  it('password_hash starts with $argon2', async () => {
    const db = openDb(':memory:');
    await register(db, 'alice@example.com', 'password123');
    const row = db
      .prepare('SELECT password_hash FROM users WHERE email = ?')
      .get('alice@example.com') as { password_hash: string };
    expect(row.password_hash.startsWith('$argon2')).toBe(true);
  });
});
