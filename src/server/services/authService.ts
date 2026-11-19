import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { AppDatabase } from '../db.js';
import { AppConfig } from '../config.js';
import { UserProfile } from '../../shared/types.js';
import { SUPPORTED_ASSET } from '../../shared/constants.js';

export class AuthService {
  constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig
  ) {}

  async seedInitialUsers(): Promise<void> {
    if (this.config.demoAuthEnabled) {
      const adminEmail = 'ric@ricswallet.io';
      const secondEmail = 'alice@ricswallet.io';

      if (!(await this.getUserByEmail(adminEmail))) {
        await this.registerUser({
          email: adminEmail,
          name: 'Ric (Demo Wallet & Admin)',
          password: 'demo-password-123',
          role: 'admin',
        });
      }

      if (!(await this.getUserByEmail(secondEmail))) {
        await this.registerUser({
          email: secondEmail,
          name: 'Alice Wanjiku',
          password: 'alice-password-123',
          role: 'user',
        });
      }
      return;
    }

    // Production mode: bootstrap initial admin account if ADMIN_EMAIL + ADMIN_INITIAL_PASSWORD are set
    if (this.config.adminEmail && this.config.adminInitialPassword) {
      const existingAdmin = await this.getUserByEmail(this.config.adminEmail);
      if (!existingAdmin) {
        await this.registerUser({
          email: this.config.adminEmail,
          name: 'Administrator',
          password: this.config.adminInitialPassword,
          role: 'admin',
        });
      }
    }
  }

  async registerUser(params: {
    email: string;
    name: string;
    password: string;
    role?: 'user' | 'admin';
  }): Promise<UserProfile> {
    const normalizedEmail = params.email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw new Error('Please provide a valid email address.');
    }
    if (params.password.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }

    const existing = await this.getUserByEmail(normalizedEmail);
    if (existing) {
      throw new Error('An account with this email already exists.');
    }

    const id = `usr_${crypto.randomBytes(8).toString('hex')}`;
    const now = new Date().toISOString();
    const passwordHash = bcrypt.hashSync(params.password, 10);
    // Automatically grant admin role if registering with configured ADMIN_EMAIL
    const role =
      params.role ?? (normalizedEmail === this.config.adminEmail ? 'admin' : 'user');
    const name = params.name.trim() || normalizedEmail.split('@')[0];

    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT INTO users (id, email, name, password_hash, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, normalizedEmail, name, passwordHash, role, now]
      );

      await this.db.run(
        `INSERT INTO account_balances (user_id, asset, available_raw, updated_at)
         VALUES (?, ?, '0', ?)`,
        [id, SUPPORTED_ASSET, now]
      );
    });

    return { id, email: normalizedEmail, name, role, createdAt: now };
  }

  async authenticate(
    email: string,
    password: string
  ): Promise<{ user: UserProfile; token: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const row = await this.db.get<{
      id: string;
      email: string;
      name: string;
      password_hash: string;
      role: 'user' | 'admin';
      created_at: string;
    }>(`SELECT * FROM users WHERE email = ?`, [normalizedEmail]);

    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      throw new Error('Invalid email or password.');
    }

    const user: UserProfile = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      createdAt: row.created_at,
    };

    const token = await this.createSession(user.id);
    return { user, token };
  }

  async createSession(userId: string): Promise<string> {
    const token = `sess_${crypto.randomBytes(24).toString('hex')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    await this.db.run(
      `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
      [token, userId, now.toISOString(), expiresAt.toISOString()]
    );
    return token;
  }

  async revokeSession(token: string): Promise<void> {
    await this.db.run(`DELETE FROM sessions WHERE token = ?`, [token]);
  }

  async getUserBySessionToken(token: string | undefined | null): Promise<UserProfile | null> {
    if (!token) return null;
    const now = new Date().toISOString();
    const row = await this.db.get<{
      id: string;
      email: string;
      name: string;
      role: 'user' | 'admin';
      created_at: string;
    }>(
      `SELECT u.id, u.email, u.name, u.role, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
      [token, now]
    );

    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      createdAt: row.created_at,
    };
  }

  async getUserByEmail(email: string): Promise<UserProfile | null> {
    const row = await this.db.get<{
      id: string;
      email: string;
      name: string;
      role: 'user' | 'admin';
      created_at: string;
    }>(`SELECT id, email, name, role, created_at FROM users WHERE email = ?`, [
      email.trim().toLowerCase(),
    ]);
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      createdAt: row.created_at,
    };
  }

  async listDemoAccounts(): Promise<UserProfile[]> {
    if (!this.config.demoAuthEnabled) {
      return [];
    }
    const rows = await this.db.all<{
      id: string;
      email: string;
      name: string;
      role: 'user' | 'admin';
      created_at: string;
    }>(`SELECT id, email, name, role, created_at FROM users ORDER BY created_at ASC LIMIT 10`);
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      createdAt: r.created_at,
    }));
  }
}
